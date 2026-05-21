/**
 * Persistent storage for device-code sessions.
 *
 * Lookup order:
 *   1. Workers KV (env.DEVICE_CODES)        — preferred; auto-TTL, multi-key.
 *   2. Durable Object (env.SESSIONS)        — fallback because none of the
 *                                              tokens in the lockbox can
 *                                              create KV namespaces; DOs are
 *                                              code-defined and deploy
 *                                              without dashboard.
 *   3. In-memory Map                        — `wrangler dev` only; not safe
 *                                              across isolates.
 */

import type { Env } from "./index";
import type { DeviceSession } from "./types";

const TTL_SECONDS = 900; // 15 minutes — RFC 8628 recommends ≤30 min

const memory = new Map<string, DeviceSession | string>();

function deviceKey(deviceCode: string): string {
  return `device:${deviceCode}`;
}
function userKey(userCode: string): string {
  return `user:${userCode}`;
}

async function doFetch(
  env: Env,
  path: "set" | "get" | "delete",
  body: { key: string; value?: string; ttl_seconds?: number },
): Promise<Response> {
  const stub = env.SESSIONS!.get(env.SESSIONS!.idFromName("sessions"));
  // The DO does not actually look at the host portion of the URL; we use a
  // placeholder so URL() parses cleanly.
  return stub.fetch(`https://do/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function putSession(env: Env, session: DeviceSession): Promise<void> {
  const payload = JSON.stringify(session);

  if (env.DEVICE_CODES) {
    await Promise.all([
      env.DEVICE_CODES.put(deviceKey(session.device_code), payload, {
        expirationTtl: TTL_SECONDS,
      }),
      env.DEVICE_CODES.put(userKey(session.user_code), session.device_code, {
        expirationTtl: TTL_SECONDS,
      }),
    ]);
    return;
  }

  if (env.SESSIONS) {
    await Promise.all([
      doFetch(env, "set", {
        key: deviceKey(session.device_code),
        value: payload,
        ttl_seconds: TTL_SECONDS,
      }),
      doFetch(env, "set", {
        key: userKey(session.user_code),
        value: session.device_code,
        ttl_seconds: TTL_SECONDS,
      }),
    ]);
    return;
  }

  memory.set(deviceKey(session.device_code), session);
  memory.set(userKey(session.user_code), session.device_code);
}

export async function getByDeviceCode(
  env: Env,
  deviceCode: string,
): Promise<DeviceSession | null> {
  if (env.DEVICE_CODES) {
    const raw = await env.DEVICE_CODES.get(deviceKey(deviceCode));
    return raw ? (JSON.parse(raw) as DeviceSession) : null;
  }

  if (env.SESSIONS) {
    const res = await doFetch(env, "get", { key: deviceKey(deviceCode) });
    const { value } = (await res.json()) as { value: string | null };
    return value ? (JSON.parse(value) as DeviceSession) : null;
  }

  const m = memory.get(deviceKey(deviceCode));
  return (m && typeof m !== "string" ? (m as DeviceSession) : null);
}

export async function getDeviceCodeByUserCode(
  env: Env,
  userCode: string,
): Promise<string | null> {
  if (env.DEVICE_CODES) {
    return env.DEVICE_CODES.get(userKey(userCode));
  }

  if (env.SESSIONS) {
    const res = await doFetch(env, "get", { key: userKey(userCode) });
    const { value } = (await res.json()) as { value: string | null };
    return value;
  }

  const v = memory.get(userKey(userCode));
  if (typeof v === "string") return v;
  if (v && typeof (v as DeviceSession).device_code === "string") {
    return (v as DeviceSession).device_code;
  }
  return null;
}

export async function updateSession(env: Env, session: DeviceSession): Promise<void> {
  await putSession(env, session);
}

/**
 * Per-key rate limit via the SESSIONS Durable Object. Returns true if the
 * request fits within the bucket, false if it should be rejected.
 *
 * Globally consistent (single DO instance) — accurate even under high
 * fan-out across colos. ~5ms overhead per call.
 */
export async function rateLimitCheck(
  env: Env,
  key: string,
  limit: number,
  periodSeconds: number,
): Promise<{ success: boolean; remaining: number; reset_in_seconds?: number }> {
  if (!env.SESSIONS) return { success: true, remaining: limit };
  const stub = env.SESSIONS.get(env.SESSIONS.idFromName("sessions"));
  const res = await stub.fetch("https://do/ratelimit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ key, limit, period_seconds: periodSeconds }),
  });
  return res.json();
}
