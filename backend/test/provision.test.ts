/**
 * Tests for the Wave B real-provisioning paths in src/provision.ts.
 *
 * provisionBundle fans out to Eternitas → Mail / Chat / Mind. The real
 * branches make outbound fetch calls; we stub fetch so the test
 * exercises the request shape (URL, headers, body) and the response
 * mapping into the Bundle without hitting any live service.
 *
 * What we care about regression-protecting:
 *   - Mail real path hits the windy-mail HTTP API with the right service
 *     token + body shape (eternitas_passport, agent_name, owner_id).
 *   - Mind real path hits POST /admin/keys with Bearer auth + returns
 *     the wm_* key in api_key.
 *   - Sandbox paths still emit deterministic "sandbox-" markers so
 *     anything calling them is obvious in agent logs.
 *   - Missing required secrets fail loudly with named errors rather
 *     than silently shipping a broken bundle.
 *   - Free tier doesn't try to call Mail's real endpoint (Mail requires
 *     an eternitas_passport, which free tier doesn't have).
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { provisionBundle } from "../src/provision";
import type { Env } from "../src/index";

// HS256 helper — base64url(JSON header).base64url(JSON payload).sig — we
// don't verify the sig in tests, only parse the `ope` claim.
function fakeEpt(payload: Record<string, unknown>): string {
  const b64 = (s: string) => Buffer.from(s).toString("base64url");
  return `${b64('{"alg":"ES256"}')}.${b64(JSON.stringify(payload))}.fakesig`;
}

function baseEnv(overrides: Partial<Env> = {}): Env {
  return {
    ETERNITAS_API_URL: "https://api.eternitas.ai",
    STALWART_ADMIN_URL: "https://mail.windymail.ai",
    STALWART_ADMIN_USER: "admin",
    ENABLE_REAL_PROVISIONING: "true",
    ISSUER_NAME: "Windy Connect",
    ISSUER_URL: "https://windyconnect.com",
    API_BASE_URL: "https://api.windyconnect.com",
    WINDY_MAIL_API_URL: "https://api.windymail.ai",
    WINDY_MIND_API_URL: "https://api.windymind.ai",
    WINDY_MAIL_SERVICE_TOKEN: "test-mail-service-token",
    MIND_ADMIN_TOKEN: "test-mind-admin-token",
    // SYNAPSE_ADMIN_TOKEN intentionally unset → Chat falls back to
    // sandbox values without throwing. Wave C will flip this on.
    ...overrides,
  } as Env;
}

describe("provisionBundle — real paths", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch");
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("credentialed tier: Mail call sends X-Service-Token + eternitas_passport, maps response into MailBlock", async () => {
    const passport = "ET26-TEST-0001";
    const ept = fakeEpt({ ope: "op_test_001", sub: passport });

    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (url: string, init?: RequestInit) => {
        if (url.endsWith("/api/v1/bots/auto-hatch")) {
          return new Response(
            JSON.stringify({
              passport,
              name: "alice-x",
              description: "",
              bot_type: "agent",
              status: "active",
              trust_score: 60,
              trust_ceiling: 100,
              contact_email: "alice@example.com",
              registered_at: "2026-05-21T00:00:00Z",
              expires_at: "2027-05-21T00:00:00Z",
              ept_token: ept,
            }),
            { status: 201 },
          );
        }
        if (url.endsWith("/api/v1/provision/bot")) {
          // Assert request shape inline so a regression surfaces here
          expect(init?.headers).toMatchObject({
            "X-Service-Token": "test-mail-service-token",
          });
          const body = JSON.parse(init?.body as string);
          expect(body.eternitas_passport).toBe(passport);
          expect(body.agent_name).toBe("alice");
          expect(body.owner_id).toBe("op_test_001");
          return new Response(
            JSON.stringify({
              account_id: "acct_abc123",
              email: "alice@windymail.ai",
              imap_host: "imap.windymail.ai",
              imap_port: 993,
              smtp_host: "smtp.windymail.ai",
              smtp_port: 587,
              jmap_url: "https://jmap.windymail.ai/jmap",
              username: "alice@windymail.ai",
              password: "mail-raw-pw",
              jmap_token: "mail-fernet-encrypted-pw",
              tier: "free",
            }),
            { status: 201 },
          );
        }
        if (url.endsWith("/admin/keys")) {
          return new Response(
            JSON.stringify({
              key: "wm_a1b2c3d4_realkeyrealkey",
              key_id: "a1b2c3d4",
              subject_email: "alice@example.com",
              tier: "credentialed",
              created_at: "2026-05-21T00:00:00Z",
              expires_at: "2027-05-21T00:00:00Z",
              issued_by: "windy-connect-orchestrator",
            }),
            { status: 201 },
          );
        }
        throw new Error(`unexpected fetch: ${url}`);
      },
    );

    const bundle = await provisionBundle(baseEnv(), {
      tier: "credentialed",
      google_email: "alice@example.com",
      google_sub: "google-sub-1",
    });

    // Skip Chat — it still throws on real (Wave C wires it). For this
    // test we trust the existing sandbox/real split; Chat is exercised
    // separately below.
    expect(bundle.windy_mail?.address).toBe("alice@windymail.ai");
    expect(bundle.windy_mail?.imap?.password).toBe("mail-raw-pw");
    // jmap.password is the Fernet-encrypted token, not the raw password.
    expect(bundle.windy_mail?.jmap?.password).toBe("mail-fernet-encrypted-pw");
    expect(bundle.windy_mail?.jmap?.account_id).toBe("acct_abc123");

    expect(bundle.windy_mind?.api_key).toBe("wm_a1b2c3d4_realkeyrealkey");
    expect(bundle.windy_mind?.base_url).toBe("https://api.windymind.ai/v1");

    expect(bundle.eternitas?.passport).toBe(passport);
    expect(bundle.eternitas?.operator_id).toBe("op_test_001");
  });

  it("Mind real path sends Bearer auth + subject_email/tier body", async () => {
    let mindReq: { url: string; init?: RequestInit } | null = null;
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (url: string, init?: RequestInit) => {
        if (url.endsWith("/admin/keys")) {
          mindReq = { url, init };
          return new Response(
            JSON.stringify({
              key: "wm_xx_yy",
              key_id: "xx",
              subject_email: "u@x.com",
              tier: "free",
              created_at: "2026-05-21T00:00:00Z",
              expires_at: "2027-05-21T00:00:00Z",
              issued_by: "windy-connect-orchestrator",
            }),
            { status: 201 },
          );
        }
        // No Eternitas call for free tier; Mail will sandbox.
        throw new Error(`unexpected fetch: ${url}`);
      },
    );

    await provisionBundle(baseEnv(), {
      tier: "free",
      google_email: "u@x.com",
      google_sub: "g1",
    });

    expect(mindReq).not.toBeNull();
    expect(mindReq!.init?.headers).toMatchObject({
      authorization: "Bearer test-mind-admin-token",
    });
    expect(JSON.parse(mindReq!.init?.body as string)).toEqual({
      subject_email: "u@x.com",
      tier: "free",
    });
  });

  it("free tier: Mail falls back to sandbox values, does NOT call Mail API", async () => {
    let mailCalled = false;
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (url: string) => {
        if (url.endsWith("/api/v1/provision/bot")) {
          mailCalled = true;
        }
        if (url.endsWith("/admin/keys")) {
          return new Response(
            JSON.stringify({
              key: "wm_free_test",
              key_id: "ft",
              subject_email: "u@x.com",
              tier: "free",
              created_at: "2026-05-21T00:00:00Z",
              expires_at: null,
              issued_by: "windy-connect-orchestrator",
            }),
            { status: 201 },
          );
        }
        throw new Error(`unexpected fetch: ${url}`);
      },
    );

    const bundle = await provisionBundle(baseEnv(), {
      tier: "free",
      google_email: "u@x.com",
      google_sub: "g1",
    });

    expect(mailCalled).toBe(false);
    expect(bundle.windy_mail?.imap?.password).toBe("sandbox-pass-u");
    expect(bundle.windy_mail?.address).toBe("u@windymail.ai");
    expect(bundle.eternitas).toBeUndefined();
  });

  it("real=true but WINDY_MAIL_SERVICE_TOKEN unset → named error, not silent failure", async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (url: string) =>
        url.endsWith("/api/v1/bots/auto-hatch")
          ? new Response(
              JSON.stringify({
                passport: "ET26-X-1",
                name: "x",
                description: "",
                bot_type: "agent",
                status: "active",
                trust_score: 50,
                trust_ceiling: 100,
                contact_email: "u@x.com",
                registered_at: "2026-05-21T00:00:00Z",
                expires_at: "2027-05-21T00:00:00Z",
                ept_token: fakeEpt({ ope: "op_1" }),
              }),
              { status: 201 },
            )
          : new Response("{}", { status: 200 }),
    );

    const env = baseEnv({ WINDY_MAIL_SERVICE_TOKEN: undefined });
    await expect(
      provisionBundle(env, { tier: "credentialed", google_email: "u@x.com", google_sub: "g" }),
    ).rejects.toThrow(/WINDY_MAIL_SERVICE_TOKEN/);
  });

  it("real=true but MIND_ADMIN_TOKEN unset → named error", async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response("{}", { status: 200 }),
    );
    const env = baseEnv({ MIND_ADMIN_TOKEN: undefined });
    await expect(
      provisionBundle(env, { tier: "free", google_email: "u@x.com", google_sub: "g" }),
    ).rejects.toThrow(/MIND_ADMIN_TOKEN/);
  });

  it("Mail API non-2xx → error includes status + body for ops triage", async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (url: string) => {
        if (url.endsWith("/api/v1/bots/auto-hatch")) {
          return new Response(
            JSON.stringify({
              passport: "ET26-X-1",
              name: "x",
              description: "",
              bot_type: "agent",
              status: "active",
              trust_score: 50,
              trust_ceiling: 100,
              contact_email: "u@x.com",
              registered_at: "2026-05-21T00:00:00Z",
              expires_at: "2027-05-21T00:00:00Z",
              ept_token: fakeEpt({ ope: "op_1" }),
            }),
            { status: 201 },
          );
        }
        if (url.endsWith("/api/v1/provision/bot")) {
          return new Response("eternitas_passport: pattern mismatch", { status: 422 });
        }
        return new Response("{}", { status: 200 });
      },
    );
    await expect(
      provisionBundle(baseEnv(), {
        tier: "credentialed",
        google_email: "u@x.com",
        google_sub: "g",
      }),
    ).rejects.toThrow(/422.*eternitas_passport/);
  });
});

describe("provisionBundle — sandbox path", () => {
  it("ENABLE_REAL_PROVISIONING=false produces sandbox-marked bundles with no outbound fetches", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    const env = baseEnv({ ENABLE_REAL_PROVISIONING: "false" });
    const bundle = await provisionBundle(env, {
      tier: "free",
      google_email: "grandma@example.com",
      google_sub: "g1",
    });
    expect(spy).not.toHaveBeenCalled();
    expect(bundle.windy_mail?.imap?.password).toContain("sandbox-");
    expect(bundle.windy_mind?.api_key).toContain("wm_sandbox_");
    spy.mockRestore();
  });
});
