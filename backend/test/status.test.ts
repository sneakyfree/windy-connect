/**
 * Wave I — /v1/status JSON shape + rollup logic.
 *
 * Mocks each upstream individually so a failure isolated to one
 * component surfaces correctly in the response. Critical because the
 * monitoring system reads `overall` to decide if it pages someone.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { handleStatusJson } from "../src/routes/status";
import type { Env } from "../src/index";

function env(overrides: Partial<Env> = {}): Env {
  return {
    ETERNITAS_API_URL: "https://api.eternitas.ai",
    STALWART_ADMIN_URL: "https://mail.windymail.ai",
    STALWART_ADMIN_USER: "admin",
    ENABLE_REAL_PROVISIONING: "true",
    ISSUER_NAME: "Windy Connect",
    ISSUER_URL: "https://windyconnect.com",
    API_BASE_URL: "https://api.windyconnect.com",
    WINDY_MIND_API_URL: "https://api.windymind.ai",
    WINDY_MAIL_API_URL: "https://api.windymail.ai",
    ...overrides,
  } as Env;
}

describe("handleStatusJson", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch");
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("all upstreams 200 → overall:ok, every component:ok or unconfigured", async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async () => new Response("{}", { status: 200 }),
    );
    const res = await handleStatusJson(env());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.overall).toBe("ok");
    expect(body.components).toHaveLength(5);
    // Eternitas + Mind are unconditional probes — both should be ok.
    expect(body.components.find((c: any) => c.name === "eternitas").status).toBe("ok");
    expect(body.components.find((c: any) => c.name === "windy_mind").status).toBe("ok");
  });

  it("mail unconfigured (no service token) → status:unconfigured, doesn't degrade rollup", async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async () => new Response("{}", { status: 200 }),
    );
    const e = env({ WINDY_MAIL_SERVICE_TOKEN: undefined } as Partial<Env>);
    const res = await handleStatusJson(e);
    const body = await res.json();
    const mail = body.components.find((c: any) => c.name === "windy_mail");
    expect(mail.status).toBe("unconfigured");
    expect(mail.hint).toMatch(/WINDY_MAIL_SERVICE_TOKEN/);
    expect(body.overall).toBe("ok"); // unconfigured doesn't drag rollup down
  });

  it("eternitas down → overall:down", async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (url: string) => {
        if (url.includes("eternitas")) throw new Error("connection refused");
        return new Response("{}", { status: 200 });
      },
    );
    const res = await handleStatusJson(env());
    const body = await res.json();
    expect(body.overall).toBe("down");
    expect(body.components.find((c: any) => c.name === "eternitas").status).toBe("down");
  });

  it("mind 500 → status:degraded, overall:degraded", async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (url: string) => {
        if (url.includes("windymind") || url.includes("api.windymind.ai")) {
          return new Response("upstream timeout", { status: 502 });
        }
        return new Response("{}", { status: 200 });
      },
    );
    const res = await handleStatusJson(env());
    const body = await res.json();
    expect(body.overall).toBe("degraded");
    const mind = body.components.find((c: any) => c.name === "windy_mind");
    expect(mind.status).toBe("degraded");
    expect(mind.hint).toMatch(/502/);
  });

  it("synapse gateway-token-only configured (no admin token) → still unconfigured", async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async () => new Response("{}", { status: 200 }),
    );
    const e = env({
      SYNAPSE_ADMIN_GATEWAY_TOKEN: "gw-only",
    } as Partial<Env>);
    const res = await handleStatusJson(e);
    const body = await res.json();
    const chat = body.components.find((c: any) => c.name === "windy_chat");
    expect(chat.status).toBe("unconfigured");
  });

  it("status response always 200 even on multiple downs (don't conflate worker with upstream)", async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async () => {
        throw new Error("everything is on fire");
      },
    );
    const res = await handleStatusJson(env());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.overall).toBe("down");
    // No throw — the Worker is fine, the upstreams aren't.
  });

  it("includes worker_version + checked_at for monitoring correlation", async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async () => new Response("{}", { status: 200 }),
    );
    const e = env({ COMMIT_SHA: "abc1234" } as Partial<Env>);
    const res = await handleStatusJson(e);
    const body = await res.json();
    expect(body.worker_version).toBe("abc1234");
    expect(body.checked_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
