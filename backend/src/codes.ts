/**
 * Device-code + user-code generation.
 *
 * - device_code: opaque high-entropy token (32 bytes hex) — CLI keeps secret
 * - user_code: short human-typable (8 chars: 4-4 from a confusable-free alphabet)
 */

const HUMAN_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789"; // no 0/O/1/I/L/U
const USER_CODE_LEN = 8; // formatted as XXXX-XXXX

export function generateDeviceCode(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function generateUserCode(): string {
  const buf = new Uint8Array(USER_CODE_LEN);
  crypto.getRandomValues(buf);
  let raw = "";
  for (let i = 0; i < USER_CODE_LEN; i++) {
    raw += HUMAN_ALPHABET[buf[i]! % HUMAN_ALPHABET.length];
  }
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
}

export function normalizeUserCode(input: string): string {
  return input.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, USER_CODE_LEN);
}
