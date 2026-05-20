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

      default:
        return new Response(JSON.stringify({ error: "not_found", path: url.pathname }), {
          status: 404,
        });
    }
  }
}
