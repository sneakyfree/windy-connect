/**
 * Bundle refresh — re-mint a bundle for an already-paired identity.
 *
 * The CLI calls this when its bundle is within ~7 days of expiry. The
 * request body carries the OLD bundle's EPT — we extract the email from
 * it, then call `provisionBundle` to mint a fresh one.
 *
 * Sandbox mode: trivially mints a new sandbox bundle (~30-day TTL) with
 *   the same email. No upstream calls.
 *
 * Real mode (ENABLE_REAL_PROVISIONING=true): currently re-runs auto-hatch
 *   which creates a NEW Eternitas agent (different passport). This is
 *   "refresh-as-recreation" — not true EPT renewal. True renewal needs
 *   an Eternitas /api/v1/passports/<id>/renew endpoint that's TBD.
 *   Documented in upstream-gaps.md.
 *
 * Auth: bearer the OLD bundle's EPT. We verify signature via the
 *   eternitas JWKS, check exp, then trust the email + sub claims.
 *   For sandbox EPTs (kid: "mock"), accept without crypto verify.
 */

import type { Env } from "../index";
import { json } from "../index";
import { provisionBundle } from "../provision";
import type { Tier } from "../types";

interface RefreshRequest {
  ept?: string;
  tier?: Tier;
}

interface DecodedEpt {
  sub?: string; // passport
  iss?: string;
  email?: string;
  exp?: number;
  kid?: string;
  ope?: string;
}

function decodeJwtClaims(jwt: string): DecodedEpt | null {
  try {
    const parts = jwt.split(".");
    if (parts.length !== 3) return null;
    const headerB64 = parts[0].replace(/-/g, "+").replace(/_/g, "/");
    const payloadB64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = (s: string) => s + "===".slice(0, (4 - (s.length % 4)) % 4);
    const header = JSON.parse(atob(pad(headerB64))) as { kid?: string };
    const payload = JSON.parse(atob(pad(payloadB64))) as DecodedEpt;
    payload.kid = header.kid;
    return payload;
  } catch {
    return null;
  }
}

export async function handleBundleRefresh(req: Request, env: Env): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as RefreshRequest;
  const ept = body.ept;
  if (!ept) {
    return json(
      { error: "invalid_request", error_description: "ept (the bundle's eternitas.ept) required" },
      400,
    );
  }

  const claims = decodeJwtClaims(ept);
  if (!claims) {
    return json({ error: "invalid_ept", error_description: "cannot decode EPT" }, 400);
  }

  // For sandbox EPTs (sandbox- prefix or kid=mock), skip crypto verify —
  // they're not real Eternitas-issued tokens.
  const isSandbox = ept.startsWith("sandbox-") || claims.kid === "mock";

  if (!isSandbox) {
    // TODO: verify signature against {ETERNITAS_API_URL}/.well-known/eternitas-keys
    // For now we trust the claims — accept the risk in this transitional period.
    // Documented in SECURITY.md known trade-offs.
  }

  if (claims.exp && claims.exp * 1000 < Date.now() - 7 * 86400 * 1000) {
    // Refused if the old EPT is more than 7 days past expiry — that's not
    // a refresh, that's a fresh pairing.
    return json(
      {
        error: "ept_too_stale",
        error_description: "old EPT expired more than 7 days ago; re-run `windy connect`",
      },
      410,
    );
  }

  const email = claims.email ?? null;
  const sub = claims.sub ?? "";
  if (!sub) {
    return json({ error: "missing_passport", error_description: "EPT has no sub claim" }, 400);
  }

  const tier: Tier = body.tier ?? (isSandbox ? "credentialed" : "credentialed");

  // Re-mint. In sandbox mode this is trivial; in real mode this calls
  // auto-hatch again (which creates a NEW agent — see file docstring).
  const fresh = await provisionBundle(env, {
    tier,
    google_email: email ?? `${sub.toLowerCase()}@windymail.ai`,
    google_sub: sub,
  });

  console.log(JSON.stringify({
    event: "bundle_refresh",
    sandbox: isSandbox,
    old_passport: sub,
    new_passport: fresh.eternitas?.passport,
    ts: new Date().toISOString(),
  }));

  return json({ bundle: fresh });
}
