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
  // Path 1: user just clicked the email link and was sent back here.
  // When verified=1, hide the form entirely — showing both the success
  // banner AND a form is the most common UX bug reported on email-link
  // flows (user sees the form, types email again, gets confused).
  if (args.verified) {
    return renderVerifiedSuccess();
  }
  // Path 2: no pair code — happens when the user lands on /pair directly,
  // or the CLI session expired before they got here. Show a clear "go
  // back to your terminal and run windy connect again" rather than an
  // ambiguous error inside the form.
  if (!args.code) {
    return renderNoCode();
  }

  const signInWithGoogle = args.googleConfigured
    ? `<a class="btn btn-google" href="/v1/oauth/google/start?code=${encodeURIComponent(args.code)}"
          aria-label="Continue with your Google account">
         Continue with Google
       </a>`
    : "";

  const orSeparator = args.magicLinkConfigured && args.googleConfigured
    ? `<div class="sep" role="separator" aria-label="or"><span>or</span></div>`
    : "";

  const magicLinkForm = args.magicLinkConfigured
    ? `<form id="magic-form">
         <label for="email">Your email</label>
         <input id="email" name="email" type="email" placeholder="you@example.com"
                autocomplete="email" autocapitalize="off" autocorrect="off"
                spellcheck="false" required>
         <button class="btn" type="submit" id="magic-submit">Send me a link</button>
       </form>`
    : args.googleConfigured
      ? "" // Google is the only option — already shown above
      : `<form id="dev-form">
           <p class="banner" role="status">⚠️ Sandbox mode — type any email to mint a sandbox bundle. Set MAGIC_LINK_SIGNING_KEY + RESEND_API_KEY on the Worker for real magic-link auth.</p>
           <label for="email">Email (sandbox)</label>
           <input id="email" name="email" type="email" placeholder="agent@example.com"
                  autocomplete="off" autocapitalize="off" autocorrect="off"
                  spellcheck="false" required>
           <button class="btn" type="submit">Pair (sandbox)</button>
         </form>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Pair your agent — Windy Connect</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="Pair your AI agent with the Windy ecosystem — one click, no signup, no GitHub.">
<meta name="theme-color" content="#0a1f3d">
<meta property="og:title" content="Pair your agent — Windy Connect">
<meta property="og:description" content="One-click pairing for any AI agent.">
<meta property="og:type" content="website">
${PAIR_CSS}
</head>
<body>
<main class="card" role="main">
  <h1>Pair your agent</h1>
  <p class="lede">We'll email you a one-click link. Clicking it pairs the agent that's waiting in your terminal — no signup, no password.</p>
  <details class="explainer">
    <summary>What does pairing do?</summary>
    <p>Your agent gets a verified Eternitas identity, a Windy Mail mailbox, a Windy Chat handle, and access to the Windy Mind models — all wired up in seconds. Your email proves it's yours; we never see a password.</p>
  </details>
  <p class="muted">Pair code: <code>${escapeHtml(args.code)}</code></p>
  ${signInWithGoogle}
  ${orSeparator}
  ${magicLinkForm}
  <div id="status" role="status" aria-live="polite"></div>
  <p class="footer">
    <a href="https://windyconnect.com/privacy" rel="noopener">Privacy</a>
    <span aria-hidden="true">·</span>
    <a href="https://windyconnect.com/terms" rel="noopener">Terms</a>
    <span aria-hidden="true">·</span>
    Powered by Eternitas + Windy Connect
  </p>
</main>
<script>
${PAIR_JS(args.csrf, args.code, args.idToken)}
</script>
</body>
</html>`;
}

