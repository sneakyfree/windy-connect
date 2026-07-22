/**
 * fetchWithTimeout — a bounded replacement for bare `fetch` on outbound
 * upstream calls.
 *
 * Why this exists: the provisioning fan-out (Eternitas, Mail, Mind, Synapse)
 * and the auth/email helpers all called the global `fetch` with no timeout.
 * A single hung upstream would stall the whole `provisionBundle` fan-out (and
 * therefore the user's pair) up to the Worker's wall-clock ceiling, turning a
 * slow dependency into a hard onboarding failure with no diagnostic.
 *
 * This wraps the existing `AbortController` pattern already used in
 * routes/status.ts so every upstream call is bounded and, on timeout, throws a
 * predictable AbortError the caller's existing error handling surfaces — never
 * a silent hang.
 *
 * Internal Durable-Object calls (store.ts / sessions_do.ts) are intentionally
 * NOT routed through this — they are same-isolate and not subject to remote
 * network stalls.
 */

/** Default ceiling for a single outbound upstream request. */
export const DEFAULT_FETCH_TIMEOUT_MS = 10_000;

/**
 * Like `fetch`, but aborts after `timeoutMs`. All RequestInit options
 * (including Cloudflare-specific `cf` cache directives) are preserved; only
 * `signal` is supplied by the wrapper.
 */
export async function fetchWithTimeout(
  input: string,
  init?: RequestInit,
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
