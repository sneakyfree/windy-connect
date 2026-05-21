# Upstream provisioning gaps — Synapse + Mind + Stalwart

`provision.ts` fans out to four upstream services. **Verified live state
2026-05-21** by probing real endpoints + SSH'ing into the boxes.

## Status matrix

| Block | Endpoint | Status | Notes |
|---|---|---|---|
| `eternitas` | `POST /api/v1/bots/auto-hatch` | ✅ **VERIFIED 2026-05-21** | `provision.ts` updated with the real shape. Body: `{agent_name, creator_email}`. Response: `{passport, ept_token, trust_score, bot_type, ...}`. `operator_id` extracted from EPT's `ope` claim. |
| `windy_mail` (Stalwart) | JMAP `Principal/set` (not REST `/api/principal`) | 🟡 **Needs JMAP integration** | `STALWART_ADMIN_PASS` is in lockbox AND set as Worker secret. The REST shape `provision.ts` was written for doesn't exist on this Stalwart instance — admin ops on this box go through JMAP per lockbox §Phase 6. Need either (a) JMAP client in the Worker or (b) thin admin proxy in windy-mail. |
| `windy_chat` (Synapse) | `/_synapse/admin/v2/users/...` | 🟡 **Token bootstrapped, expose pending** | Admin user `@windy-connect-admin2` registered via shared secret 2026-05-21. Access token in lockbox + set as `SYNAPSE_ADMIN_TOKEN` Worker secret. Admin API confirmed working on `127.0.0.1:8008` inside EC2. **BUT** the nginx config (`deploy/nginx/chat.windychat.ai.conf`) only exposes `/_synapse/client/` publicly — Worker can't reach admin endpoints yet. |
| `windy_mind` (OpenAI-compat) | per-user key issuance | ❌ **Net-new feature** | No admin route exists. Schema + middleware + tests required in `sneakyfree/windy-mind`. |

## Synapse (windy_chat) — what's left

**Done 2026-05-21:**
- ✅ Admin user `@windy-connect-admin2:chat.windychat.ai` registered via
  the shared secret (`registration_shared_secret` from lockbox).
- ✅ Access token captured + saved to lockbox + set as `SYNAPSE_ADMIN_TOKEN`
  Worker secret.
- ✅ Token verified to work against `http://127.0.0.1:8008/_synapse/admin/v1/server_version`
  from inside the EC2.

**Remaining: expose the admin API to the Worker.** Two paths (one to pick):

**A. nginx scoped-header expose** — simplest
Edit `deploy/nginx/chat.windychat.ai.conf` on the Phase 4 EC2 to add:
```
location /_synapse/admin/ {
  set $admin_allowed 0;
  if ($http_x_windy_admin_key = "<scoped-secret>") { set $admin_allowed 1; }
  if ($admin_allowed = 0) { return 403; }
  proxy_pass http://synapse:8008;
}
```
The Worker sends `X-Windy-Admin-Key: <scoped-secret>` on every admin call.
Reverse-able by removing the location block.

**B. Thin proxy in windy-onboarding** — narrower attack surface
New endpoint in `sneakyfree/windy-chat/onboarding`: `POST /provision/user`
that takes `{localpart}`, calls admin API on `127.0.0.1:8008` internally,
returns the user + access token. windy-connect calls THIS endpoint with
its own bearer (HMAC). Smaller attack surface than exposing admin API
generally.

**Recommendation: A for speed, B before commercial launch.**

**B. Add a thin proxy in `windy-chat-onboarding` (cleaner, narrower attack
surface)**
1. New endpoint in the onboarding service: `POST /provision/user` that
   takes `{localpart, display_name}` and a shared HMAC header, then calls
   the admin API on `127.0.0.1:8008` from inside the EC2 network.
2. windy-connect calls that endpoint with `SYNAPSE_ADMIN_TOKEN` (which
   becomes a windy-chat-issued bearer, not a Synapse master token).
3. Smaller blast radius: an attacker who steals the windy-connect secret
   can only create users, not browse/delete the whole homeserver.

**Recommendation:** start with A for shipping speed; migrate to B before
real public launch.

**Code in provision.ts:188-211** already throws cleanly when
`ENABLE_REAL_PROVISIONING=true && SYNAPSE_ADMIN_TOKEN` is missing.

## Mind (windy_mind) — what's missing

**State on `35.173.154.119` (api.windymind.ai):**
- `/v1/models` returns the catalog (15+ models live)
- `/admin`, `/admin/keys`, `/v1/admin/keys`, `/api-keys`, `/v1/api-keys`
  all return `{"detail":"Not Found"}`
- `app/routes/` has chat, health_providers, models, route, runtime_claim,
  version, webhooks — **no admin/keys router**
- All requests today hit the single shared `ANTHROPIC_API_KEY` upstream
  (or the equivalent provider key per ADR-022 §5 buffet)

**What needs to be built (net-new):**

1. **Schema:** a `mind_api_keys` table with `(key_id, key_hash, user_id,
   tier, created_at, expires_at, revoked_at, rate_limit_rpm, monthly_cap_usd)`.
2. **Issuance route:** `POST /admin/keys` (requires `MIND_ADMIN_TOKEN`
   bearer set on Mind via env), body `{user_id, tier}`, returns the
   plaintext key once + key_id. Persist `bcrypt(key)`.
3. **Auth middleware extension:** `app/auth/middleware.py` already
   handles EPT and (presumably) bearer auth. Add a path that resolves
   `wm_<rest>` keys via a hashed lookup. Tag the request with the user_id.
4. **Rate limiting:** simplest cut is per-key RPM via Redis or
   Cloudflare WAF; defer hard $-caps to provider broker work.
5. **Revocation:** `DELETE /admin/keys/{key_id}` flips `revoked_at`;
   middleware checks on every request.

**Code in provision.ts:217-238** already throws cleanly when
`ENABLE_REAL_PROVISIONING=true && MIND_ADMIN_TOKEN` is missing.

## Stalwart Mail — what's left

**Done 2026-05-21:**
- ✅ `STALWART_ADMIN_PASS` set as Worker secret on `windy-connect-orchestrator`.

**Remaining: switch from REST `/api/principal` to JMAP `Principal/set`.**
The REST shape that `provision.ts:provisionMail` was originally written for
doesn't exist on the deployed Stalwart instance (all admin ops were done via
JMAP per the original setup notes in lockbox §Phase 6). Path forward:

1. Either implement a JMAP client in the Worker (~200 lines — Principal/set,
   Identity/set, EmailSubmission setup), OR
2. Add a thin admin proxy to `sneakyfree/windy-mail` (recommended — `PUT
   /admin/principal/<localpart>` REST-ish wrapper, internal to that repo).

Pick (2) — keeps Stalwart-specific JMAP knowledge in the windy-mail repo
where it belongs.

## Sequencing

To flip `ENABLE_REAL_PROVISIONING=true` in the Worker, all four need to be
ready. Today's status:

| Block | State |
|---|---|
| Eternitas | ✅ provision.ts updated to verified shape; just needs the flag |
| Synapse | 🟡 token ready; needs nginx admin expose OR onboarding proxy |
| Stalwart | 🟡 secret ready; needs JMAP path OR admin proxy in windy-mail |
| Mind | ❌ admin-keys feature must ship in windy-mind first |

Once 3 of 4 are done, can ship `ENABLE_REAL_PROVISIONING=true` with the
Mind path returning sandbox keys + a clear "Mind admin not yet wired"
flag in the bundle. But cleaner to wait for all 4.