function renderVerifiedSuccess(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Paired! — Windy Connect</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#0a1f3d">
${PAIR_CSS}
</head>
<body>
<main class="card" role="main">
  <div class="hero-emoji" aria-hidden="true">✨</div>
  <h1>You're paired</h1>
  <p class="lede">Return to your terminal — your agent is hatching its credentials now and will be ready in a moment.</p>
  <div class="success" role="status">
    <strong>What's happening now:</strong>
    <ul class="checklist">
      <li>Your agent's Eternitas Passport is being minted</li>
      <li>A Windy Mail mailbox is being provisioned</li>
      <li>A Windy Chat handle is being created</li>
      <li>Access to the Windy Mind models is being granted</li>
    </ul>
  </div>
  <p class="muted">You can safely close this tab.</p>
  <p class="footer">
    <a href="https://windyconnect.com/privacy" rel="noopener">Privacy</a>
    <span aria-hidden="true">·</span>
    <a href="https://windyconnect.com/terms" rel="noopener">Terms</a>
  </p>
</main>
</body>
</html>`;
}

function renderNoCode(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>No pair code — Windy Connect</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#0a1f3d">
${PAIR_CSS}
</head>
<body>
<main class="card" role="main">
  <h1>No pair code</h1>
  <p class="lede">This page needs a pair code from your terminal. Run this in your terminal:</p>
  <pre class="terminal" aria-label="terminal command"><code>windy connect</code></pre>
  <p>It'll print a URL to come back here with — or a code you can type at <a href="https://windyconnect.com" rel="noopener">windyconnect.com</a>.</p>
  <p class="muted">Don't have the <code>windy</code> CLI yet? Install with:</p>
  <pre class="terminal" aria-label="install command"><code>pip install windy-connect</code></pre>
  <p class="footer">
    <a href="https://windyconnect.com" rel="noopener">Home</a>
    <span aria-hidden="true">·</span>
    <a href="https://github.com/sneakyfree/windy-connect" rel="noopener">GitHub</a>
  </p>
</main>
</body>
</html>`;
}

const PAIR_CSS = `<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
         margin: 0; padding: 16px; background: linear-gradient(180deg, #0a1f3d 0%, #0e2b56 100%);
         color: #f7f9fc; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
  .card { background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12);
          border-radius: 16px; padding: 32px 28px; max-width: 480px; width: 100%;
          box-shadow: 0 20px 60px rgba(0,0,0,0.3); }
  @media (max-width: 480px) { .card { padding: 24px 20px; } }
  .hero-emoji { font-size: 48px; text-align: center; margin-bottom: 8px; }
  h1 { margin: 0 0 6px; font-weight: 700; font-size: 28px; }
  .lede { color: #c9d4e3; line-height: 1.5; margin: 8px 0 16px; font-size: 15px; }
  p { color: #c9d4e3; line-height: 1.5; margin: 8px 0 16px; }
  .banner { background: #5a3d1f; color: #ffd9a0; border: 1px solid #7a5a30;
            border-radius: 8px; padding: 10px 12px; font-size: 13px; margin-bottom: 16px; }
  label { display: block; font-size: 13px; color: #98a8c0; margin: 14px 0 6px; }
  input { width: 100%; background: rgba(0,0,0,0.3);
          border: 1px solid rgba(255,255,255,0.15); border-radius: 8px;
          padding: 12px 14px; color: #f7f9fc; font-size: 16px; font-family: ui-monospace, monospace; }
  input:focus { outline: 2px solid #5fa8ff; border-color: transparent; }
  .btn { display: inline-block; width: 100%; padding: 12px 16px;
         border-radius: 8px; border: none; font-size: 15px; font-weight: 600; cursor: pointer;
         margin-top: 16px; text-align: center; text-decoration: none; }
  .btn:not(:disabled) { background: #5fa8ff; color: #0a1f3d; }
  .btn:hover:not(:disabled) { background: #82bbff; }
  .btn:disabled { background: #2a3e60; color: #6a7a98; cursor: not-allowed; }
  .btn-google { background: #fff; color: #333; }
  .muted { color: #8aa0c0; font-size: 12px; margin-top: 14px; }
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
         font-family: ui-monospace, monospace; font-size: 0.9em; }
  .terminal { background: #000; border: 1px solid rgba(255,255,255,0.15);
              border-radius: 8px; padding: 12px 14px; margin: 12px 0;
              overflow-x: auto; }
  .terminal code { background: transparent; padding: 0; font-size: 14px; }
  .checklist { color: #d6efe2; padding-left: 18px; margin: 8px 0; }
  .checklist li { margin: 4px 0; line-height: 1.4; }
  .explainer { background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.08);
               border-radius: 8px; padding: 8px 14px; margin: 8px 0 16px;
               font-size: 14px; }
  .explainer summary { cursor: pointer; color: #98a8c0; padding: 6px 0; }
  .explainer summary:hover { color: #c9d4e3; }
  .explainer p { margin: 8px 0; font-size: 14px; color: #c9d4e3; }
  .footer { text-align: center; color: #8aa0c0; font-size: 12px; margin-top: 22px;
            border-top: 1px solid rgba(255,255,255,0.06); padding-top: 14px; }
  .footer a { color: #98a8c0; text-decoration: none; }
  .footer a:hover { color: #c9d4e3; }
  .spinner { display: inline-block; width: 12px; height: 12px; vertical-align: middle;
             border: 2px solid rgba(255,255,255,0.3); border-top-color: #b8c8e6;
             border-radius: 50%; animation: spin 1s linear infinite; margin-right: 8px; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>`;

