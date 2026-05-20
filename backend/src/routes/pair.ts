/**
 * /pair — the browser page where users enter their device code.
 *
 * Two modes:
 *   1. Dev mode (default): user types an email + code, we mint a bundle.
 *      ENABLE_REAL_PROVISIONING must be "false". This path is for the
 *      pre-launch period before Google OAuth + service provisioners are wired.
 *   2. Production mode: user clicks "Continue with Google", we go through the
 *      /v1/oauth/google/* roundtrip, then this page POSTs to /v1/pair/submit
 *      with the verified id_token.
 *
 * The HTML is inlined (single file = fastest cold start; tiny enough to read).
 */

import type { Env } from "../index";

export async function handlePair(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const code = url.searchParams.get("code") ?? "";
  const idToken = url.searchParams.get("id_token") ?? "";
  const realMode = env.ENABLE_REAL_PROVISIONING === "true";

  const html = renderPairHtml({
    code,
    idToken,
    realMode,
    googleConfigured: !!env.GOOGLE_OAUTH_CLIENT_ID,
  });
  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function renderPairHtml(args: {
  code: string;
  idToken: string;
  realMode: boolean;
  googleConfigured: boolean;
}): string {
  const banner = args.realMode
    ? ""
    : `<div class="banner">⚠️ Pre-launch mode — type any email to mint a sandbox bundle.
       Real Google sign-in goes live once GOOGLE_OAUTH_CLIENT_ID is set.</div>`;

  const signInButton = args.googleConfigured
    ? `<a class="btn btn-google" href="/v1/oauth/google/start?code=${encodeURIComponent(args.code)}">
         Continue with Google
       </a>`
    : `<button class="btn" disabled title="Google OAuth not configured">
         Continue with Google (not yet enabled)
       </button>`;

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
  .btn:disabled { background: #2a3e60; color: #6a7a98; cursor: not-allowed; }
  .btn-google { background: #fff; color: #333; }
  .muted { color: #8aa0c0; font-size: 12px; margin-top: 18px; text-align: center; }
  .success { background: #1f4a2f; border: 1px solid #2e7a47; color: #b8e6c8;
             padding: 14px; border-radius: 8px; margin-top: 16px; }
  .err { background: #4a1f1f; border: 1px solid #7a2e2e; color: #ffb8b8;
         padding: 14px; border-radius: 8px; margin-top: 16px; }
  code { background: rgba(0,0,0,0.4); padding: 2px 6px; border-radius: 4px;
         font-family: ui-monospace, monospace; }
</style>
</head>
<body>
<div class="card">
  <h1>Pair your agent</h1>
  <p>Enter the code shown in your terminal, then continue.</p>
  ${banner}
  <form id="pair-form">
    <label for="code">Code from terminal</label>
    <input id="code" name="code" placeholder="WIND-EAGL" value="${escapeHtml(args.code)}"
           autocomplete="off" spellcheck="false" autocapitalize="characters" required>
    ${args.realMode ? "" : `
      <label for="email">Email (dev mode)</label>
      <input id="email" name="email" type="email" placeholder="agent@example.com"
             autocomplete="off" required>
    `}
    ${args.realMode
      ? signInButton
      : `<button class="btn" type="submit">Pair</button>`}
  </form>
  <div id="status"></div>
  <p class="muted">Powered by Eternitas + Windy Connect.</p>
</div>
<script>
const form = document.getElementById('pair-form');
const statusEl = document.getElementById('status');
const idToken = ${JSON.stringify(args.idToken)};

async function submit(payload) {
  statusEl.innerHTML = '<p>Pairing…</p>';
  const res = await fetch('/v1/pair/submit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (res.ok) {
    statusEl.innerHTML = '<div class="success">Paired! Return to your terminal — your agent is being configured now.</div>';
  } else {
    statusEl.innerHTML = '<div class="err">Pairing failed: ' + (data.error_description || data.error || 'unknown error') + '</div>';
  }
}

if (idToken) {
  const code = document.getElementById('code').value;
  if (code) submit({ user_code: code, id_token: idToken });
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const user_code = document.getElementById('code').value;
  const email = document.getElementById('email') ? document.getElementById('email').value : undefined;
  submit({ user_code, google_email: email });
});
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
