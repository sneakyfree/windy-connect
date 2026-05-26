/**
 * Magic-link pair flow.
 *
 *   POST /v1/pair/start    body: {user_code, email}
 *     → mint magic-link JWT, send via Resend, return 202.
 *
 *   GET /v1/pair/verify?token=<jwt>
 *     → verify JWT, look up the user_code's session, mark approved with
 *       the verified email, mint bundle, redirect to /pair?code=...&verified=1.
 *
 * The /pair page (route/pair.ts) now drives this — user types email,
 * page POSTs /v1/pair/start, shows "check your inbox", user clicks email
 * link which lands on /v1/pair/verify and completes the pairing.
 *
 * Auth model: the magic link IS the proof of email ownership. No Google
 * OAuth, no consent screen, no GCP-console roundtrip. Grandma-friendly.
 */

import type { Env } from "../index";
import { json } from "../index";
import { signMagicLink, verifyMagicLink } from "../magic_link";
import {
  getByDeviceCode,
  getDeviceCodeByUserCode,
  putSession,
} from "../store";
import { normalizeUserCode } from "../codes";
import { provisionBundle } from "../provision";
import { verifyCsrf } from "./pair";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const SENDER_NAME = "Windy Connect";
const SENDER_EMAIL = "pair@windyword.ai"; // verified Resend domain (lockbox §Resend)

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function handlePairStart(req: Request, env: Env): Promise<Response> {
  const csrfError = verifyCsrf(req);
  if (csrfError) {
    return json({ error: "csrf_check_failed", detail: csrfError }, 403);
  }

  if (!env.MAGIC_LINK_SIGNING_KEY || !env.RESEND_API_KEY) {
    return json(
      {
        error: "magic_link_not_configured",
        detail: "MAGIC_LINK_SIGNING_KEY + RESEND_API_KEY must be set as Worker secrets",
      },
      503,
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    user_code?: string;
    email?: string;
  };
  const user_code = normalizeUserCode(body.user_code ?? "");
  const email = (body.email ?? "").trim().toLowerCase();

  if (!user_code) {
    return json({ error: "invalid_request", error_description: "user_code required" }, 400);
  }
  if (!email || !EMAIL_RE.test(email)) {
    return json({ error: "invalid_email", error_description: "provide a valid email address" }, 400);
  }

  // Confirm there's a live session for the user_code before sending email.
  // Avoids using us as a spam relay against random addresses.
  const formatted = `${user_code.slice(0, 4)}-${user_code.slice(4, 8)}`;
  const device_code = await getDeviceCodeByUserCode(env, formatted);
  if (!device_code) {
    return json({ error: "invalid_code", error_description: "no pending session for that code" }, 404);
  }

  // Sign the magic link
  const token = await signMagicLink(env.MAGIC_LINK_SIGNING_KEY, formatted, email);
  const link = `${env.API_BASE_URL}/v1/pair/verify?token=${encodeURIComponent(token)}`;

  // Send via Resend
  const emailRes = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: `${SENDER_NAME} <${SENDER_EMAIL}>`,
      to: email,
      subject: `Pair your agent (code ${formatted})`,
      html: renderMagicLinkHtml(formatted, link),
      text: renderMagicLinkText(formatted, link),
    }),
  });

  if (!emailRes.ok) {
    const detail = await emailRes.text();
    console.log(JSON.stringify({
      event: "pair_start_resend_failed",
      status: emailRes.status,
      detail: detail.slice(0, 500),
    }));
    return json(
      { error: "email_send_failed", detail: "could not send the pair link; please try again" },
      502,
    );
  }

  console.log(JSON.stringify({
    event: "pair_start_sent",
    user_code: formatted,
    email_domain: email.split("@")[1],
  }));

  return json({ ok: true, message: "Check your email for the magic link." }, 202);
}

