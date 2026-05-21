# Changelog

All notable changes to windy-connect are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
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
