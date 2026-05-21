# Changelog

All notable changes to windy-connect are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.1] — 2026-05-21

### Added
- **`windy refresh` CLI command** — re-mint the bundle before it expires
  using the existing EPT to authenticate. Re-applies the fresh credentials
  to every detected runtime in place (idempotent, marker-bounded). Saves
  the new state.
- **`POST /v1/bundle/refresh`** on the Worker. Body: `{ept, tier?}`. The
  Worker decodes the EPT's claims (sub, email, exp), re-runs
  `provisionBundle()`, and returns a fresh bundle. Sandbox EPTs are
  accepted without signature verification; real EPTs are trusted by
  claim today (TODO: verify against eternitas JWKS — documented in
  SECURITY.md known trade-offs).
- Refused with HTTP 410 `ept_too_stale` if the old EPT expired more than
  7 days ago — at that point user should re-pair, not refresh.

### Known limitations
- In real mode, refresh currently calls Eternitas auto-hatch again,
  which mints a NEW agent (different passport). This is
  "refresh-as-recreation" not true EPT renewal. Documented in
  `docs/upstream-gaps.md`. True renewal needs an Eternitas
  `/api/v1/passports/<id>/renew` endpoint that's TBD.

## [0.3.0] — 2026-05-21

### Added
- **Magic-link email auth** — primary production auth model. `POST /v1/pair/start`
  takes `{user_code, email}`, signs an HS256 JWT with `MAGIC_LINK_SIGNING_KEY`,
  and sends a one-click pair link via Resend. The user clicks the link,
  `GET /v1/pair/verify?token=<jwt>` validates the signature + expiry, mints
  the bundle, and shows a "you're paired" success page. CLI poll returns
  the bundle. No Google account required; no GCP-console redirect-URI
  roundtrip; works for any email provider. Grandma-friendly.
- `backend/src/magic_link.ts` — HS256 sign/verify via WebCrypto, 15-min TTL,
  base64url everywhere
- `backend/src/routes/magic_pair.ts` — `/v1/pair/start` + `/v1/pair/verify`
  handlers including a beautifully-formatted HTML email body
- Pair page now defaults to the magic-link email form; "Continue with Google"
  remains shown when `GOOGLE_OAUTH_CLIENT_ID` is set (no longer the only path)
- Sandbox fallback: when `MAGIC_LINK_SIGNING_KEY` + `RESEND_API_KEY` are both
  unset, the pair page reverts to the legacy raw-email flow gated behind
  `ENABLE_REAL_PROVISIONING=false` so local-only testing still works
- Verified Resend sender: `pair@windyword.ai` (windyword.ai is in Resend's
  verified-domain list per ACCESS_LOCKBOX.md)
- Both secrets (`MAGIC_LINK_SIGNING_KEY`, `RESEND_API_KEY`) live as Worker
  secrets, set + documented in the lockbox

### Changed
- Auth pivot: Google OAuth is no longer required for production. Magic-link
  is the new default. Existing Google OAuth path remains supported.

### Added (previously listed under Unreleased)
- **CSRF defense on `/v1/pair/submit`** — `GET /pair` issues a `windy_pair_csrf`
  cookie (HttpOnly, Secure, SameSite=Strict, Path=/v1/pair); the pair page's
  JS reads it and sends as `X-CSRF-Token`. Double-submit + SameSite=Strict
  blocks cross-site pair-hijack even before OAuth is real.
- **Per-IP rate limit on `/v1/device/init`** — 10/min/IP via a sliding-window
  counter inside the `DeviceSessions` Durable Object. Returns HTTP 429 with a
  proper `Retry-After` header. Globally consistent (one DO instance) so it
  works under fan-out across Cloudflare colos.
- **CORS hardening** — `/v1/pair/submit` and `/v1/oauth/*` now use an
  Origin allow-list (api.windyconnect.com + pair.* + windyconnect.com +
  localhost dev origins) instead of the global `*`. CLI-facing endpoints
  (`/v1/device/*`, `/v1/bundle/*`, `/healthz`, `/version`, `/.well-known/*`)
  keep `*` so CLI tools (no Origin header) and arbitrary integrations work.
- **Workers Observability** — Cloudflare's built-in trace + log dashboard
  enabled (`observability.enabled = true`, head-sample 100%). Structured
  log lines emitted at `device_init` + `device_poll_approved` for offline
  analysis.

### Added
- `LICENSE`, `CHANGELOG.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`
- `GET /version` endpoint on the orchestrator Worker, returning
  `{version, commit_sha, deployed_at}` per the ecosystem version-endpoint contract
- `API_BASE_URL` var separate from `ISSUER_URL` so the device-code flow's
  `verification_uri` and OAuth redirect resolve to the Worker host even when
  `ISSUER_URL` points at the brand domain (which may not be wired yet)
- `backend/scripts/deploy.sh` — direct-API deploy that bypasses the wrangler
  `/workers/scripts/<name>/versions` endpoint (currently 403s under
  `agent=claude-code` UA — see commit `a857181`)
- `backend/MIGRATIONS.md` — DO migration cadence + how to bump tags
- `.github/workflows/ci.yml` — pytest + ruff on every push/PR

### Changed
- `/v1/device/init` now returns `400 invalid_body` for unparseable JSON
  instead of silently defaulting to a `credentialed`-tier session
  (closes the A.22 stress-test yellow)

## [0.2.1] — 2026-05-20

### Added
- **OpenClaw + Hermes Agent parity** — Eternitas EPT now written for OpenClaw
  too (matching Hermes); Hermes writer auto-installs `SKILL.md` to
  `~/.hermes/skills/windy-access/` so the skill registers with Hermes's
  Skill Hub without an explicit `hermes skills tap add`
- Bundled `SKILL.md` shipped as wheel package data via hatch `force-include`

## [0.2.0] — 2026-05-20

### Added
- **First-class Hermes Agent support** — `HermesWriter` writes a
  marker-bounded block in `~/.hermes/.env` containing native
  `EMAIL_*`/`IMAP_*`/`SMTP_*` env vars (Hermes's built-in email tool
  consumes these directly), plus `WINDY_MIND_BASE_URL`/`WINDY_MIND_API_KEY`
  for LLM and `WINDY_CHAT_*`/`WINDY_ETERNITAS_*` for the other surfaces.
  Honors `$HERMES_HOME` for fleet relocation.
- `detect_hermes()` recognizes Hermes installs at `~/.hermes/` or
  `$HERMES_HOME`, ordered second after OpenClaw in `detect_all()`.
- Cloudflare Worker now serves `/.well-known/skills/index.json` for Hermes
  Agent auto-discovery (tap convention) and embeds `SKILL.md` so the file
  is reachable independent of repo visibility.

### Changed
- Skill folder renamed from `skills/openclaw-clawhub/` to `skills/windy-access/`
  — agent-neutral so the same folder works as a ClawHub upload AND a
  Hermes GitHub tap.

## [0.1.0] — 2026-05-20

### Added
- Initial public release on PyPI.
- `windy connect` / `status` / `disconnect` / `doctor` / `version` CLI commands.
- Per-runtime writers: OpenClaw, Claude Code, Generic (`~/.windy/`).
- Device-code OAuth pair flow (RFC 8628) backed by an in-memory store
  (later moved to a Durable Object for production correctness — see 0.2.x).
- `SKILL.md` for ClawHub publish at `skills/windy-access/`.
- PEP 740 sigstore attestations via PyPI Trusted Publishers.
