/**
 * /pair — the browser page where users finish pairing their agent.
 *
 * Primary auth model: MAGIC-LINK via email.
 *   1. User opens /pair?code=XXXX-YYYY (clicked from CLI verification_uri_complete)
 *   2. User types their email + submits
 *   3. We POST /v1/pair/start → Resend sends a magic link
 *   4. User clicks the email link → /v1/pair/verify mints the bundle + redirects
 *      them back to /pair?code=...&verified=1 with a success state
 *   5. Meanwhile the CLI polls /v1/device/poll and receives the bundle
 *
 * Why magic-link not Google OAuth: works without a Google account, no
 * consent-screen friction, no GCP-console redirect-URI roundtrip when we
 * launch new hostnames. Grandma-friendly. See magic_link.ts.
 *
 * The page also still surfaces a "Continue with Google" button when
 * GOOGLE_OAUTH_CLIENT_ID is set — for users who prefer it or for the
 * Windy account-server's existing OAuth client.
 *
 * In sandbox mode (ENABLE_REAL_PROVISIONING=false AND no Resend secret),
 * a fallback "type any email" form falls through to the legacy
 * /v1/pair/submit path so local-only testing still works.
 */

import type { Env } from "../index";

const CSRF_COOKIE = "windy_pair_csrf";

export async function handlePair(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const code = url.searchParams.get("code") ?? "";
  const idToken = url.searchParams.get("id_token") ?? "";
  const verified = url.searchParams.get("verified") === "1";
  const magicLinkConfigured = !!(env.MAGIC_LINK_SIGNING_KEY && env.RESEND_API_KEY);
  const googleConfigured = !!env.GOOGLE_OAUTH_CLIENT_ID;

  const csrf = crypto.randomUUID();

  const html = renderPairHtml({
    code,
    idToken,
    verified,
    magicLinkConfigured,
    googleConfigured,
    csrf,
  });
  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "set-cookie": `${CSRF_COOKIE}=${csrf}; Path=/v1/pair; HttpOnly; Secure; SameSite=Strict; Max-Age=900`,
    },
  });
}

export function verifyCsrf(req: Request): string | null {
  const headerToken = req.headers.get("x-csrf-token") ?? "";
  const cookieHeader = req.headers.get("cookie") ?? "";
  const m = cookieHeader.match(new RegExp(`(?:^|;\\s*)${CSRF_COOKIE}=([^;]+)`));
  const cookieToken = m ? m[1] : "";
  if (!headerToken || !cookieToken) return "missing CSRF token";
  if (headerToken !== cookieToken) return "CSRF token mismatch";
  return null;
}

