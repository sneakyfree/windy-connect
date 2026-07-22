/**
 * Google OAuth — Authorization Code flow for the /pair page.
 *
 * v1: skeleton. The flow works but the id_token verification step is stubbed
 * (see verifyGoogleIdToken in routes/device.ts). Until verification is wired,
 * the /pair page operates in "dev mode" — accepts a raw email instead of a
 * Google id_token. Document this clearly to users; never deploy with this
 * path open to the public internet (gate with ENABLE_REAL_PROVISIONING).
 */

import type { Env } from "../index";
import { json } from "../index";
import { fetchWithTimeout } from "../http";

const GOOGLE_SCOPES = ["openid", "email", "profile"].join(" ");

export async function handleGoogleStart(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const userCode = url.searchParams.get("code") ?? "";

  if (!env.GOOGLE_OAUTH_CLIENT_ID) {
    return json(
      {
        error: "google_oauth_not_configured",
        detail:
          "GOOGLE_OAUTH_CLIENT_ID secret is unset. Create a GCP project " +
          "'windy-connect-oauth' and run `wrangler secret put GOOGLE_OAUTH_CLIENT_ID`.",
      },
      503,
    );
  }

  const redirectUri = new URL("/v1/oauth/google/callback", env.API_BASE_URL).toString();
  const state = btoa(JSON.stringify({ user_code: userCode })).replace(/=/g, "");

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", env.GOOGLE_OAUTH_CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", GOOGLE_SCOPES);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("prompt", "select_account");

  return Response.redirect(authUrl.toString(), 302);
}

export async function handleGoogleCallback(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const stateRaw = url.searchParams.get("state");

  if (!code || !stateRaw) {
    return json({ error: "invalid_callback", detail: "code+state required" }, 400);
  }
  if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET) {
    return json({ error: "google_oauth_not_configured" }, 503);
  }

  let user_code = "";
  try {
    user_code = JSON.parse(atob(stateRaw + "==")).user_code;
  } catch {
    return json({ error: "invalid_state" }, 400);
  }

  // Exchange code for tokens
  const redirectUri = new URL("/v1/oauth/google/callback", env.API_BASE_URL).toString();
  const tokenRes = await fetchWithTimeout("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) {
    const detail = await tokenRes.text();
    return json({ error: "google_token_exchange_failed", detail }, 502);
  }
  const tokens = (await tokenRes.json()) as { id_token?: string };
  if (!tokens.id_token) {
    return json({ error: "no_id_token" }, 502);
  }

  // Forward to /pair page with the id_token + user_code; the page POSTs to
  // /v1/pair/submit which mints the bundle.
  const pair = new URL("/pair", env.API_BASE_URL);
  pair.searchParams.set("code", user_code);
  pair.searchParams.set("id_token", tokens.id_token);
  return Response.redirect(pair.toString(), 302);
}
