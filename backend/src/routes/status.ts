/**
 * Deep health + public status page.
 *
 *   GET /healthz       liveness only — returns 200 immediately, no upstream calls.
 *                      Used by Cloudflare load balancers; must be cheap + always-up
 *                      so a downstream outage doesn't flap us out of rotation.
 *
 *   GET /v1/status     JSON snapshot of every upstream the Worker depends on.
 *                      Hits each one (HEAD/GET) with a 5s timeout, returns
 *                      {component, status: ok|degraded|down, latency_ms, hint}
 *                      plus a top-level rollup. 200 always — the caller (a
 *                      monitoring system or a curl-pipe smoke test) reads
 *                      `overall` to decide pass/fail. Returning 5xx here would
 *                      conflate "this Worker is down" with "Eternitas is down".
 *
 *   GET /status        HTML version of the same data, suitable for a public
 *                      status.windyconnect.com surface. Auto-refreshes every
 *                      60s; matches the pair page visual style.
 *
 * The component list is hard-coded against the wave architecture — Eternitas,
 * Mind, Mail, Synapse (gated by SYNAPSE_ADMIN_GATEWAY_TOKEN), account-server
 * (gated by WINDY_PRO_ACCOUNT_SERVER_URL). Components without configuration
 * are reported as `status: "unconfigured"` rather than failing — that's the
 * truthful state for an early-stage deploy.
 */

import type { Env } from "../index";

interface ComponentResult {
  name: string;
  status: "ok" | "degraded" | "down" | "unconfigured";
  latency_ms: number | null;
  hint?: string;
  url?: string;
}

const PROBE_TIMEOUT_MS = 5000;

async function probe(url: string, init?: RequestInit): Promise<{ latency: number; status: number; body?: string }> {
  const start = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    return { latency: Date.now() - start, status: res.status };
  } finally {
    clearTimeout(timer);
  }
}

async function checkEternitas(env: Env): Promise<ComponentResult> {
  const base = env.ETERNITAS_API_URL ?? "https://api.eternitas.ai";
  const url = `${base}/.well-known/eternitas-keys`;
  try {
    const { latency, status } = await probe(url);
    if (status === 200) {
      return { name: "eternitas", status: "ok", latency_ms: latency, url };
    }
    return {
      name: "eternitas",
      status: "down",
      latency_ms: latency,
      hint: `JWKS returned ${status} (expected 200)`,
      url,
    };
  } catch (e) {
    return {
      name: "eternitas",
      status: "down",
      latency_ms: null,
      hint: e instanceof Error ? e.message : String(e),
      url,
    };
  }
}

async function checkMind(env: Env): Promise<ComponentResult> {
  const base = env.WINDY_MIND_API_URL ?? "https://api.windymind.ai";
  // /version is the universal foundations-program endpoint — no auth,
  // no DB, deployment identity only. Adds zero cost.
  const url = `${base}/version`;
  try {
    const { latency, status } = await probe(url);
    if (status === 200) {
      return { name: "windy_mind", status: "ok", latency_ms: latency, url };
    }
    return {
      name: "windy_mind",
      status: "degraded",
      latency_ms: latency,
      hint: `/version returned ${status}`,
      url,
    };
  } catch (e) {
    return {
      name: "windy_mind",
      status: "down",
      latency_ms: null,
      hint: e instanceof Error ? e.message : String(e),
      url,
    };
  }
}

async function checkMail(env: Env): Promise<ComponentResult> {
  if (!env.WINDY_MAIL_SERVICE_TOKEN) {
    return {
      name: "windy_mail",
      status: "unconfigured",
      latency_ms: null,
      hint: "WINDY_MAIL_SERVICE_TOKEN not set — Mail provisioning will sandbox",
    };
  }
  const base = env.WINDY_MAIL_API_URL ?? "https://api.windymail.ai";
  const url = `${base}/version`;
  try {
    const { latency, status } = await probe(url);
    if (status === 200) {
      return { name: "windy_mail", status: "ok", latency_ms: latency, url };
    }
    return {
      name: "windy_mail",
      status: "degraded",
      latency_ms: latency,
      hint: `/version returned ${status}`,
      url,
    };
  } catch (e) {
    return {
      name: "windy_mail",
      status: "down",
      latency_ms: null,
      hint: e instanceof Error ? e.message : String(e),
      url,
    };
  }
}

