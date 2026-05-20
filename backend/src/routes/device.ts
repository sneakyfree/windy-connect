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

  // Verify Google id_token if provided. When absent (v1 dev path) we accept
  // a raw email — see /pair page TODO.
  let verifiedEmail = google_email;
  let verifiedSub = google_sub;
  if (id_token) {
    const claims = await verifyGoogleIdToken(id_token, env);
    if (!claims) {
      return json({ error: "invalid_id_token" }, 401);
    }
    verifiedEmail = claims.email;
    verifiedSub = claims.sub;
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

/**
 * Verify a Google-issued id_token by checking the aud + signature against
 * Google's JWKS. v1 stub — implement using a JWKS-aware verifier (e.g.,
 * `jose` library or hand-rolled WebCrypto P-256 verify).
 *
 * Returns parsed claims on success, null on failure.
 */
async function verifyGoogleIdToken(
  _idToken: string,
  _env: Env,
): Promise<{ sub: string; email: string } | null> {
  // TODO: Implement using https://www.googleapis.com/oauth2/v3/certs JWKS.
  // For now, only the dev path (raw google_email) is supported.
  return null;
}
