/**
 * Persistent storage for device-code sessions.
 *
 * Uses Workers KV when bound; falls back to an in-memory Map for `wrangler dev`
 * without KV (single-process; not safe in production with multiple instances).
 */

import type { Env } from "./index";
import type { DeviceSession } from "./types";

const TTL_SECONDS = 900; // 15 minutes — RFC 8628 recommends ≤30 min

const memory = new Map<string, DeviceSession>();

function deviceKey(deviceCode: string): string {
  return `device:${deviceCode}`;
}
function userKey(userCode: string): string {
  return `user:${userCode}`;
}

export async function putSession(env: Env, session: DeviceSession): Promise<void> {
  if (env.DEVICE_CODES) {
    const payload = JSON.stringify(session);
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
  memory.set(deviceKey(session.device_code), session);
  memory.set(userKey(session.user_code), session as unknown as DeviceSession);
}

export async function getByDeviceCode(env: Env, deviceCode: string): Promise<DeviceSession | null> {
  if (env.DEVICE_CODES) {
    const raw = await env.DEVICE_CODES.get(deviceKey(deviceCode));
    return raw ? (JSON.parse(raw) as DeviceSession) : null;
  }
  return (memory.get(deviceKey(deviceCode)) as DeviceSession | undefined) ?? null;
}

export async function getDeviceCodeByUserCode(env: Env, userCode: string): Promise<string | null> {
  if (env.DEVICE_CODES) {
    return env.DEVICE_CODES.get(userKey(userCode));
  }
  const v = memory.get(userKey(userCode));
  // memory store keys both ways to the same value; user→device direction holds the device_code string
  if (typeof v === "string") return v;
  if (v && typeof (v as DeviceSession).device_code === "string") {
    return (v as DeviceSession).device_code;
  }
  return null;
}

export async function updateSession(env: Env, session: DeviceSession): Promise<void> {
  await putSession(env, session);
}
