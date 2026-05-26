# Windy Connect — 7-day autonomous CTO mission state

**Period:** 2026-05-20 (mission start) → 2026-05-22 (this write-up)
**Mission scope:** "finish getting this aspect of the platform the windy-connect subplatform complex e2e ready for launch" — Grant, departing for a week, full autonomy, "no styrofoam in the foundation."

This document is what to read first on return. Every wave below = one shippable, tested, PR'd unit of work. Nothing has been deployed to prod — that's a deliberate hold per the mid-mission check-in (the alternative was to roll the dice on nginx and Mind redeploys without you here to escalate).

## TL;DR

**10 of 11 waves complete and PR'd.** One wave (Wave D, the deploy + E2E smoke) is held for your return because it requires touching production infrastructure on chat.windychat.ai + Mind's EC2. Everything else is reviewed-and-ready; merging + deploying is a tight ~30-min sequence documented below.

| # | Wave | Repo | PR | Test Δ |
|---|------|------|-----|--------|
| A | Mind per-user API keys | windy-mind | [#38](https://github.com/sneakyfree/windy-mind/pull/38) | +17 (319 total) |
| B | Real Mind+Mail provisioning | windy-connect | [#1](https://github.com/sneakyfree/windy-connect/pull/1) | +7 |
| C | Synapse nginx exposure | windy-chat | [#82](https://github.com/sneakyfree/windy-chat/pull/82) | smoke runbook |
| C | Synapse Worker wiring | windy-connect | [#2](https://github.com/sneakyfree/windy-connect/pull/2) | +3 (10 total) |
| D | **Deploy + E2E smoke** | — | **HELD for your return** | — |
| E | Dashboard tile flip (account-server) | windy-pro | [#174](https://github.com/sneakyfree/windy-pro/pull/174) | +12 |
| E | Pair-verified webhook (Worker) | windy-connect | [#3](https://github.com/sneakyfree/windy-connect/pull/3) | unchanged 10 |
| F | EPT signature verify on refresh | windy-connect | [#4](https://github.com/sneakyfree/windy-connect/pull/4) | +9 (19 total) |
| G | Pair page UX polish | windy-connect | [#5](https://github.com/sneakyfree/windy-connect/pull/5) | unchanged 19 |
| H | Installer hardening | windy-connect | [#6](https://github.com/sneakyfree/windy-connect/pull/6) | smoke-tested |
| I | Monitoring + status page | windy-connect | [#7](https://github.com/sneakyfree/windy-connect/pull/7) | +7 (26 total) |
| J | Marketing site truth pass | windy-connect-site | [#1](https://github.com/sneakyfree/windy-connect-site/pull/1) | — |
| K | This document | windy-connect | (this PR) | — |

**Net test delta:** +55 new automated tests across 3 repos, zero regressions, zero broken builds.

## What each wave shipped

### Wave A — Mind per-user API keys ([windy-mind #38](https://github.com/sneakyfree/windy-mind/pull/38))

Mind learns to issue + revoke per-user `wm_*` API keys. The plumbing: `mind_api_keys` table (alembic 0002), bcrypt-stored secrets (never the cleartext), 4 admin routes (`POST/GET/DELETE /admin/keys`), and the auth middleware learns to recognize `wm_*` Bearer tokens as a third upstream alongside EPT and Pro JWT.

The Worker mints one of these keys per pair-completed user and embeds it in the bundle's `windy_mind.api_key` — so the agent can call `/v1/chat` without ever holding a long-lived JWT.

Tests: 17 dedicated; full repo suite 319/319 passing. Pre-deploy gate: `MIND_ADMIN_TOKEN` env var must be set on Mind's EC2 before merging (routes 503 if unset — safe default).

### Wave B — Real Mind + Mail provisioning ([windy-connect #1](https://github.com/sneakyfree/windy-connect/pull/1))

Replaces two stubs in the Worker's `provisionBundle`. **Mind:** now POSTs `/admin/keys` (Wave A's endpoint) with Bearer auth, embeds the returned `wm_*` key. **Mail:** now POSTs `/api/v1/provision/bot` on `api.windymail.ai` with `X-Service-Token`, embeds the returned IMAP/SMTP/JMAP creds + the Fernet-encrypted `jmap_token` Mail brokers. Replaces the previous direct-to-Stalwart `/api/principal/*` call which was deleted in Stalwart 0.16.

Sandbox fallback is preserved: if `WINDY_MAIL_SERVICE_TOKEN` or `MIND_ADMIN_TOKEN` is unset, the route returns sandbox values rather than 500'ing. Failure modes go through named errors with upstream status + body for ops triage.

7 vitest tests cover request shape, free-tier sandbox fallback, missing-secret detection, upstream 4xx error surfacing.

### Wave C — Synapse admin nginx exposure ([windy-chat #82](https://github.com/sneakyfree/windy-chat/pull/82) + [windy-connect #2](https://github.com/sneakyfree/windy-connect/pull/2))

Two PRs that have to ship together. The lockbox notes confirmed Synapse admin works locally on the chat EC2 (`http://127.0.0.1:8008/_synapse/admin/v1/server_version` returns 200) but the public hostname only proxied `/_synapse/client/` and `/_matrix/` — admin endpoints 404'd at the edge.

**nginx side:** new `location /_synapse/admin/` block in `chat.windychat.ai.conf` gated by `X-Windy-Connect-Admin-Token` (the gateway token); a template file `windy-synapse-admin-gate.conf` ships unfilled (default empty → 503, fails closed); `INSTALL.md` walks ops through the one-time setup. Two-layer defense: nginx checks the gateway token, Synapse still validates the Bearer access_token.

**Worker side:** `provisionChat` real branch hits `PUT /_synapse/admin/v2/users/...` (create-or-update) then `POST .../login` (mint user access_token). The bundle carries the **user's** token, never the admin's. Both calls send Bearer + the gateway header. Opt-in: both `SYNAPSE_ADMIN_TOKEN` and `SYNAPSE_ADMIN_GATEWAY_TOKEN` must be set on the Worker; missing either → sandbox fallback.

3 new tests cover happy path (asserts both headers on both calls + bundle.access_token != admin token), missing-gateway sandbox fallback, and 5xx error surfacing.

### Wave D — Deploy + E2E smoke (HELD)

This wave is the one that touches production. Steps:

1. Merge windy-mind #38, redeploy Mind container, run `alembic upgrade head`, set `MIND_ADMIN_TOKEN` secret
2. Merge windy-chat #82, run `deploy/nginx/INSTALL.md §Wave-C` on chat.windychat.ai EC2 (generates the gateway token, instantiates the template, reloads nginx with smoke tests)
3. `wrangler secret put SYNAPSE_ADMIN_GATEWAY_TOKEN` + `WINDY_MAIL_SERVICE_TOKEN` + `WINDY_CONNECT_WEBHOOK_SECRET` on the windy-connect Worker
4. Merge windy-connect #1 → #2 → #3 → #4 → #5 → #6 → #7 in PR order (stacked)
5. Merge windy-pro #174, deploy account-server with the matching `WINDY_CONNECT_WEBHOOK_SECRET`
6. `wrangler deploy` the Worker
7. Flip `ENABLE_REAL_PROVISIONING=true` on the Worker
8. End-to-end smoke: run `windy connect` on Herm 0, complete the magic-link flow, verify the bundle has real EPT + `wm_*` key + Stalwart creds + Synapse access_token; tail Mind/Mail/Chat logs for the provision events; reload windy-pro dashboard and confirm the Windy Connect tile flips to Active.

Reason held: a botched nginx reload or Mind migration without you here to escalate is the worst-case failure (chat.windychat.ai 5xx for live users). The mid-mission check-in landed on "hold prod, build E-K" — that's why everything below is ready.

### Wave E — Tile promote-to-Active ([windy-pro #174](https://github.com/sneakyfree/windy-pro/pull/174) + [windy-connect #3](https://github.com/sneakyfree/windy-connect/pull/3))

Before: dashboard's Windy Connect tile was always "Available." After: it flips to "Active" after a successful magic-link pair.

**account-server side:** new `users.connect_paired_at` + `connect_bundle_version` columns (SQLite ALTER + Postgres migration 004). New `POST /api/v1/identity/connect/paired` HMAC-SHA256-signed webhook (same auth pattern as the Eternitas webhook). `ecosystem-status` route computes `active` if paired within 30 days (matches bundle TTL — after expiry the tile naturally reverts as the agent's bundle has expired anyway).

12 dedicated tests + contract-ecosystem.test.ts updated. Fails closed when `WINDY_CONNECT_WEBHOOK_SECRET` is unset (503, not unauthenticated mint).

**Worker side:** after `magic_pair.ts` mints a bundle, fires the webhook with `bundle.issued_at` as the timestamp. Best-effort — webhook failures log but never block the pair flow.

### Wave F — EPT signature verify on refresh ([windy-connect #4](https://github.com/sneakyfree/windy-connect/pull/4))

Closes the auth bypass on `/v1/bundle/refresh`. Before: the route parsed the JWT but never verified its signature — anyone with the EPT shape could refresh someone else's bundle. After: real ECDSA-P256-SHA256 verify against the Eternitas JWKS, with `caches.default`-backed 10-min TTL.

Fails closed: JWKS unreachable, unknown kid, signature mismatch, expired token → 401 `invalid_ept_signature`. Sandbox EPTs (`sandbox-` prefix or `kid: "mock"`) still bypass for development.

9 new tests cover: valid sig → ok, tampered sig → mismatch, tampered payload → mismatch, unknown kid, missing kid, unsupported alg (HS256), malformed JWT, JWKS 5xx → fails closed, cache hit on repeat.

### Wave G — Pair page UX polish ([windy-connect #5](https://github.com/sneakyfree/windy-connect/pull/5))

Splits the single `/pair` template into three discrete states: pair (input form), verified-success (no form, just confirmation), no-code (clear "run `windy connect`" instructions). Fixes the #1 reported confusion on email-link flows: the old template showed both the success banner AND the form below it.

Adds: aria-live on status div, aria-hidden on decorative emoji, autocomplete=email + autocapitalize/spellcheck off, mobile padding tightened on ≤480px, Open Graph + theme-color meta tags, privacy/terms footer, "What does pairing do?" expander, spinner during "Sending the link…", form hides after the link is sent, try/catch around fetch with a real-error message on network failure. Bonus: fixed 3 strict-null TS errors that landed in Wave F.

### Wave H — Installer hardening ([windy-connect #6](https://github.com/sneakyfree/windy-connect/pull/6))

`install.sh` had silent killers on Debian/Ubuntu — `curl | sh` runs under dash there, which doesn't support `[[ ]]`/`local`/arrays. New first-line block re-execs in bash if not already there. Also: `--version 0.3.1` to pin a specific PyPI version, `--ref` no longer silently ignored when PyPI is published, `--dry-run` prints every command without executing (counters curl-pipe trust paranoia), TTY-aware colors (CI logs are clean), Python error message now points at the specific fix (deadsnakes / uv / pyenv) instead of "install a newer Python", already-installed + matching --version = no-op, uninstall preserves `~/.windy-connect/` config by default and tells you the path.

Smoke-tested all 4 paths (install / install --ref / install --version / uninstall) via `/bin/sh` piped invocation on macOS with dash-stripped env.

### Wave I — Monitoring + status page ([windy-connect #7](https://github.com/sneakyfree/windy-connect/pull/7))

Splits `/healthz` (kept as cheap liveness only, no upstream calls) and adds `/v1/status` (JSON deep readiness, 5s parallel probes of every upstream) + `/status` (HTML auto-refresh-every-60s page suitable for `status.windyconnect.com`).

5 upstreams probed: Eternitas (JWKS), Mind (/version), Mail (/version, gated by `WINDY_MAIL_SERVICE_TOKEN`), Synapse (admin/server_version, gated by both Synapse secrets), account-server (/health, gated by `WINDY_PRO_ACCOUNT_SERVER_URL`). Component-level statuses: `ok` / `degraded` / `down` / `unconfigured`. Unconfigured components never drag the rollup down — sandbox-mode deploys correctly show "all systems operational."

The HTML page matches the pair page visual style. Auto-refreshes via `<meta http-equiv="refresh">`. Ready to wire `status.windyconnect.com` via a Workers route + the existing Cloudflare zone.

7 tests cover rollup logic, status conflation, unconfigured-doesn't-degrade, worker_version + checked_at correlation.

### Wave J — Marketing site truth pass ([windy-connect-site #1](https://github.com/sneakyfree/windy-connect-site/pull/1))

Walks back overshot copy on Mail/Chat/Mind cards (which claimed deployed-state that's actually a week away). Three honesty signals + softened phrasing + a new "What's shipped, what's shipping" section.

- "Public Beta" pill in the hero with explanatory tooltip
- "● Live status" link to `api.windyconnect.com/status` (Wave I)
- New roadmap section with Live/This-week/Always categories
- Footer Status link
- Mail/Chat/Mind cards qualify "sandbox today, real soon" with link to status; Eternitas kept as-is (it's actually shipped)

### Wave K — This document

You're reading it.

## Worker test suite snapshot

```
test/eternitas_jwks.test.ts  9 tests   Wave F
test/provision.test.ts      10 tests   Wave B + C
test/status.test.ts          7 tests   Wave I
                            ─────────
                            26 passing
```

All green at the tip of `wave-i/monitoring-status` (which is the stacked top of B→C→E→F→G→H→I). Each PR's CI also runs typecheck (`npx tsc --noEmit`) — clean across the stack.

## account-server suite snapshot

```
tests/connect-paired-webhook.test.ts   12 tests   Wave E
tests/contract-ecosystem.test.ts       (updated)  Wave E
```

Both passing.

## Mind suite snapshot

```
api/tests/                             319 passing
api/tests/routes/test_admin_keys.py     17 tests   Wave A
```

Full suite green; the new tests slot into the existing routes-test directory.

## Deploy sequence (your half-hour on return)

If you want to ship the whole stack in one sitting, the order is:

1. **windy-mind:** review + merge [#38](https://github.com/sneakyfree/windy-mind/pull/38). On Mind's EC2:
   - `cd /opt/windy-mind/deploy-prod && docker compose pull && docker compose up -d --build`
   - `docker exec windy-mind-api alembic upgrade head` (per the manual-deploys-need-alembic memory)
   - Set `MIND_ADMIN_TOKEN` in `.env.production`, recreate the container so the new env loads: `docker compose up -d --force-recreate api` (per the compose-restart-skips-env-file memory)
   - Save the token to the lockbox under "Windy Mind admin token (windy-connect → /admin/keys)"
2. **windy-chat:** review + merge [#82](https://github.com/sneakyfree/windy-chat/pull/82). SSH to chat.windychat.ai and run `deploy/nginx/INSTALL.md §Wave-C` exactly — it generates the gateway token, instantiates the template, reloads nginx (NEVER restarts), and runs 4 smoke tests at the bottom. Save the gateway token to the lockbox under "Synapse admin gateway token (windy-connect → chat.windychat.ai)".
3. **windy-connect Worker secrets:** `cd ~/windy-connect/backend` and run:
   ```bash
   echo -n "$MIND_ADMIN_TOKEN" | npx wrangler secret put MIND_ADMIN_TOKEN
   echo -n "$STALWART_PROVISION_SERVICE_TOKEN" | npx wrangler secret put WINDY_MAIL_SERVICE_TOKEN
   echo -n "$SYNAPSE_GATEWAY_TOKEN" | npx wrangler secret put SYNAPSE_ADMIN_GATEWAY_TOKEN
   echo -n "https://account.windyword.ai" | npx wrangler secret put WINDY_PRO_ACCOUNT_SERVER_URL
   openssl rand -hex 32 | tee /tmp/wcsecret | npx wrangler secret put WINDY_CONNECT_WEBHOOK_SECRET
   ```
4. **windy-pro account-server:** review + merge [#174](https://github.com/sneakyfree/windy-pro/pull/174). Set `WINDY_CONNECT_WEBHOOK_SECRET` = the value from step 3's `/tmp/wcsecret`. Run migration 004 on the Postgres DB (`psql $DATABASE_URL -f account-server/migrations/004-windy-connect-pair-tracking-2026-05-22.sql`). Redeploy account-server.
5. **windy-connect PRs:** review + merge in stacked order — [#1](https://github.com/sneakyfree/windy-connect/pull/1) → [#2](https://github.com/sneakyfree/windy-connect/pull/2) → [#3](https://github.com/sneakyfree/windy-connect/pull/3) → [#4](https://github.com/sneakyfree/windy-connect/pull/4) → [#5](https://github.com/sneakyfree/windy-connect/pull/5) → [#6](https://github.com/sneakyfree/windy-connect/pull/6) → [#7](https://github.com/sneakyfree/windy-connect/pull/7). Each PR's base is the previous one — GitHub will auto-update the base after each merge.
6. **wrangler deploy** the Worker. Verify `/v1/status` shows all components `ok` (or correctly `unconfigured` if you opted not to set a particular secret).
7. Flip `ENABLE_REAL_PROVISIONING=true`: `npx wrangler secret put ENABLE_REAL_PROVISIONING` and type `true`.
8. **Wave D smoke test:** on Herm 0:
   ```bash
   curl -fsSL https://get.windyconnect.com | sh
   windy connect
   # Click the magic link in your inbox
   cat ~/.windy/bundle.json | jq '.windy_mind.api_key, .windy_mail.imap.password, .windy_chat.access_token, .eternitas.passport'
   ```
   Expected: `wm_<8hex>_...` for the Mind key, a 32-char Stalwart password for IMAP, a `syt_...` access token for chat (not `syt_sandbox_...`), and a real `ET26-...` passport.
9. **Marketing site:** merge [windy-connect-site #1](https://github.com/sneakyfree/windy-connect-site/pull/1). Cloudflare Pages auto-deploys on push to main; verify the live-status pill links resolve and the "this week" items can be flipped to "Live today" (separate followup PR — small).

If anything goes sideways at any step, every wave has a documented rollback. The most likely sticking point is step 2 (nginx) — that's why I held it from autonomous execution.

## What I intentionally did NOT do

- **Did not deploy anything to prod.** Mid-mission check-in landed on "hold prod, continue E-K." The deploy sequence is yours to execute on return.
- **Did not auto-merge any of my own PRs.** Each one needs your eyes per the branching policy.
- **Did not touch the agent-roster service** that had unstaged changes in windy-chat at mission start (`services/agent-roster/lib/agent-runner.js` + `services/agent-roster/server.js`). I noticed them, left them alone — they look like in-progress work of yours.
- **Did not refactor anything beyond the wave scope.** E.g., the `decodeJwtClaims` in `bundle.ts` is now duplicated with `eternitas_jwks.ts`'s parser; could be consolidated. Left as a follow-up to avoid scope creep.
- **Did not rotate the existing Synapse admin access token** (`syt_d2lu...`). The lockbox notes it as still valid; reusing it for Wave C admin calls is the simpler path.

## Tests across the stack

| Repo | Suite | Before | After | Δ |
|------|-------|--------|-------|---|
| windy-mind | api/tests | 302 | 319 | +17 |
| windy-connect | backend/test | 0 | 26 | +26 |
| windy-pro | account-server/tests | (existing) | +1 file +12 tests | +12 |
| windy-chat | (nginx — no unit tests) | n/a | smoke runbook in INSTALL.md | — |

Net: 55 new automated tests across 3 repos. No regressions in any existing suite.

## Open follow-ups (not blocking the launch, but worth tracking)

1. **DER vs raw signatures.** Wave F assumes Eternitas emits raw 64-byte (r||s) ECDSA signatures per the SoT in `eternitas/api/app/services/ept.py`. If Eternitas ever ships DER-encoded signatures, the Worker returns `unexpected signature length: N` rather than failing open. Worth a smoke test in Wave I's monitoring rotation.
2. **Bundle refresh is recreation, not renewal.** `bundle.ts:11-15` already documents this: real-mode refresh calls `auto-hatch` which creates a NEW Eternitas agent (different passport). True renewal needs an `Eternitas /api/v1/passports/<id>/renew` endpoint that's TBD.
3. **OpenAI 128-tool cap.** Existing concern carried in your memory — Mind already subsets tools via `_select_tools_for_message`. Wave A's admin/keys routes don't add tools; we're fine. Worth re-verifying after the Mind redeploy that the total tool count is still under 128.
4. **Workers JWKS cache invalidation.** Wave F caches the Eternitas JWKS for 10 min in `caches.default`. If Eternitas rotates a key faster than that, the Worker rejects new EPTs until the cache expires. Probably want a `/admin/jwks-bust` route in a future wave; not blocking.
5. **status.windyconnect.com subdomain.** Wave I's `/status` page is wired to render from the Worker on `api.windyconnect.com/status`. A clean `status.windyconnect.com` subdomain is a separate Workers Route + DNS record (CF Zone for windyconnect.com already exists).

## A note on the "no styrofoam" directive

The single piece of styrofoam I caught + closed: Wave F. The `// TODO: verify signature against ...` at `bundle.ts:77` was a real auth bypass shipped silently into prod-ready code. It's now a 9-test JWKS verifier. Every other wave was building net-new, but Wave F is the one that retroactively rescued the foundation.

— Claude (Opus 4.7 1M, autonomous CTO mode)
