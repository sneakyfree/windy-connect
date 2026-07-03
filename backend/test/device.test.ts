/**
 * Security regression test for the /v1/pair/submit real-mode identity gate.
 *
 * In real-provisioning mode, the device-form path must NOT mint a real bundle
 * from a raw, unverified google_email (verifyGoogleIdToken is still a stub, so
 * the real pairing path is magic-link only). Without the gate, anyone with a
 * user_code + a trivially-obtained CSRF token could mint a real
 * Synapse/Mind/Mail/passport bundle bound to an arbitrary email they don't
 * control. The raw-email path stays open only when real provisioning is off.
 */
import { describe, expect, it, vi } from "vitest";
import { handlePairSubmit } from "../src/routes/device";
import type { Env } from "../src/index";

// Isolate the gate: CSRF passes, a pending session exists, provisioning stubbed.
// index.ts is mocked too — importing it for real pulls in text-imported
// SKILL.md/install.sh assets that vitest (unlike wrangler) can't transform.
// We only need its `json` Response helper here.
vi.mock("../src/index", () => ({
  json: (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json; charset=utf-8" },
    }),
}));
vi.mock("../src/routes/pair", () => ({ verifyCsrf: () => null }));
vi.mock("../src/store", () => ({
  getDeviceCodeByUserCode: async () => "dev_code_123",
  getByDeviceCode: async () => ({
    device_code: "dev_code_123",
    user_code: "ABCD-1234",
    tier: "credentialed",
    status: "pending",
    created_at: "2026-07-02T00:00:00Z",
    expires_at: new Date(Date.now() + 900_000).toISOString(),
  }),
  updateSession: async () => {},
  putSession: async () => {},
}));
vi.mock("../src/provision", () => ({
  provisionBundle: async () => ({ issuer: { name: "Windy Connect" } }),
}));

function submit(body: Record<string, unknown>): Request {
  return new Request("https://api.windyconnect.com/v1/pair/submit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("handlePairSubmit — real-mode identity gate", () => {
  it("real mode: raw google_email (no verified id_token) → 403 verification_required", async () => {
    const env = { ENABLE_REAL_PROVISIONING: "true" } as Env;
    const res = await handlePairSubmit(
      submit({ user_code: "ABCD1234", google_email: "attacker@evil.com" }),
      env,
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("verification_required");
  });

  it("dev/mock mode: raw google_email still allowed (gate does not fire)", async () => {
    const env = { ENABLE_REAL_PROVISIONING: "false" } as Env;
    const res = await handlePairSubmit(
      submit({ user_code: "ABCD1234", google_email: "dev@example.com" }),
      env,
    );
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });
});