const PAIR_JS = (csrf: string, code: string, idToken: string) => `
const CSRF_TOKEN = ${JSON.stringify(csrf)};
const USER_CODE = ${JSON.stringify(code)};
const ID_TOKEN = ${JSON.stringify(idToken)};

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

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

if (magicForm) {
  magicForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value.trim();
    const submitBtn = document.getElementById('magic-submit');
    submitBtn.disabled = true;
    setStatus('<div class="info"><span class="spinner" aria-hidden="true"></span>Sending the link…</div>');
    try {
      const res = await postJson('/v1/pair/start', { user_code: USER_CODE, email });
      const data = await res.json().catch(() => ({}));
      if (res.status === 202) {
        // Hide the form once the link is sent — user's next action is in
        // their inbox, not on this page.
        magicForm.style.display = 'none';
        setStatus(
          '<div class="success"><strong>📬 Check your email at ' +
          escapeHtml(email) +
          '</strong><br>Click the pair link to finish. If you don\\'t see it, look in spam — the sender is <code>pair@windyword.ai</code>.</div>' +
          '<p class="muted">Once you click it, this page will refresh and your agent will pair automatically.</p>'
        );
      } else {
        submitBtn.disabled = false;
        setStatus('<div class="err">' + escapeHtml(data.error_description || data.detail || data.error || 'Could not send the link.') + '</div>');
      }
    } catch (err) {
      submitBtn.disabled = false;
      setStatus('<div class="err">Network error — check your connection and try again.</div>');
    }
  });
}

if (devForm) {
  devForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value.trim();
    setStatus('<div class="info"><span class="spinner" aria-hidden="true"></span>Pairing…</div>');
    try {
      const res = await postJson('/v1/pair/submit', { user_code: USER_CODE, google_email: email });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setStatus('<div class="success">✓ Paired! Return to your terminal.</div>');
        devForm.style.display = 'none';
      } else {
        setStatus('<div class="err">' + escapeHtml(data.error_description || data.error || 'Pairing failed.') + '</div>');
      }
    } catch (err) {
      setStatus('<div class="err">Network error — check your connection and try again.</div>');
    }
  });
}

// Legacy: if redirected here with an id_token (Google OAuth callback), submit it.
if (ID_TOKEN && USER_CODE) {
  setStatus('<div class="info"><span class="spinner" aria-hidden="true"></span>Completing Google sign-in…</div>');
  postJson('/v1/pair/submit', { user_code: USER_CODE, id_token: ID_TOKEN })
    .then((res) => res.ok
      ? setStatus('<div class="success">✓ Paired! Return to your terminal.</div>')
      : res.json().then((d) => setStatus('<div class="err">' + (d.error_description || d.error || 'Pairing failed.') + '</div>'))
    );
}
`;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
