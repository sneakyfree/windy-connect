import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchWithTimeout, DEFAULT_FETCH_TIMEOUT_MS } from "../src/http";

describe("fetchWithTimeout", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("returns the response when the upstream answers in time", async () => {
    const expected = new Response("ok", { status: 200 });
    const spy = vi.stubGlobal(
      "fetch",
      vi.fn(async () => expected),
    );
    void spy;
    const res = await fetchWithTimeout("https://upstream.example/ok");
    expect(res.status).toBe(200);
  });

  it("passes an AbortSignal through to fetch and clears the timer on success", async () => {
    const seen: RequestInit[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init) seen.push(init);
        return new Response("ok", { status: 200 });
      }),
    );
    await fetchWithTimeout("https://upstream.example/ok", { method: "GET" });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.signal).toBeInstanceOf(AbortSignal);
    expect(seen[0]?.method).toBe("GET"); // caller init preserved
  });

  it("aborts a hanging upstream after the timeout instead of stalling forever", async () => {
    // A fetch that only settles when its signal fires — i.e. a hung upstream.
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            const signal = init?.signal;
            if (signal) {
              signal.addEventListener("abort", () =>
                reject(new DOMException("The operation was aborted.", "AbortError")),
              );
            }
          }),
      ),
    );
    await expect(
      fetchWithTimeout("https://upstream.example/hang", undefined, 20),
    ).rejects.toThrowError(/abort/i);
  });

  it("exposes a sane default ceiling", () => {
    expect(DEFAULT_FETCH_TIMEOUT_MS).toBeGreaterThan(0);
    expect(DEFAULT_FETCH_TIMEOUT_MS).toBeLessThanOrEqual(30_000);
  });
});
