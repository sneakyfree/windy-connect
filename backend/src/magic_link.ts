/**
 * Magic-link auth — sign/verify HS256 JWTs that prove the bearer owns the
 * email address the link was sent to.
 *
 * Design:
 *   - /v1/pair/start mints a JWT {user_code, email, exp, iat, iss} signed with
 *     MAGIC_LINK_SIGNING_KEY (HS256), sends it via Resend, and returns 202.
 *   - User clicks the link → GET /v1/pair/verify?token=<jwt>.
 *   - Verify checks signature, expiry, issuer; on success the session for
 *     user_code is marked approved with email = the JWT's email claim.
 *
 * Why HS256 and not ES256/RS256:
 *   - The signer and verifier are the same Worker. HS256 + a 256-bit secret
 *     is cryptographically sufficient and avoids the key-management cost of
 *     keypairs. If we ever need public-key verification (e.g. multiple
 *     services), upgrade then.
 *
 * Why magic-link and not Google OAuth:
 *   - One credential to rotate (signing key + Resend key) vs three
 *     (Google client ID + secret + verified domains + redirect URIs)
 *   - No Google-consent screen surface — grandma-friendlier UX
 *   - No GCP-console roundtrip for new redirect URIs
 *   - Works for users without Google accounts (Yahoo, Proton, Apple)
 *
 * Token TTL: 15 minutes (matches device-code session TTL).
 */

const ISSUER = "windy-connect";
const TTL_SECONDS = 900;

/**
 * Sign a magic-link JWT for the given user_code + email.
 */
export async function signMagicLink(
  signingKey: string,
  user_code: string,
  email: string,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    iss: ISSUER,
    user_code,
    email,
    iat: now,
    exp: now + TTL_SECONDS,
  };
  const encHeader = b64UrlEncodeString(JSON.stringify(header));
  const encPayload = b64UrlEncodeString(JSON.stringify(payload));
  const signingInput = `${encHeader}.${encPayload}`;
  const sig = await hmacSign(signingKey, signingInput);
  return `${signingInput}.${sig}`;
}

interface MagicLinkPayload {
  iss: string;
  user_code: string;
  email: string;
  iat: number;
  exp: number;
}

export type VerifyResult =
  | { ok: true; payload: MagicLinkPayload }
  | { ok: false; reason: string };

/**
 * Verify a magic-link JWT. Returns the payload on success or a reason
 * string for the user-facing error. Constant-time signature comparison
 * via WebCrypto's HMAC verify.
 */
export async function verifyMagicLink(
  signingKey: string,
  token: string,
): Promise<VerifyResult> {
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed token" };

  const signingInput = `${parts[0]}.${parts[1]}`;
  const sigOk = await hmacVerify(signingKey, signingInput, parts[2]);
  if (!sigOk) return { ok: false, reason: "invalid signature" };

  let payload: MagicLinkPayload;
  try {
    payload = JSON.parse(b64UrlDecodeString(parts[1])) as MagicLinkPayload;
  } catch {
    return { ok: false, reason: "malformed payload" };
  }
  if (payload.iss !== ISSUER) return { ok: false, reason: "wrong issuer" };
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now) return { ok: false, reason: "token expired" };
  if (payload.iat > now + 60) return { ok: false, reason: "token from the future" };
  if (typeof payload.user_code !== "string" || typeof payload.email !== "string") {
    return { ok: false, reason: "missing required claims" };
  }
  return { ok: true, payload };
}

// ----- internals -------------------------------------------------------------

async function hmacSign(key: string, data: string): Promise<string> {
  const cryptoKey = await importHmacKey(key);
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data));
  return b64UrlEncodeBytes(new Uint8Array(sig));
}

async function hmacVerify(key: string, data: string, sigB64: string): Promise<boolean> {
  const cryptoKey = await importHmacKey(key);
  const sig = b64UrlDecodeBytes(sigB64);
  return crypto.subtle.verify("HMAC", cryptoKey, sig, new TextEncoder().encode(data));
}

async function importHmacKey(key: string): Promise<CryptoKey> {
  // Signing key is hex-encoded 32 bytes (per the openssl rand -hex 32 we used).
  const keyBytes = hexToBytes(key);
  return crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

function b64UrlEncodeString(s: string): string {
  return b64UrlEncodeBytes(new TextEncoder().encode(s));
}

function b64UrlEncodeBytes(bytes: Uint8Array): string {
  let s = btoa(String.fromCharCode(...bytes));
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64UrlDecodeString(s: string): string {
  return new TextDecoder().decode(b64UrlDecodeBytes(s));
}

function b64UrlDecodeBytes(s: string): Uint8Array {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice(0, (4 - (s.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
