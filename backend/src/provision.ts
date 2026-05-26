/**
 * Bundle provisioner — fans out to Eternitas / Stalwart / Synapse / Mind and
 * composes their responses into an Eternitas Agent Credentials Bundle (v1).
 *
 * Each upstream call is gated by ENABLE_REAL_PROVISIONING. When that's "false"
 * (default for the pre-launch period) the provisioner returns a deterministic
 * sandbox bundle whose values are clearly marked "sandbox-" so they're easy to
 * spot in agent logs. Once each upstream is wired and tested independently,
 * flip ENABLE_REAL_PROVISIONING=true and the real path takes over.
 */

import type { Env } from "./index";
import type {
  Bundle,
  EternitasBlock,
  MailBlock,
  MatrixChat,
  OpenAICompatibleMind,
  Tier,
} from "./types";

const BUNDLE_TTL_DAYS = 30;

interface ProvisionInput {
  tier: Tier;
  google_email: string;
  google_sub: string;
}

export async function provisionBundle(env: Env, input: ProvisionInput): Promise<Bundle> {
  const real = env.ENABLE_REAL_PROVISIONING === "true";
  const now = new Date();
  const expires = new Date(now.getTime() + BUNDLE_TTL_DAYS * 24 * 3600 * 1000);

  // Eternitas runs FIRST (sequentially) — Mail's real provisioning path
  // requires the issued passport + operator_id. The other three blocks
  // depend on no Eternitas state and run in parallel after.
  const eternitas = input.tier === "credentialed"
    ? await provisionEternitas(env, input, real)
    : undefined;

  const [windy_mail, windy_chat, windy_mind] = await Promise.all([
    provisionMail(env, input, real, eternitas),
    provisionChat(env, input, real),
    provisionMind(env, input, real),
  ]);

  return {
    bundle_version: "1.0",
    issuer: {
      name: env.ISSUER_NAME,
      url: env.ISSUER_URL,
      icon: `${env.ISSUER_URL}/favicon.png`,
    },
    issued_at: now.toISOString(),
    expires_at: expires.toISOString(),
    // refresh_url MUST resolve (CLI calls it). Use API_BASE_URL not ISSUER_URL.
    refresh_url: `${env.API_BASE_URL}/v1/bundle/refresh`,
    eternitas,
    windy_chat,
    windy_mail,
    windy_mind,
    tier: input.tier,
  };
}

// ---------------------------------------------------------------------------
// Eternitas — mints an EPT via the auto-hatch endpoint.
//
// VERIFIED 2026-05-21 against live api.eternitas.ai/openapi.json:
//   POST {ETERNITAS_API_URL}/api/v1/bots/auto-hatch
//   body required: { agent_name }     optional: { creator_email, ... }
//   returns 201 with: { passport, name, ept_token, bot_type, trust_score,
//                       registered_at, expires_at, contact_email, status }
//   The operator_id is NOT in the top-level response — it's encoded as the
//   `ope` claim inside the EPT (JWT). We decode it for the bundle.
// ---------------------------------------------------------------------------

interface AutoHatchResponse {
  passport: string;
  name: string;
  description: string;
  bot_type: string;
  status: string;
  trust_score: number;
  trust_ceiling: number;
  contact_email: string;
  registered_at: string;
  expires_at: string;
  ept_token: string;
}

function decodeEptOperatorId(ept: string): string {
  try {
    const parts = ept.split(".");
    if (parts.length !== 3) return "";
    const payloadB64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payloadB64 + "===".slice(0, (4 - (payloadB64.length % 4)) % 4);
    const claims = JSON.parse(atob(padded)) as { ope?: string };
    return claims.ope ?? "";
  } catch {
    return "";
  }
}

function mapTrustScoreToBand(score: number): "critical" | "poor" | "fair" | "good" | "exceptional" {
  if (score >= 85) return "exceptional";
  if (score >= 70) return "good";
  if (score >= 40) return "fair";
  if (score >= 20) return "poor";
  return "critical";
}

function deriveAgentName(email: string): string {
  const local = email.split("@")[0] ?? "agent";
  // Eternitas wants a stable name; downcased local part + suffix to avoid collisions
  const slug = local.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 32);
  return `${slug}-${Math.random().toString(36).slice(2, 8)}`;
}

