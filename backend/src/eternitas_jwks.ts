/**
 * Eternitas Passport Token (EPT) signature verification.
 *
 * EPTs are ES256-signed JWTs minted by api.eternitas.ai. Public keys are
 * served at `{ETERNITAS_API_URL}/.well-known/eternitas-keys` as a JWK
 * Set, e.g.:
 *
 *   { "keys": [
 *       { "kty": "EC", "crv": "P-256",
 *         "x": "...", "y": "...",
 *         "kid": "...", "use": "sig", "alg": "ES256" }
 *   ] }
 *
 * Verification flow (matches the eternitas-side issuer, RFC 7515 §A.4):
 *   1. Parse the JWT into [header.payload.signature]
 *   2. Fetch JWKS, match by `kid`, convert the JWK to a WebCrypto key
 *   3. crypto.subtle.verify('ECDSA' / P-256 / SHA-256, key, signature, message)
 *   4. Check `exp`
 *
 * Caching: JWKS are fetched into the `caches.default` namespace for 10
 * minutes. A real key rotation is rare; if we're worried about a fast
 * rotation we can shorten the TTL or expose a /admin/jwks-bust route.
 *
 * Failure mode: any signature failure, missing kid, or 4xx/5xx from
 * eternitas → returns { ok: false, reason } so the caller renders a
 * clean 401 rather than a 500. We don't want to fail-open here.
 */

import type { Env } from "./index";

const JWKS_CACHE_TTL_SECONDS = 600;
const JWKS_CACHE_KEY_PREFIX = "https://cache.windyconnect.com/eternitas-jwks/";

export interface DecodedEpt {
  sub?: string; // passport
  iss?: string;
  email?: string;
  exp?: number;
  ope?: string;
  // ... other claims as Eternitas adds them
  [key: string]: unknown;
}

export type VerifyResult =
  | { ok: true; claims: DecodedEpt; kid: string }
  | { ok: false; reason: string };

interface Jwk {
  kty: string;
  crv?: string;
  x?: string;
  y?: string;
  kid: string;
  alg?: string;
  use?: string;
}

interface JwkSet {
  keys: Jwk[];
}

interface JwtHeader {
  alg: string;
  typ?: string;
  kid?: string;
}

const b64urlToBytes = (s: string): Uint8Array => {
  const pad = (str: string) => str + "===".slice(0, (4 - (str.length % 4)) % 4);
  const std = pad(s.replace(/-/g, "+").replace(/_/g, "/"));
  const bin = atob(std);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

const b64urlToJson = <T>(s: string): T =>
  JSON.parse(new TextDecoder().decode(b64urlToBytes(s))) as T;

/**
 * Fetch + cache the Eternitas JWKS. Returns the parsed JWK Set or
 * throws if the upstream is unreachable (handled by the caller as a
 * verification failure).
 */
async function fetchJwks(env: Env): Promise<JwkSet> {
  const base = env.ETERNITAS_API_URL ?? "https://api.eternitas.ai";
  const url = `${base}/.well-known/eternitas-keys`;

  // Cache key uses a stable internal URL so two Workers with different
  // ETERNITAS_API_URL values (dev vs prod) don't share entries.
  // `caches.default` is a Workers global; absent in plain Node test
  // environments → skip cache transparently in that case.
  const cacheAvailable =
    typeof caches !== "undefined" &&
    (caches as unknown as { default?: Cache }).default !== undefined;
  const cacheKey = cacheAvailable
    ? new Request(`${JWKS_CACHE_KEY_PREFIX}${encodeURIComponent(base)}`)
    : null;
  if (cacheKey) {
    const cached = await caches.default.match(cacheKey);
    if (cached) {
      return (await cached.json()) as JwkSet;
    }
  }

  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`jwks fetch ${res.status}`);
  }
  const jwks = (await res.json()) as JwkSet;

  if (cacheKey) {
    // Cache via the response itself with an internal Cache-Control. We
    // re-wrap to ensure no upstream Cache-Control sneaks in a longer TTL.
    const cacheRes = new Response(JSON.stringify(jwks), {
      headers: {
        "content-type": "application/json",
        "cache-control": `public, max-age=${JWKS_CACHE_TTL_SECONDS}`,
      },
    });
    await caches.default.put(cacheKey, cacheRes);
  }
  return jwks;
}

async function jwkToCryptoKey(jwk: Jwk): Promise<CryptoKey> {
  if (jwk.kty !== "EC" || jwk.crv !== "P-256") {
    throw new Error(`unsupported JWK kty=${jwk.kty} crv=${jwk.crv}`);
  }
  return crypto.subtle.importKey(
    "jwk",
    { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, ext: true },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
}

/**
 * Verify an EPT against Eternitas JWKS.
 *
 * Returns { ok: true, claims, kid } on success, or { ok: false, reason }
 * otherwise. Never throws — the caller maps reason → 401 body.
 */
export async function verifyEpt(env: Env, jwt: string): Promise<VerifyResult> {
  const parts = jwt.split(".");
  if (parts.length !== 3) {
    return { ok: false, reason: "malformed JWT (expected 3 parts)" };
  }
  // Non-null asserts: parts.length === 3 above guarantees these exist.
  // TS's tuple-index narrowing doesn't follow length checks across an
  // assignment, so the asserts are the minimal way to satisfy strict mode.
  const headerB64 = parts[0]!;
  const payloadB64 = parts[1]!;
  const signatureB64 = parts[2]!;

  let header: JwtHeader;
  let claims: DecodedEpt;
  try {
    header = b64urlToJson<JwtHeader>(headerB64);
    claims = b64urlToJson<DecodedEpt>(payloadB64);
  } catch {
    return { ok: false, reason: "malformed JWT (bad base64 or JSON)" };
  }

  if (header.alg !== "ES256") {
    return { ok: false, reason: `unsupported alg: ${header.alg}` };
  }
  if (!header.kid) {
    return { ok: false, reason: "missing kid in JWT header" };
  }

  let jwks: JwkSet;
  try {
    jwks = await fetchJwks(env);
  } catch (e) {
    return {
      ok: false,
      reason: `JWKS unreachable: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  const jwk = jwks.keys.find((k) => k.kid === header.kid);
  if (!jwk) {
    return { ok: false, reason: `unknown kid: ${header.kid}` };
  }

  let key: CryptoKey;
  try {
    key = await jwkToCryptoKey(jwk);
  } catch (e) {
    return {
      ok: false,
      reason: `JWK import failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const signedInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signature = b64urlToBytes(signatureB64);

  // P-256 ECDSA signature is 64 bytes (r || s). Some libraries emit
  // DER; WebCrypto wants raw. The eternitas issuer emits raw per the
  // SoT in eternitas/api/app/services/ept.py, so we don't convert.
  if (signature.length !== 64) {
    return { ok: false, reason: `unexpected signature length: ${signature.length}` };
  }

  const valid = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    signature,
    signedInput,
  );
  if (!valid) {
    return { ok: false, reason: "signature mismatch" };
  }

  if (typeof claims.exp === "number" && claims.exp * 1000 < Date.now()) {
    // Note: the bundle refresh route has its OWN, more permissive exp
    // check (allows up to 7 days past expiry for a refresh). We let
    // signature-verified-but-expired tokens through here and let the
    // caller decide the policy.
  }

  return { ok: true, claims, kid: header.kid };
}