function renderPairHtml(args: {
  code: string;
  idToken: string;
  verified: boolean;
  magicLinkConfigured: boolean;
  googleConfigured: boolean;
  csrf: string;
}): string {
  // Path 1: user just clicked the email link and was sent back here
  const verifiedBanner = args.verified
    ? `<div class="success">✓ All set. Your agent is paired — return to your terminal.</div>`
    : "";

  const signInWithGoogle = args.googleConfigured
    ? `<a class="btn btn-google" href="/v1/oauth/google/start?code=${encodeURIComponent(args.code)}">
         Continue with Google
       </a>`
    : "";

  const orSeparator = args.magicLinkConfigured && args.googleConfigured
    ? `<div class="sep"><span>or</span></div>`
    : "";

  const magicLinkForm = args.magicLinkConfigured
    ? `<form id="magic-form">
         <label for="email">Your email</label>
         <input id="email" name="email" type="email" placeholder="you@example.com"
                autocomplete="email" required>
         <button class="btn" type="submit">Send me a link</button>
       </form>
       <div id="status"></div>`
    : args.googleConfigured
      ? "" // Google is the only option — already shown above
      : `<form id="dev-form">
           <p class="banner">⚠️ Sandbox mode — type any email to mint a sandbox bundle. Set MAGIC_LINK_SIGNING_KEY + RESEND_API_KEY on the Worker for real magic-link auth.</p>
           <label for="email">Email (sandbox)</label>
           <input id="email" name="email" type="email" placeholder="agent@example.com" autocomplete="off" required>
           <button class="btn" type="submit">Pair (sandbox)</button>
         </form>
         <div id="status"></div>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Windy Connect — Pair your agent</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { color-scheme: light dark; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
         margin: 0; padding: 0; background: linear-gradient(180deg, #0a1f3d 0%, #0e2b56 100%);
         color: #f7f9fc; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
  .card { background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12);
          border-radius: 16px; padding: 36px 32px; max-width: 480px; width: 92%;
          box-shadow: 0 20px 60px rgba(0,0,0,0.3); }
  h1 { margin: 0 0 6px; font-weight: 700; font-size: 28px; }
  p { color: #c9d4e3; line-height: 1.5; margin: 8px 0 20px; }
  .banner { background: #5a3d1f; color: #ffd9a0; border: 1px solid #7a5a30;
            border-radius: 8px; padding: 10px 12px; font-size: 13px; margin-bottom: 16px; }
  label { display: block; font-size: 13px; color: #98a8c0; margin: 14px 0 6px; }
  input { width: 100%; box-sizing: border-box; background: rgba(0,0,0,0.3);
          border: 1px solid rgba(255,255,255,0.15); border-radius: 8px;
          padding: 12px 14px; color: #f7f9fc; font-size: 16px; font-family: ui-monospace, monospace; }
  input:focus { outline: 2px solid #5fa8ff; border-color: transparent; }
  .btn { display: inline-block; width: 100%; box-sizing: border-box; padding: 12px 16px;
         border-radius: 8px; border: none; font-size: 15px; font-weight: 600; cursor: pointer;
         margin-top: 16px; text-align: center; text-decoration: none; }
  .btn:not(:disabled) { background: #5fa8ff; color: #0a1f3d; }
  .btn:hover:not(:disabled) { background: #82bbff; }
  .btn:disabled { background: #2a3e60; color: #6a7a98; cursor: not-allowed; }
  .btn-google { background: #fff; color: #333; }
  .muted { color: #8aa0c0; font-size: 12px; margin-top: 18px; text-align: center; }
  .success { background: #1f4a2f; border: 1px solid #2e7a47; color: #b8e6c8;
             padding: 14px; border-radius: 8px; margin-top: 16px; }
  .info { background: #1f2f4a; border: 1px solid #2e477a; color: #b8c8e6;
          padding: 14px; border-radius: 8px; margin-top: 16px; }
  .err { background: #4a1f1f; border: 1px solid #7a2e2e; color: #ffb8b8;
         padding: 14px; border-radius: 8px; margin-top: 16px; }
  .sep { text-align: center; margin: 18px 0 6px; color: #8aa0c0; font-size: 13px;
         position: relative; }
  .sep::before, .sep::after { content: ""; position: absolute; top: 50%; height: 1px;
                              background: rgba(255,255,255,0.12); width: 38%; }
  .sep::before { left: 0; } .sep::after { right: 0; }
  code { background: rgba(0,0,0,0.4); padding: 2px 6px; border-radius: 4px;
         font-family: ui-monospace, monospace; }
</style>
</head>
<body>
<div class="card">
  <h1>Pair your agent</h1>
  <p>Confirm your email — we'll send you a one-click link to finish pairing the agent that's waiting in your terminal.</p>
  ${verifiedBanner}
  ${args.code
    ? `<p class="muted">Pair code: <code>${escapeHtml(args.code)}</code></p>`
    : `<div class="err">No pair code in the URL. Run <code>windy connect</code> again to get one.</div>`}
  ${signInWithGoogle}
  ${orSeparator}
  ${magicLinkForm}
  <p class="muted">Powered by Eternitas + Windy Connect.</p>
</div>
<script>
const CSRF_TOKEN = ${JSON.stringify(args.csrf)};
const USER_CODE = ${JSON.stringify(args.code)};
const ID_TOKEN = ${JSON.stringify(args.idToken)};

const statusEl = document.getElementById('status');
const magicForm = document.getElementById('magic-form');
const devForm = document.getElementById('dev-form');

function setStatus(html) { if (statusEl) statusEl.innerHTML = html; }

async function postJson(path, body) {
  return fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-csrf-token': CSRF_TOKEN },
    credentials: 'same-origin',
    body: JSON.stringify(body),
  });
}

if (magicForm) {
  magicForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value;
    setStatus('<div class="info">Sending the link…</div>');
    const res = await postJson('/v1/pair/start', { user_code: USER_CODE, email });
    const data = await res.json().catch(() => ({}));
    if (res.status === 202) {
      setStatus(
        '<div class="success">📬 Check your email at <strong>' + escapeHtml(email) + '</strong> ' +
        'and click the pair link. (Look in spam if you don\\'t see it — the sender is pair@windyword.ai.)</div>'
      );
      magicForm.querySelector('button').disabled = true;
    } else {
      setStatus('<div class="err">' + escapeHtml(data.error_description || data.detail || data.error || 'Could not send the link.') + '</div>');
    }
  });
}

if (devForm) {
  devForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value;
    setStatus('<div class="info">Pairing…</div>');
    const res = await postJson('/v1/pair/submit', { user_code: USER_CODE, google_email: email });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setStatus('<div class="success">Paired! Return to your terminal.</div>');
    } else {
      setStatus('<div class="err">' + escapeHtml(data.error_description || data.error || 'Pairing failed.') + '</div>');
    }
  });
}

// Legacy: if redirected here with an id_token (Google OAuth callback), submit it.
if (ID_TOKEN && USER_CODE) {
  setStatus('<div class="info">Completing Google sign-in…</div>');
  postJson('/v1/pair/submit', { user_code: USER_CODE, id_token: ID_TOKEN })
    .then((res) => res.ok
      ? setStatus('<div class="success">Paired! Return to your terminal.</div>')
      : res.json().then((d) => setStatus('<div class="err">' + (d.error_description || d.error || 'Pairing failed.') + '</div>'))
    );
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
</script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