async function provisionEternitas(
  env: Env,
  input: ProvisionInput,
  real: boolean,
): Promise<EternitasBlock> {
  if (real) {
    const res = await fetch(`${env.ETERNITAS_API_URL}/api/v1/bots/auto-hatch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_name: deriveAgentName(input.google_email),
        creator_email: input.google_email,
      }),
    });
    if (!res.ok) {
      throw new Error(`eternitas auto-hatch failed: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as AutoHatchResponse;
    return {
      ept: data.ept_token,
      passport: data.passport,
      operator_id: decodeEptOperatorId(data.ept_token) || `op_unknown_${data.passport}`,
      // Eternitas auto-hatch grants the lowest clearance by design; verified
      // agents earn higher levels through the Authenticator flow (out of scope
      // for the bootstrap pair).
      clearance_level: "registered",
      integrity_band: mapTrustScoreToBand(data.trust_score),
      jwks_url: `${env.ETERNITAS_API_URL}/.well-known/eternitas-keys`,
      revocation_check_url: `${env.ETERNITAS_API_URL}/api/v1/passports/${data.passport}/status`,
    };
  }

  // Sandbox bundle — clearly marked
  const sub = input.google_sub.slice(0, 8);
  return {
    ept: `sandbox-ept-${sub}`,
    passport: `ET26-SBOX-${sub.toUpperCase().slice(0, 4)}`,
    operator_id: `op_sandbox_${sub}`,
    clearance_level: "registered",
    integrity_band: "fair",
    jwks_url: `${env.ETERNITAS_API_URL}/.well-known/eternitas-keys`,
    revocation_check_url: `${env.ETERNITAS_API_URL}/api/v1/passports/sandbox/status`,
  };
}

// ---------------------------------------------------------------------------
// Stalwart Mail — creates a JMAP principal + IMAP/SMTP login.
//
// REAL endpoint: PUT {STALWART_ADMIN_URL}/api/principal/<localpart>
//   Basic auth admin:STALWART_ADMIN_PASS
//   body: { name, secrets, type: "individual", emails: [...] }
// Stalwart's docs: https://stalw.art/docs/management/principal/individual
// ---------------------------------------------------------------------------

// Stalwart 0.16 removed the REST /api/principal/* surface this used to
// hit directly. windy-mail's FastAPI now owns the admin path: it talks
// JMAP-admin to Stalwart, manages the Fernet-encrypted JMAP password
// brokered for the agent, and writes the account row to its own DB. We
// just hand it the Eternitas passport + agent_name and take back the
// IMAP/SMTP/JMAP block.
//
// REAL endpoint: POST {WINDY_MAIL_API_URL}/api/v1/provision/bot
//   headers: X-Service-Token: $WINDY_MAIL_SERVICE_TOKEN
//   body: { eternitas_passport, agent_name, owner_id }
//   returns 201 with: { account_id, email, imap_host/port, smtp_host/port,
//                       jmap_url, username, password, jmap_token, tier }

interface MailProvisionResponse {
  account_id: string;
  email: string;
  imap_host: string;
  imap_port: number;
  smtp_host: string;
  smtp_port: number;
  jmap_url: string;
  username: string;
  password: string;
  jmap_token: string;
  tier: string;
}

async function provisionMail(
  env: Env,
  input: ProvisionInput,
  real: boolean,
  eternitas?: EternitasBlock,
): Promise<MailBlock> {
  const localpart = sanitizeLocalpart(input.google_email);

  // Real provisioning needs a passport — Mail's BotProvisionRequest
  // requires `eternitas_passport`. Free-tier (no Eternitas) falls back
  // to sandbox values; that's the right user-visible behavior since
  // free-tier agents aren't bound to a passport in the bundle either.
  if (real && eternitas) {
    if (!env.WINDY_MAIL_SERVICE_TOKEN) {
      throw new Error("WINDY_MAIL_SERVICE_TOKEN secret is unset");
    }
    const mailApi = env.WINDY_MAIL_API_URL ?? "https://api.windymail.ai";
    const res = await fetch(`${mailApi}/api/v1/provision/bot`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Service-Token": env.WINDY_MAIL_SERVICE_TOKEN,
      },
      body: JSON.stringify({
        eternitas_passport: eternitas.passport,
        agent_name: localpart,
        owner_id: eternitas.operator_id || `op_unknown_${eternitas.passport}`,
      }),
    });
    if (!res.ok) {
      throw new Error(`mail provision failed: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as MailProvisionResponse;
    return {
      address: data.email,
      display_name: data.username,
      imap: {
        host: data.imap_host,
        port: data.imap_port,
        tls: "implicit",
        username: data.username,
        password: data.password,
      },
      smtp: {
        host: data.smtp_host,
        port: data.smtp_port,
        tls: "starttls",
        username: data.username,
        password: data.password,
      },
      jmap: {
        endpoint: data.jmap_url,
        account_id: data.account_id,
        username: data.username,
        // jmap_token is the Fernet-encrypted Stalwart password — the agent
        // can use it as basic-auth on JMAP without ever seeing the raw
        // Stalwart secret. See windy-mail/api/app/services/stalwart_password.py.
        password: data.jmap_token,
      },
    };
  }

  // Sandbox path: deterministic values that match the prod hostnames so
  // the agent's config layout is identical between sandbox and real.
  const address = `${localpart}@windymail.ai`;
  const password = `sandbox-pass-${localpart}`;
  return {
    address,
    display_name: localpart,
    imap: { host: "imap.windymail.ai", port: 993, tls: "implicit", username: address, password },
    smtp: { host: "smtp.windymail.ai", port: 587, tls: "starttls", username: address, password },
    jmap: {
      endpoint: "https://jmap.windymail.ai/jmap",
      account_id: `u_sandbox_${localpart}`,
      username: address,
      password,
    },
  };
}

// ---------------------------------------------------------------------------
// Synapse / Matrix — creates a user + minted access token.
//
// REAL endpoint: PUT {SYNAPSE_BASE_URL}/_synapse/admin/v2/users/@<localpart>:windychat.ai
//   Authorization: Bearer SYNAPSE_ADMIN_TOKEN
// Followed by: POST .../_synapse/admin/v1/users/.../login to mint an access_token.
// TODO: SYNAPSE_ADMIN_TOKEN is not yet in kit-army-config — bootstrap one and add.
// ---------------------------------------------------------------------------

// Wave C: real Synapse provisioning. The Worker calls two admin endpoints:
//
//   1. PUT  /_synapse/admin/v2/users/@<localpart>:windychat.ai
//        Bearer + JSON {password, admin: false, deactivated: false}
//        Creates the user (idempotent — re-PUT just updates).
//   2. POST /_synapse/admin/v1/users/@<localpart>:windychat.ai/login
//        Bearer (empty JSON body)
//        Mints a long-lived access_token AS the user. We return THIS
//        token in the bundle, never the admin token — the agent
//        authenticates as itself, not as windy-connect-admin.
//
// Both calls go through the nginx gateway in chat.windychat.ai.conf
// (Wave C, sneakyfree/windy-chat PR #82) which requires the
// X-Windy-Connect-Admin-Token header on top of the Bearer. Two
// independent secrets — leaking either alone doesn't grant admin.

interface SynapseLoginResponse {
  access_token: string;
  device_id?: string;
  user_id: string;
}

async function provisionChat(
  env: Env,
  input: ProvisionInput,
  real: boolean,
): Promise<MatrixChat> {
  const localpart = sanitizeLocalpart(input.google_email);
  const matrix_user_id = `@${localpart}:windychat.ai`;

  // Real branch opt-in: BOTH Synapse secrets must be present. Missing
  // SYNAPSE_ADMIN_GATEWAY_TOKEN → nginx would 403; missing
  // SYNAPSE_ADMIN_TOKEN → Synapse would 401. Falling back to sandbox
  // in those cases keeps the rest of the bundle deployable while the
  // gateway is still being rolled out on EC2.
  if (real && env.SYNAPSE_ADMIN_TOKEN && env.SYNAPSE_ADMIN_GATEWAY_TOKEN) {
    const base = env.WINDY_CHAT_HOMESERVER_URL ?? "https://chat.windychat.ai";
    const userId = matrix_user_id;
    const password = randomPassword(32);

    // 1. Create-or-update the user. 200 (existing) or 201 (new) — both
    //    are fine for re-pair.
    const createRes = await fetch(
      `${base}/_synapse/admin/v2/users/${encodeURIComponent(userId)}`,
      {
        method: "PUT",
        headers: {
          authorization: `Bearer ${env.SYNAPSE_ADMIN_TOKEN}`,
          "X-Windy-Connect-Admin-Token": env.SYNAPSE_ADMIN_GATEWAY_TOKEN,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          password,
          admin: false,
          deactivated: false,
          displayname: localpart,
        }),
      },
    );
    if (!createRes.ok) {
      throw new Error(
        `synapse user create failed: ${createRes.status} ${await createRes.text()}`,
      );
    }

    // 2. Mint an access_token AS the user. The admin login endpoint
    //    issues a token without the user's password.
    const loginRes = await fetch(
      `${base}/_synapse/admin/v1/users/${encodeURIComponent(userId)}/login`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.SYNAPSE_ADMIN_TOKEN}`,
          "X-Windy-Connect-Admin-Token": env.SYNAPSE_ADMIN_GATEWAY_TOKEN,
          "content-type": "application/json",
        },
        body: "{}",
      },
    );
    if (!loginRes.ok) {
      throw new Error(
        `synapse admin login failed: ${loginRes.status} ${await loginRes.text()}`,
      );
    }
    const login = (await loginRes.json()) as SynapseLoginResponse;

    return {
      kind: "matrix",
      homeserver: base,
      matrix_user_id: userId,
      access_token: login.access_token,
      device_id: login.device_id ?? "WINDY_CONNECT",
    };
  }

  return {
    kind: "matrix",
    homeserver: "https://matrix.windychat.ai",
    matrix_user_id,
    access_token: `syt_sandbox_${localpart}`,
    device_id: "WINDY_CONNECT_SANDBOX",
  };
}