async function checkSynapse(env: Env): Promise<ComponentResult> {
  if (!env.SYNAPSE_ADMIN_GATEWAY_TOKEN || !env.SYNAPSE_ADMIN_TOKEN) {
    return {
      name: "windy_chat",
      status: "unconfigured",
      latency_ms: null,
      hint: "SYNAPSE_ADMIN_GATEWAY_TOKEN or SYNAPSE_ADMIN_TOKEN not set — Chat provisioning will sandbox",
    };
  }
  const base = env.WINDY_CHAT_HOMESERVER_URL ?? "https://chat.windychat.ai";
  const url = `${base}/_synapse/admin/v1/server_version`;
  try {
    const { latency, status } = await probe(url, {
      headers: {
        authorization: `Bearer ${env.SYNAPSE_ADMIN_TOKEN}`,
        "X-Windy-Connect-Admin-Token": env.SYNAPSE_ADMIN_GATEWAY_TOKEN,
      },
    });
    if (status === 200) {
      return { name: "windy_chat", status: "ok", latency_ms: latency, url };
    }
    if (status === 403) {
      return {
        name: "windy_chat",
        status: "degraded",
        latency_ms: latency,
        hint: "nginx gateway returned 403 — gateway token mismatch (rotation skew?)",
        url,
      };
    }
    return {
      name: "windy_chat",
      status: "degraded",
      latency_ms: latency,
      hint: `synapse admin returned ${status}`,
      url,
    };
  } catch (e) {
    return {
      name: "windy_chat",
      status: "down",
      latency_ms: null,
      hint: e instanceof Error ? e.message : String(e),
      url,
    };
  }
}

async function checkAccountServer(env: Env): Promise<ComponentResult> {
  if (!env.WINDY_PRO_ACCOUNT_SERVER_URL) {
    return {
      name: "windy_pro_account_server",
      status: "unconfigured",
      latency_ms: null,
      hint: "WINDY_PRO_ACCOUNT_SERVER_URL not set — pair-tile flip is disabled",
    };
  }
  const url = `${env.WINDY_PRO_ACCOUNT_SERVER_URL}/health`;
  try {
    const { latency, status } = await probe(url);
    if (status === 200) {
      return { name: "windy_pro_account_server", status: "ok", latency_ms: latency, url };
    }
    return {
      name: "windy_pro_account_server",
      status: "degraded",
      latency_ms: latency,
      hint: `/health returned ${status}`,
      url,
    };
  } catch (e) {
    return {
      name: "windy_pro_account_server",
      status: "down",
      latency_ms: null,
      hint: e instanceof Error ? e.message : String(e),
      url,
    };
  }
}

function rollup(components: ComponentResult[]): "ok" | "degraded" | "down" {
  const active = components.filter((c) => c.status !== "unconfigured");
  if (active.length === 0) return "ok"; // nothing configured = nothing to fail
  if (active.some((c) => c.status === "down")) return "down";
  if (active.some((c) => c.status === "degraded")) return "degraded";
  return "ok";
}

export async function handleStatusJson(env: Env): Promise<Response> {
  // Probe all components in parallel — total latency = slowest probe,
  // not the sum. Each has its own 5s timeout so a hung upstream caps
  // the response at 5s + Worker overhead.
  const [eter, mind, mail, chat, acct] = await Promise.all([
    checkEternitas(env),
    checkMind(env),
    checkMail(env),
    checkSynapse(env),
    checkAccountServer(env),
  ]);
  const components = [eter, mind, mail, chat, acct];
  const overall = rollup(components);

  return new Response(
    JSON.stringify(
      {
        overall,
        checked_at: new Date().toISOString(),
        worker_version: env.COMMIT_SHA ?? "unknown",
        components,
      },
      null,
      2,
    ),
    {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "access-control-allow-origin": "*",
      },
    },
  );
}

