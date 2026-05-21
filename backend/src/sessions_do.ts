/**
 * Durable Object backing the device-code pair-session store.
 *
 * KV namespace creation requires Cloudflare dashboard access (none of the
 * tokens in the lockbox have `Workers KV:Edit` scope). Durable Objects are
 * code-defined — they create themselves at deploy time and survive across
 * Worker isolates, which is exactly what RFC 8628 device-code pairing
 * needs: the CLI hits /v1/device/init on isolate A and polls
 * /v1/device/poll repeatedly on whichever isolates the load balancer picks.
 *
 * Design:
 *   - One globally-shared DO instance (id = "sessions") holds all in-flight
 *     pair sessions. Single hot spot is fine — pair traffic is sparse and
 *     each request is <5ms of CPU.
 *   - DO storage (transactional, persistent) backs the Map; we don't rely
 *     on RAM survival across hibernation.
 *   - TTL is enforced lazily on read: expired entries are deleted on miss.
 *
 * Request protocol (internal): POST /set, /get, /delete with JSON body
 *   {key, value?, ttl_seconds?}. The Worker side wraps these via a typed
 *   helper in store.ts.
 */

export interface SessionRecord {
  value: string;
  expires_at_unix: number;
}

export class DeviceSessions {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const body = (await request.json().catch(() => ({}))) as {
      key?: string;
      value?: string;
      ttl_seconds?: number;
    };
    const key = body.key;
    if (!key) {
      return new Response(JSON.stringify({ error: "missing_key" }), { status: 400 });
    }

    switch (url.pathname) {
      case "/set": {
        if (body.value === undefined) {
          return new Response(JSON.stringify({ error: "missing_value" }), { status: 400 });
        }
        const ttl = body.ttl_seconds ?? 900;
        const record: SessionRecord = {
          value: body.value,
          expires_at_unix: Math.floor(Date.now() / 1000) + ttl,
        };
        await this.state.storage.put(key, record);
        return new Response(JSON.stringify({ ok: true }), {
          headers: { "content-type": "application/json" },
        });
      }

      case "/get": {
        const record = await this.state.storage.get<SessionRecord>(key);
        if (!record) {
          return new Response(JSON.stringify({ value: null }), {
            headers: { "content-type": "application/json" },
          });
        }
        if (record.expires_at_unix < Math.floor(Date.now() / 1000)) {
          await this.state.storage.delete(key);
          return new Response(JSON.stringify({ value: null }), {
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ value: record.value }), {
          headers: { "content-type": "application/json" },
        });
      }

      case "/delete": {
        await this.state.storage.delete(key);
        return new Response(JSON.stringify({ ok: true }), {
          headers: { "content-type": "application/json" },
        });
      }

      case "/ratelimit": {
        // Sliding-window rate limit. body.key is e.g. "init:<ip>".
        // body.limit + body.period_seconds define the bucket.
        const limit = (body as { limit?: number }).limit ?? 10;
        const periodSeconds = (body as { period_seconds?: number }).period_seconds ?? 60;
        const nowMs = Date.now();
        const cutoffMs = nowMs - periodSeconds * 1000;

        const bucketKey = `rl:${key}`;
        const bucket = (await this.state.storage.get<number[]>(bucketKey)) ?? [];
        // Drop timestamps outside the window
        const fresh = bucket.filter((t) => t > cutoffMs);
        if (fresh.length >= limit) {
          // Persist the pruned bucket so the next call sees current state.
          if (fresh.length !== bucket.length) {
            await this.state.storage.put(bucketKey, fresh);
          }
          return new Response(
            JSON.stringify({
              success: false,
              remaining: 0,
              reset_in_seconds: Math.ceil((fresh[0] + periodSeconds * 1000 - nowMs) / 1000),
            }),
            { headers: { "content-type": "application/json" } },
          );
        }
        fresh.push(nowMs);
        await this.state.storage.put(bucketKey, fresh);
        // Also set an alarm for cleanup — but only if not already set
        return new Response(
          JSON.stringify({ success: true, remaining: limit - fresh.length }),
          { headers: { "content-type": "application/json" } },
        );
      }

      default:
        return new Response(JSON.stringify({ error: "not_found", path: url.pathname }), {
          status: 404,
        });
    }
  }
}
