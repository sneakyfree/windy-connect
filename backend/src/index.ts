/**
 * Windy Connect Orchestrator — Cloudflare Worker entrypoint.
 *
 * Mints Eternitas Agent Credentials Bundles via Sign-in-with-Google + the
 * device-code OAuth flow (RFC 8628). Stateless coordinator; fans out to
 * Eternitas / Stalwart / Synapse / Mind to provision the four credential
 * blocks that make up a bundle.
 *
 * Routes:
 *   GET  /                          — landing redirect to /pair
 *   GET  /pair                      — HTML page where users enter the device code
 *   POST /v1/device/init            — CLI starts a pairing session
 *   POST /v1/device/poll            — CLI polls for the bundle
 *   POST /v1/pair/submit            — pair page submits the entered code
 *   GET  /v1/oauth/google/start     — kick off Google OAuth
 *   GET  /v1/oauth/google/callback  — receive Google OAuth code, mint bundle
 *   POST /v1/bundle/refresh         — refresh an expiring bundle
 *   GET  /healthz                   — liveness
 */

import { handleDeviceInit, handleDevicePoll, handlePairSubmit } from "./routes/device";
import { handleGoogleStart, handleGoogleCallback } from "./routes/oauth";
import { handleBundleRefresh } from "./routes/bundle";
import { handlePair } from "./routes/pair";
import { handleSkillsIndex, handleSkillMd } from "./routes/skills";
import { handleVersion } from "./routes/version";
// @ts-expect-error wrangler text-loader inlines the install script
import installSh from "../../installer/install.sh";

export interface Env {
  DEVICE_CODES?: KVNamespace;
  SESSIONS?: DurableObjectNamespace;

  // Public vars
  ETERNITAS_API_URL: string;
  STALWART_ADMIN_URL: string;
  STALWART_ADMIN_USER: string;
  ENABLE_REAL_PROVISIONING: string; // "true" | "false"
  ISSUER_NAME: string;
  ISSUER_URL: string; // brand identity (windyconnect.com) — used for bundle.issuer.url
  API_BASE_URL: string; // Worker-served host (api.windyconnect.com) — used for verification_uri + OAuth redirect

  // Build-time injected by backend/scripts/deploy.sh (optional — /version falls back if unset)
  COMMIT_SHA?: string;
  DEPLOYED_AT?: string;

  // Secrets (set with `wrangler secret put`)
  STALWART_ADMIN_PASS?: string;
  GOOGLE_OAUTH_CLIENT_ID?: string;
  GOOGLE_OAUTH_CLIENT_SECRET?: string;
  SYNAPSE_ADMIN_TOKEN?: string;
  MIND_ADMIN_TOKEN?: string;
}

export { DeviceSessions } from "./sessions_do";

export default {
  async fetch(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);

    // CORS preflight. Sensitive paths get strict-origin headers; everything
    // else gets `*` so the CLI (no Origin) and SDK callers work.
    if (req.method === "OPTIONS") {
      const path = url.pathname;
      const sensitive =
        path === "/v1/pair/submit" ||
        path.startsWith("/v1/oauth/");
      return new Response(null, {
        status: 204,
        headers: corsHeaders(req, sensitive),
      });
    }

    try {
      // get.windyconnect.com → serve installer.
      // `curl -fsSL https://get.windyconnect.com | sh` hits "/" so we return
      // the script regardless of path (curl-pipe ignores Location: anyway).
      if (url.hostname.startsWith("get.")) {
        return new Response(installSh as string, {
          status: 200,
          headers: {
            "content-type": "text/x-shellscript; charset=utf-8",
            "cache-control": "public, max-age=300",
          },
        });
      }
      if (url.pathname === "/" || url.pathname === "") {
        return Response.redirect(new URL("/pair", url).toString(), 302);
      }
      if (url.pathname === "/healthz") {
        return json({ ok: true, ts: new Date().toISOString() });
      }
      if (url.pathname === "/version" && req.method === "GET") {
        return handleVersion(req, env);
      }
      if (url.pathname === "/.well-known/skills/index.json" && req.method === "GET") {
        return handleSkillsIndex(req, env);
      }
      if (url.pathname === "/.well-known/skills/windy-access/SKILL.md" && req.method === "GET") {
        return handleSkillMd(req, env);
      }
      if (url.pathname === "/pair" && req.method === "GET") {
        return handlePair(req, env);
      }
      if (url.pathname === "/v1/device/init" && req.method === "POST") {
        // Rate limit per source IP via the SESSIONS DO sliding-window
        // counter. 10/min/IP is plenty for legit CLI use (one init per
        // `windy connect`) and caps trivial abuse.
        const ip = req.headers.get("cf-connecting-ip") ?? "unknown";
        const { rateLimitCheck } = await import("./store");
        const rl = await rateLimitCheck(env, `init:${ip}`, 10, 60);
        if (!rl.success) {
          return new Response(
            JSON.stringify({
              error: "rate_limited",
              error_description: "too many device-init requests; retry shortly",
              retry_after_seconds: rl.reset_in_seconds,
            }),
            {
              status: 429,
              headers: {
                "content-type": "application/json; charset=utf-8",
                "retry-after": String(rl.reset_in_seconds ?? 60),
                "access-control-allow-origin": "*",
              },
            },
          );
        }
        return handleDeviceInit(req, env);
      }
      if (url.pathname === "/v1/device/poll" && req.method === "POST") {
        return handleDevicePoll(req, env);
      }
      if (url.pathname === "/v1/pair/submit" && req.method === "POST") {
        return handlePairSubmit(req, env);
      }
      if (url.pathname === "/v1/oauth/google/start" && req.method === "GET") {
        return handleGoogleStart(req, env);
      }
      if (url.pathname === "/v1/oauth/google/callback" && req.method === "GET") {
        return handleGoogleCallback(req, env);
      }
      if (url.pathname === "/v1/bundle/refresh" && req.method === "POST") {
        return handleBundleRefresh(req, env);
      }
      return json({ error: "not_found", path: url.pathname }, 404);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return json({ error: "internal_error", detail: msg }, 500);
    }
  },
} satisfies ExportedHandler<Env>;

// Origin allow-list for endpoints that browsers (not the CLI) hit.
// The CLI sends no Origin header so `*` works for everything else.
const TRUSTED_BROWSER_ORIGINS = new Set([
  "https://api.windyconnect.com",
  "https://pair.windyconnect.com",
  "https://windyconnect.com",
  "https://www.windyconnect.com",
  "http://localhost:8787", // wrangler dev
  "http://localhost:5173", // vite dev (future marketing site)
]);

function corsHeaders(req?: Request, strictOrigin = false): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, x-csrf-token",
    "Access-Control-Max-Age": "86400",
  };
  if (strictOrigin && req) {
    const origin = req.headers.get("origin");
    if (origin && TRUSTED_BROWSER_ORIGINS.has(origin)) {
      headers["Access-Control-Allow-Origin"] = origin;
      headers["Access-Control-Allow-Credentials"] = "true";
      headers["Vary"] = "Origin";
    }
    // No origin OR untrusted origin → omit Allow-Origin entirely. The browser
    // will block the response. CLI tools (no Origin header) ignore this.
  } else {
    headers["Access-Control-Allow-Origin"] = "*";
  }
  return headers;
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...corsHeaders(),
    },
  });
}

/**
 * Sensitive JSON response — Origin-restricted CORS. Used by /v1/pair/submit
 * and /v1/oauth/* where the caller MUST be a known browser context.
 */
export function jsonStrict(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...corsHeaders(req, true),
    },
  });
}