// ---------------------------------------------------------------------------
// Windy Mind — issue a per-user OpenAI-compatible API key.
//
// REAL endpoint: POST {WINDY_MIND_API_URL}/admin/keys
//   Authorization: Bearer $MIND_ADMIN_TOKEN
//   body: { subject_email, tier }
//   returns 201 with: { key, key_id, subject_email, tier, created_at,
//                       expires_at, issued_by }
//   The `key` is a `wm_*` token returned ONCE — we embed it in the
//   bundle's `windy_mind.api_key`. Shipped in windy-mind PR #38
//   (sneakyfree/windy-mind feat/admin-keys-issuance).
// ---------------------------------------------------------------------------

interface MindIssueResponse {
  key: string;
  key_id: string;
  subject_email: string;
  tier: string;
  created_at: string;
  expires_at: string | null;
  issued_by: string;
}

async function provisionMind(
  env: Env,
  input: ProvisionInput,
  real: boolean,
): Promise<OpenAICompatibleMind> {
  const mindApi = env.WINDY_MIND_API_URL ?? "https://api.windymind.ai";

  if (real) {
    if (!env.MIND_ADMIN_TOKEN) {
      throw new Error("MIND_ADMIN_TOKEN secret is unset");
    }
    const res = await fetch(`${mindApi}/admin/keys`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${env.MIND_ADMIN_TOKEN}`,
      },
      body: JSON.stringify({
        subject_email: input.google_email,
        tier: input.tier === "credentialed" ? "credentialed" : "free",
      }),
    });
    if (!res.ok) {
      throw new Error(`mind /admin/keys failed: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as MindIssueResponse;
    return {
      kind: "openai-compatible",
      base_url: `${mindApi}/v1`,
      api_key: data.key,
      default_model: "windy-mind-auto",
      models_endpoint: `${mindApi}/v1/models`,
    };
  }

  const localpart = sanitizeLocalpart(input.google_email);
  return {
    kind: "openai-compatible",
    base_url: `${mindApi}/v1`,
    api_key: `wm_sandbox_${localpart}`,
    default_model: "windy-mind-auto",
    models_endpoint: `${mindApi}/v1/models`,
  };
}

// ---------------------------------------------------------------------------

function sanitizeLocalpart(email: string): string {
  const local = email.split("@")[0] ?? "agent";
  return local.toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 40) || "agent";
}

function randomPassword(len: number): string {
  const alphabet = "ABCDEFGHJKMNPQRSTVWXYZabcdefghjkmnpqrstvwxyz23456789";
  const buf = new Uint8Array(len);
  crypto.getRandomValues(buf);
  let s = "";
  for (let i = 0; i < len; i++) s += alphabet[buf[i]! % alphabet.length];
  return s;
}
