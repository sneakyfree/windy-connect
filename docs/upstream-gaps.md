# Upstream provisioning gaps — Synapse + Mind

`provision.ts` fans out to four upstream services. Two of them are wired,
two are blocked on backend work. This doc captures what's missing so the
work isn't lost.

**Verified 2026-05-20** by probing live endpoints + reading both repos.

## Status matrix

| Block | Endpoint needed | Status | Blocker repo |
|---|---|---|---|
| `eternitas` | `POST /api/v1/auto-hatch` | ⚠️ **Path needs verification** (provision.ts:67 says TODO) | `sneakyfree/eternitas` — likely already exists at `routes/bots.py:95-200` per memory; just confirm the JSON shape |
| `windy_mail` (Stalwart) | `PUT /api/principal/<localpart>` | ✅ wired — `STALWART_ADMIN_PASS` is in lockbox (`<REDACTED-see-kit-army-config>`), Stalwart docs confirm shape | — |
| `windy_chat` (Synapse) | `PUT /_synapse/admin/v2/users/...` + `POST /_synapse/admin/v1/users/.../login` | ❌ Admin API **firewalled at nginx** | `sneakyfree/windy-chat` — open admin to internal-trust or add proxy |
| `windy_mind` (OpenAI-compat) | per-user key issuance endpoint | ❌ **No admin route exists** | `sneakyfree/windy-mind` — net-new feature |

## Synapse (windy_chat) — what's missing

**State on EC2 `i-0f603361b88baa4c0` (chat.windychat.ai):**
- Synapse 1.151.0 live; `/_matrix/client/versions` returns 200
- `/_synapse/admin/*` returns 404 over the public hostname — `deploy/nginx/chat.windychat.ai.conf` only exposes `location /_synapse/client/` (no admin)
- `enable_registration: false` in homeserver.yaml
- `registration_shared_secret` IS set (lockbox §Phase 4: `14bc18f3b89bf7b14809235d10ff471f8b9dd801a837ed2ee3497c222ed0e5fc`)

**Two paths to unblock:**

**A. Open admin API behind a scoped header (recommended)**
1. SSH to Phase 4 EC2.
2. Register or promote an admin user:
   ```
   docker compose exec synapse register_new_matrix_user \
     -u windy-connect-admin -a -c /data/homeserver.yaml http://127.0.0.1:8008
   ```
3. Log in as that admin via `/_matrix/client/r0/login` → capture the
   `access_token` from the response. This becomes `SYNAPSE_ADMIN_TOKEN`.
4. Edit `deploy/nginx/chat.windychat.ai.conf` to add:
   ```
   location /_synapse/admin/ {
     # Restrict to the orchestrator's Worker IPs OR require a shared
     # header (set via map { default ""; X-Windy-Admin "1"; })
     proxy_pass http://synapse:8008;
   }
   ```
5. Save `SYNAPSE_ADMIN_TOKEN` to lockbox (Phase 4 block), then set as a
   Worker secret in windy-connect: `wrangler secret put SYNAPSE_ADMIN_TOKEN`.

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

## Sequencing

Both gaps must close BEFORE `ENABLE_REAL_PROVISIONING="true"` flips in
the windy-connect Worker. Stage:

1. Wire Eternitas auto-hatch (verify the JSON shape against
   `routes/bots.py:95-200`; smallest gap)
2. Open Synapse admin via path A above (~30 min)
3. Build Mind admin keys (~1-2 days — schema + middleware + tests)
4. Flip `ENABLE_REAL_PROVISIONING="true"` and smoke-test end-to-end
