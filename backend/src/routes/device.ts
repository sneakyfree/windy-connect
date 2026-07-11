/**
 * Device-code OAuth flow (RFC 8628) — the CLI's view of the world.
 *
 *   POST /v1/device/init   → CLI receives device_code + user_code
 *   POST /v1/device/poll   → CLI polls until status=approved, then receives bundle
 *   POST /v1/pair/submit   → /pair page submits the user_code after Google sign-in
 */

import type { Env } from "../index";
import { json } from "../index";
import { generateDeviceCode, generateUserCode, normalizeUserCode } from "../codes";
import { getByDeviceCode, getDeviceCodeByUserCode, putSession, updateSession } from "../store";
import type { DeviceSession, Tier } from "../types";
import { provisionBundle } from "../provision";
import { verifyCsrf } from "./pair";

const DEFAULT_INTERVAL_SECONDS = 5;
const SESSION_TTL_SECONDS = 900;

export async function handleDeviceInit(req: Request, env: Env): Promise<Response> {
  // Strict parse: reject unparseable bodies with 400 rather than silently
  // defaulting. /v1/device/init is cheap to spam, so we want every bad
  // request to fail loudly so attackers/clients can't quietly burn
  // sessions through default values.
  const body = await strictJson(req);
  if (body && (body as { __invalid?: boolean }).__invalid) {
    return json({ error: "invalid_body", error_description: "request body is not valid JSON" }, 400);
  }
  const tier: Tier = (body as { tier?: string })?.tier === "free" ? "free" : "credentialed";

  const device_code = generateDeviceCode();
  const user_code = generateUserCode();
  const now = new Date();
  const expires_at = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000);

  const session: DeviceSession = {
    device_code,
    user_code,
    tier,
    status: "pending",
    created_at: now.toISOString(),
    expires_at: expires_at.toISOString(),
  };
  await putSession(env, session);

  // Structured log line for Workers Observability — searchable later by
  // event=device_init and by tier. No PII (user_code is short-lived + not
  // tied to identity until /v1/pair/submit).
  console.log(JSON.stringify({
    event: "device_init",
    tier,
    user_code: user_code,
    ts: now.toISOString(),
  }));

  // verification_uri must resolve — point at the Worker host (API_BASE_URL),
  // not the brand-facing ISSUER_URL. The CLI prints this URL for the user
  // to open in a browser, and the Worker serves /pair.
  const verification_uri = new URL("/pair", env.API_BASE_URL).toString();
  const verification_uri_complete = `${verification_uri}?code=${encodeURIComponent(user_code)}`;

  return json({
    device_code,
    user_code,
    verification_uri,
    verification_uri_complete,
    expires_in: SESSION_TTL_SECONDS,
    interval: DEFAULT_INTERVAL_SECONDS,
  });
}

export async function handleDevicePoll(req: Request, env: Env): Promise<Response> {
  const body = await safeJson(req);
  const device_code: string | undefined = body?.device_code;
  if (!device_code) {
    return json({ error: "invalid_request", error_description: "device_code required" }, 400);
  }

  const session = await getByDeviceCode(env, device_code);
  if (!session) {
    return json({ error: "expired_token" }, 410);
  }

  if (new Date(session.expires_at) < new Date()) {
    return json({ error: "expired_token" }, 410);
  }

  switch (session.status) {
    case "pending":
      return json({ error: "authorization_pending" }, 428);
    case "denied":
      return json({ error: "access_denied" }, 403);
    case "expired":
      return json({ error: "expired_token" }, 410);
    case "approved":
      console.log(JSON.stringify({
        event: "device_poll_approved",
        tier: session.tier,
        ts: new Date().toISOString(),
      }));
      return json({ bundle: session.bundle });
  }
}

/**
 * Called by the /pair page after Google sign-in completes and the user-entered
 * code is correlated with a Google identity.
 *
 * For v1 (without Google OAuth wired) the /pair page can POST {user_code, email}
 * directly and we'll mint a bundle. Production should require Google's id_token.
 */
