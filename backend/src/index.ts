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

export interface Env {
  DEVICE_CODES?: KVNamespace;

  // Public vars
  ETERNITAS_API_URL: string;
  STALWART_ADMIN_URL: string;
  STALWART_ADMIN_USER: string;
  ENABLE_REAL_PROVISIONING: string; // "true" | "false"
  ISSUER_NAME: string;
  ISSUER_URL: string;

  // Secrets (set with `wrangler secret put`)
  STALWART_ADMIN_PASS?: string;
  GOOGLE_OAUTH_CLIENT_ID?: string;
  GOOGLE_OAUTH_CLIENT_SECRET?: string;
  SYNAPSE_ADMIN_TOKEN?: string;
  MIND_ADMIN_TOKEN?: string;
}

export default {
  async fetch(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);

    // CORS preflight for the CLI calling from anywhere
    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(),
      });
    }

    try {
      if (url.pathname === "/" || url.pathname === "") {
        return Response.redirect(new URL("/pair", url).toString(), 302);
      }
      if (url.pathname === "/healthz") {
        return json({ ok: true, ts: new Date().toISOString() });
      }
      if (url.pathname === "/pair" && req.method === "GET") {
        return handlePair(req, env);
      }
      if (url.pathname === "/v1/device/init" && req.method === "POST") {
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

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Max-Age": "86400",
  };
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