export async function handleStatusHtml(env: Env): Promise<Response> {
  const [eter, mind, mail, chat, acct] = await Promise.all([
    checkEternitas(env),
    checkMind(env),
    checkMail(env),
    checkSynapse(env),
    checkAccountServer(env),
  ]);
  const components = [eter, mind, mail, chat, acct];
  const overall = rollup(components);

  const badge = (s: ComponentResult["status"]) => {
    switch (s) {
      case "ok":
        return `<span class="badge ok">Operational</span>`;
      case "degraded":
        return `<span class="badge degraded">Degraded</span>`;
      case "down":
        return `<span class="badge down">Down</span>`;
      case "unconfigured":
        return `<span class="badge muted">Not configured</span>`;
    }
  };

  const escape = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const rows = components
    .map(
      (c) => `
    <tr>
      <td><strong>${escape(c.name)}</strong>${c.url ? `<br><span class="url">${escape(c.url)}</span>` : ""}</td>
      <td>${badge(c.status)}</td>
      <td>${c.latency_ms !== null ? `${c.latency_ms} ms` : "—"}</td>
      <td class="hint">${c.hint ? escape(c.hint) : ""}</td>
    </tr>`,
    )
    .join("");

  const overallBadge =
    overall === "ok"
      ? `<div class="overall ok">All systems operational</div>`
      : overall === "degraded"
        ? `<div class="overall degraded">Partial degradation</div>`
        : `<div class="overall down">Major outage</div>`;

  return new Response(
    `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Windy Connect — Status</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#0a1f3d">
<meta http-equiv="refresh" content="60">
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
         margin: 0; padding: 16px; background: linear-gradient(180deg, #0a1f3d 0%, #0e2b56 100%);
         color: #f7f9fc; min-height: 100vh; }
  .container { max-width: 720px; margin: 24px auto; }
  h1 { font-weight: 700; font-size: 28px; margin: 0 0 8px; }
  .meta { color: #8aa0c0; font-size: 13px; margin-bottom: 20px; }
  .overall { padding: 14px 18px; border-radius: 12px; font-size: 18px; font-weight: 600;
             margin-bottom: 24px; }
  .overall.ok       { background: #1f4a2f; border: 1px solid #2e7a47; color: #b8e6c8; }
  .overall.degraded { background: #5a3d1f; border: 1px solid #7a5a30; color: #ffd9a0; }
  .overall.down     { background: #4a1f1f; border: 1px solid #7a2e2e; color: #ffb8b8; }
  table { width: 100%; border-collapse: collapse; background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.12); border-radius: 12px; overflow: hidden; }
  th, td { text-align: left; padding: 12px 14px; border-bottom: 1px solid rgba(255,255,255,0.08); }
  th { background: rgba(0,0,0,0.2); font-size: 12px; color: #98a8c0;
       text-transform: uppercase; letter-spacing: 0.5px; }
  td.hint { font-size: 13px; color: #98a8c0; }
  .url { color: #6a7a98; font-size: 12px; font-family: ui-monospace, monospace; }
  .badge { display: inline-block; padding: 4px 10px; border-radius: 12px; font-size: 12px;
           font-weight: 600; }
  .badge.ok       { background: #1f4a2f; color: #b8e6c8; }
  .badge.degraded { background: #5a3d1f; color: #ffd9a0; }
  .badge.down     { background: #4a1f1f; color: #ffb8b8; }
  .badge.muted    { background: #2a3e60; color: #98a8c0; }
  .footer { text-align: center; color: #8aa0c0; font-size: 12px; margin-top: 24px; }
  .footer a { color: #98a8c0; text-decoration: none; }
</style>
</head>
<body>
<div class="container">
  <h1>Windy Connect — Status</h1>
  <p class="meta">Checked ${escape(new Date().toISOString())} · Worker ${escape(env.COMMIT_SHA ?? "unknown")} · auto-refresh every 60s</p>
  ${overallBadge}
  <table>
    <thead>
      <tr><th>Component</th><th>Status</th><th>Latency</th><th>Hint</th></tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <p class="footer">
    JSON view: <a href="/v1/status">/v1/status</a>
    · <a href="https://windyconnect.com">Home</a>
    · <a href="https://github.com/sneakyfree/windy-connect">GitHub</a>
  </p>
</div>
</body>
</html>`,
    {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      },
    },
  );
}