export async function handlePairSubmit(req: Request, env: Env): Promise<Response> {
  // CSRF defense: the /pair page set a SameSite=Strict cookie + embedded
  // a matching token. The page's JS sends both back. Any cross-site POST
  // can't replay this because the browser won't send the cookie.
  const csrfError = verifyCsrf(req);
  if (csrfError) {
    return json({ error: "csrf_check_failed", detail: csrfError }, 403);
  }

  const body = await safeJson(req);
  const user_code = normalizeUserCode(body?.user_code ?? "");
  const google_email: string | undefined = body?.google_email;
  const google_sub: string | undefined = body?.google_sub;
  const id_token: string | undefined = body?.id_token;

  if (!user_code) {
    return json({ error: "invalid_request", error_description: "user_code required" }, 400);
  }

  // Resolve device_code (the user_code is stored with the hyphen)
  const formatted = `${user_code.slice(0, 4)}-${user_code.slice(4, 8)}`;
  const device_code = await getDeviceCodeByUserCode(env, formatted);
  if (!device_code) {
    return json({ error: "invalid_code", error_description: "no pending session for that code" }, 404);
  }
  const session = await getByDeviceCode(env, device_code);
  if (!session) {
    return json({ error: "expired_token" }, 410);
  }
  if (session.status !== "pending") {
    return json({ error: "already_used", status: session.status }, 409);
  }

  // Verify Google id_token if provided. When absent, we accept a raw email —
  // but ONLY in mock/dev mode (see the real-mode gate immediately below).
  let verifiedEmail = google_email;
  let verifiedSub = google_sub;
  let identityVerified = false;
  if (id_token) {
    const claims = await verifyGoogleIdToken(id_token, env);
    if (!claims) {
      return json({ error: "invalid_id_token" }, 401);
    }
    verifiedEmail = claims.email;
    verifiedSub = claims.sub;
    identityVerified = true;
  }

  // SECURITY: in real-provisioning mode, never mint a REAL bundle (Synapse
  // account + Mind key + mailbox + passport) from an unverified raw email.
  // verifyGoogleIdToken is still a stub, so the only real pairing path is the
  // magic-link flow (/v1/pair/start + /v1/pair/verify). Without this gate,
  // anyone with a user_code + a trivially-obtained CSRF token could mint a
  // real bundle bound to an arbitrary email they don't control. The raw-email
  // dev path stays available only when ENABLE_REAL_PROVISIONING !== "true".
  if (env.ENABLE_REAL_PROVISIONING === "true" && !identityVerified) {
    return json({
      error: "verification_required",
      error_description:
        "this pairing path requires a verified identity; use the magic-link flow",
    }, 403);
  }

  if (!verifiedEmail) {
    return json({ error: "missing_identity", error_description: "id_token or google_email required" }, 400);
  }

  // Mint the bundle (provisioners are stubbed unless ENABLE_REAL_PROVISIONING=true)
  const bundle = await provisionBundle(env, {
    tier: session.tier,
    google_email: verifiedEmail,
    google_sub: verifiedSub ?? `unverified:${verifiedEmail}`,
  });

  session.status = "approved";
  session.bundle = bundle;
  session.google_email = verifiedEmail;
  session.google_sub = verifiedSub;
  await updateSession(env, session);

  return json({ ok: true });
}

async function safeJson(req: Request): Promise<any> {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

/**
 * Strict JSON parse — returns the body if valid (including an empty {} for
 * an empty body), or a sentinel object {__invalid: true} if the body is
 * present-but-unparseable. Callers should branch on the sentinel and emit
 * 400 invalid_body rather than silently defaulting.
 */
async function strictJson(req: Request): Promise<unknown> {
  const text = await req.text();
  if (text.trim() === "") return {};
  try {
    return JSON.parse(text);
  } catch {
    return { __invalid: true };
  }
}

const GOOGLE_CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);

const gb64urlToBytes = (s: string): Uint8Array => {
  const pad = (str: string) => str + "===".slice(0, (4 - (str.length % 4)) % 4);
  const bin = atob(pad(s.replace(/-/g, "+").replace(/_/g, "/")));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

interface GoogleJwk { kid: string; n: string; e: string; kty: string; alg?: string; }

/**
 * Verify a Google-issued id_token: RS256 signature against Google's JWKS,
 * plus the standard claim checks (iss, aud === our client id, exp, verified
 * email). Returns parsed claims on success, null on any failure.
 *
 * Fails closed when GOOGLE_OAUTH_CLIENT_ID is unset — without a client id we
 * have no audience to bind the token to, so we must NOT accept it. (Prod must
 * set GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET to light this path;
 * until then the magic-link flow is the working real path.)
 */
async function verifyGoogleIdToken(
  idToken: string,
  env: Env,
): Promise<{ sub: string; email: string } | null> {
  try {
    const expectedAud = env.GOOGLE_OAUTH_CLIENT_ID;
    if (!expectedAud) return null; // fail closed — no audience to check against

    const parts = idToken.split(".");
    if (parts.length !== 3) return null;
    const headerB64 = parts[0], payloadB64 = parts[1], sigB64 = parts[2];
    if (!headerB64 || !payloadB64 || !sigB64) return null;

    const header = JSON.parse(new TextDecoder().decode(gb64urlToBytes(headerB64))) as { alg: string; kid?: string };
    if (header.alg !== "RS256" || !header.kid) return null;

    const certs = await fetch(GOOGLE_CERTS_URL, { cf: { cacheTtl: 3600, cacheEverything: true } as any });
    if (!certs.ok) return null;
    const { keys } = (await certs.json()) as { keys: GoogleJwk[] };
    const jwk = keys.find((k) => k.kid === header.kid);
    if (!jwk) return null;

    const key = await crypto.subtle.importKey(
      "jwk",
      { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );

    const signedInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
    const valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      gb64urlToBytes(sigB64),
      signedInput,
    );
    if (!valid) return null;

    const claims = JSON.parse(new TextDecoder().decode(gb64urlToBytes(payloadB64))) as {
      iss?: string; aud?: string; exp?: number; sub?: string;
      email?: string; email_verified?: boolean | string;
    };

    if (!claims.iss || !GOOGLE_ISSUERS.has(claims.iss)) return null;
    if (claims.aud !== expectedAud) return null;
    if (!claims.exp || claims.exp <= Math.floor(Date.now() / 1000)) return null;
    if (!claims.sub || !claims.email) return null;
    // Google encodes email_verified as boolean true or the string "true".
    if (claims.email_verified !== true && claims.email_verified !== "true") return null;

    return { sub: claims.sub, email: claims.email };
  } catch {
    return null;
  }
}