export async function handlePairVerify(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";

  if (!token) {
    return renderResultPage("error", "Missing token in link.");
  }
  if (!env.MAGIC_LINK_SIGNING_KEY) {
    return renderResultPage("error", "Magic-link is not configured on this Worker.");
  }

  const result = await verifyMagicLink(env.MAGIC_LINK_SIGNING_KEY, token);
  if (!result.ok) {
    return renderResultPage("error", `That link is no longer valid: ${result.reason}.`);
  }

  const { user_code, email } = result.payload;
  const device_code = await getDeviceCodeByUserCode(env, user_code);
  if (!device_code) {
    return renderResultPage("error", "The pair session for that code has expired. Run `windy connect` again.");
  }
  const session = await getByDeviceCode(env, device_code);
  if (!session) {
    return renderResultPage("error", "The pair session has expired. Run `windy connect` again.");
  }
  if (session.status === "approved") {
    return renderResultPage("ok", "Your agent is already paired. Return to your terminal.");
  }
  if (session.status !== "pending") {
    return renderResultPage("error", `This pair session is ${session.status} and can't be approved.`);
  }

  // Mint the bundle and mark the session approved.
  // sub: we don't have a Google sub here — use a deterministic id derived
  // from the email so refresh flows can correlate.
  const sub = await sha256Hex(`magic-link:${email}`);
  const bundle = await provisionBundle(env, {
    tier: session.tier,
    google_email: email,
    google_sub: sub,
  });

  session.status = "approved";
  session.google_email = email;
  session.google_sub = sub;
  session.bundle = bundle;
  await putSession(env, session);

  // Wave E: notify the windy-pro account-server so the user's dashboard
  // tile flips from "Available" to "Active". Best-effort — a webhook
  // failure must NOT block the pair flow (the agent still has its
  // bundle; the dashboard is a cosmetic surface). We log the failure
  // and move on.
  if (env.WINDY_CONNECT_WEBHOOK_SECRET && env.WINDY_PRO_ACCOUNT_SERVER_URL) {
    const issued_at = bundle.issued_at;
    const sig = await hmacSha256Hex(env.WINDY_CONNECT_WEBHOOK_SECRET, `${email}:${issued_at}`);
    try {
      const res = await fetch(`${env.WINDY_PRO_ACCOUNT_SERVER_URL}/api/v1/identity/connect/paired`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email,
          issued_at,
          bundle_version: bundle.bundle_version,
          signature: sig,
        }),
      });
      if (!res.ok) {
        console.warn(JSON.stringify({
          event: "pair_webhook_failed",
          status: res.status,
          body: (await res.text()).slice(0, 200),
        }));
      }
    } catch (e) {
      console.warn(JSON.stringify({
        event: "pair_webhook_error",
        error: e instanceof Error ? e.message : String(e),
      }));
    }
  }

  console.log(JSON.stringify({
    event: "pair_verified",
    user_code,
    email_domain: email.split("@")[1],
    tier: session.tier,
  }));

  return renderResultPage("ok", "Your agent is paired. Return to your terminal — it's now talking to the Windy ecosystem.");
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ---------------------------------------------------------------------------

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function renderMagicLinkHtml(userCode: string, link: string): string {
  return `<!doctype html>
<html lang="en">
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; background: #f6f8fb; margin: 0; padding: 40px 20px;">
  <div style="max-width: 480px; margin: 0 auto; background: white; border-radius: 12px; padding: 32px; box-shadow: 0 4px 12px rgba(0,0,0,0.06);">
    <h1 style="margin: 0 0 12px; color: #0a1f3d; font-size: 22px;">Pair your agent</h1>
    <p style="color: #4a5568; line-height: 1.5;">Someone (hopefully you) just ran <code style="background: #f0f3f8; padding: 2px 6px; border-radius: 4px;">windy connect</code> and typed this address. Click the button to finish pairing.</p>
    <p style="text-align: center; margin: 28px 0;">
      <a href="${escapeAttr(link)}" style="display: inline-block; background: #5fa8ff; color: #0a1f3d; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600;">Pair my agent</a>
    </p>
    <p style="color: #718096; font-size: 13px;">Code: <strong style="font-family: ui-monospace, monospace;">${escapeHtml(userCode)}</strong></p>
    <p style="color: #718096; font-size: 13px;">If you didn't request this, just ignore — the link expires in 15 minutes.</p>
    <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;">
    <p style="color: #a0aec0; font-size: 12px;">Sent by Windy Connect — the agent-onboarding kernel of the Windy ecosystem.</p>
  </div>
</body>
</html>`;
}

function renderMagicLinkText(userCode: string, link: string): string {
  return `Pair your agent
==============

Someone (hopefully you) just ran "windy connect" and typed this address.
Click the link below to finish pairing.

  ${link}

Code: ${userCode}
The link expires in 15 minutes.

If you didn't request this, just ignore.

— Windy Connect`;
}

function renderResultPage(kind: "ok" | "error", message: string): Response {
  const color = kind === "ok" ? "#2e7a47" : "#7a2e2e";
  const bg = kind === "ok" ? "#e6f4ec" : "#fce8e8";
  const icon = kind === "ok" ? "✓" : "✗";
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Windy Connect — Pair result</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
         margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
         background: linear-gradient(180deg, #0a1f3d 0%, #0e2b56 100%); color: #f7f9fc; }
  .card { background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12);
          border-radius: 16px; padding: 40px 36px; max-width: 460px; width: 92%; text-align: center; }
  .icon { display: inline-flex; align-items: center; justify-content: center;
          width: 56px; height: 56px; border-radius: 28px; background: ${bg}; color: ${color};
          font-size: 28px; font-weight: 700; margin-bottom: 20px; }
  h1 { margin: 0 0 8px; font-size: 24px; }
  p { color: #c9d4e3; line-height: 1.55; margin: 8px 0; }
  code { background: rgba(0,0,0,0.4); padding: 2px 6px; border-radius: 4px; font-family: ui-monospace, monospace; }
</style>
</head>
<body>
  <div class="card">
    <div class="icon">${icon}</div>
    <h1>${kind === "ok" ? "All set." : "Pair failed"}</h1>
    <p>${escapeHtml(message)}</p>
    ${kind === "ok"
      ? `<p style="margin-top:20px;color:#8aa0c0;font-size:13px;">You can safely close this tab.</p>`
      : `<p style="margin-top:20px;color:#8aa0c0;font-size:13px;">Re-run <code>windy connect</code> in your terminal to start over.</p>`}
  </div>
</body>
</html>`;
  return new Response(html, {
    status: kind === "ok" ? 200 : 400,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}
