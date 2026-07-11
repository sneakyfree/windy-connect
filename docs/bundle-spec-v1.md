# Eternitas Agent Credentials Bundle — v1

**Status:** Draft (2026-05-20)
**Version:** 1.0.0-draft
**Owner:** windy-connect (reference issuer); Eternitas (passport authority)
**Audience:** anyone building an AI-agent ecosystem that wants to issue or consume credentialed agent identities.

---

## What this spec is

A **bundle** is the JSON document handed to an AI agent at pairing time. It contains everything the agent needs to participate in a credentialed ecosystem: an Eternitas passport token, plus per-service credentials for the ecosystem's chat / mail / inference surfaces.

The bundle exists so that the **issuer** (the ecosystem provisioning the agent) and the **consumer** (the agent or framework using the credentials) have a stable contract. Without it, every agent ecosystem invents its own provisioning payload and every agent framework writes N parsers.

The Windy ecosystem is the **reference issuer** for v1. OpenClaw, Hermes-based frameworks, Claude Code, and any future agent framework are reference **consumers**. Other ecosystems (not just Windy) can issue this same bundle shape if they adopt Eternitas as their passport authority.

## Design principles

1. **Eternitas is the only mandatory block.** Every issuer guarantees a valid passport; everything else is optional. An ecosystem that wants to issue only a passport (no chat/mail/inference) still issues a valid bundle.
2. **Issuer-agnostic.** Field names do not assume Windy. Future issuers (other ecosystems that adopt Eternitas) emit the same shape.
3. **Forward-compatible.** Consumers MUST ignore unknown fields. New service blocks can be added without breaking older consumers.
4. **Short TTLs by design.** Bundles carry both `issued_at` and `expires_at`. Re-issuance is cheap; long-lived secrets are not.
5. **Transport-neutral.** A bundle can be delivered via OAuth callback, written to disk, copy-pasted, or streamed over stdio. Format is the same.

## Schema

```json
{
  "bundle_version": "1.0",
  "issuer": {
    "name": "windy",
    "url": "https://windyconnect.com",
    "icon": "https://windyconnect.com/favicon.png"
  },
  "issued_at": "2026-05-20T17:30:00Z",
  "expires_at": "2026-06-19T17:30:00Z",
  "refresh_url": "https://windyconnect.com/api/v1/bundle/refresh",

  "eternitas": {
    "ept": "<JWT — ES256, signed by Eternitas, verifies against jwks_url>",
    "passport": "ET26-K7BF-42MN",
    "operator_id": "op_b6dc4f...",
    "clearance_level": "verified",
    "integrity_band": "fair",
    "jwks_url": "https://api.eternitas.ai/.well-known/eternitas-keys",
    "revocation_check_url": "https://api.eternitas.ai/api/v1/passports/ET26-K7BF-42MN/status"
  },

  "windy_chat": {
    "kind": "matrix",
    "homeserver": "https://matrix.windychat.ai",
    "matrix_user_id": "@grant_agent:windychat.ai",
    "access_token": "<opaque>",
    "device_id": "WINDY_PAIR_2026_05_20_a1b2c3",
    "default_room_id": "!abcde:windychat.ai"
  },

  "windy_mail": {
    "address": "grant_agent@windymail.ai",
    "display_name": "Grant's Agent",
    "imap": {
      "host": "imap.windymail.ai",
      "port": 993,
      "tls": "implicit",
      "username": "grant_agent@windymail.ai",
      "password": "<app-password>"
    },
    "smtp": {
      "host": "smtp.windymail.ai",
      "port": 587,
      "tls": "starttls",
      "username": "grant_agent@windymail.ai",
      "password": "<app-password>"
    },
    "jmap": {
      "endpoint": "https://jmap.windymail.ai/jmap",
      "account_id": "u123456",
      "username": "grant_agent@windymail.ai",
      "password": "<app-password>"
    }
  },

  "windy_mind": {
    "kind": "openai-compatible",
    "base_url": "https://api.windymind.ai/v1",
    "api_key": "<scoped token; MAY equal the EPT>",
    "default_model": "llama-3.3-70b-versatile",
    "models_endpoint": "https://api.windymind.ai/v1/models"
  },

  "tier": "credentialed"
}
```

## Top-level fields

| Field | Required | Notes |
|---|---|---|
| `bundle_version` | yes | Semantic version of the spec the bundle conforms to. Consumers SHOULD reject majors they don't understand. |
| `issuer` | yes | Identity of the ecosystem that issued this bundle. `name` is a stable slug; `url` is human-resolvable; `icon` is optional. |
| `issued_at` | yes | RFC 3339 timestamp. |
| `expires_at` | yes | RFC 3339. After this, consumers SHOULD refuse to use any credential in the bundle. |
| `refresh_url` | no | If present, the consumer can POST `{ "bundle": <current bundle> }` to receive a refreshed bundle before expiry. Issuer MAY require additional auth. |
| `eternitas` | yes | Passport block. See below. **The only mandatory service block.** |
| `windy_chat` | no | Chat block. v1 only specifies the `matrix` kind. Future: `xmpp`, `irc`, etc. |
| `windy_mail` | no | Mail block. See below. |
| `windy_mind` | no | Inference block. v1 only specifies `openai-compatible`. Future: `anthropic-compatible`, `mcp`, etc. |
| `tier` | yes | Enum: `"free"` or `"credentialed"`. Set by the issuer based on whether the user opted into Eternitas. (A `"free"` bundle MAY omit the `eternitas` block entirely; see "Free tier" below.) |

## `eternitas` block

| Field | Required | Notes |
|---|---|---|
| `ept` | yes | The Eternitas Passport Token: ES256-signed JWT. Subject is the passport number; issuer is Eternitas; expiry typically matches bundle expiry. |
| `passport` | yes | Human-readable passport ID (e.g., `ET26-K7BF-42MN`). Redundant with the JWT subject; included for convenience. |
| `operator_id` | yes | Stable opaque ID for the human operator who owns this agent. |
| `clearance_level` | yes | Enum (Eternitas-defined): `registered`, `verified`, `cleared`, `top_secret`, `eternal`. Reflects the operator's clearance, which gates the agent's ceiling. |
| `integrity_band` | yes | Enum (Eternitas-defined): `critical`, `poor`, `fair`, `good`, `exceptional`. Reflects the agent's current EI band. |
| `jwks_url` | yes | URL where consumers MUST fetch Eternitas's public keys to verify the EPT signature. |
| `revocation_check_url` | no | If present, services consuming this bundle SHOULD periodically poll for revocation (or subscribe to Eternitas's webhook stream). |

## Chat blocks (`windy_chat`)

The `kind` field discriminates the chat protocol. v1 defines only `matrix`. Consumers MUST ignore chat blocks with unknown `kind`.

### `kind: "matrix"`

| Field | Required | Notes |
|---|---|---|
| `homeserver` | yes | Full URL (e.g., `https://matrix.windychat.ai`) |
| `matrix_user_id` | yes | Fully-qualified Matrix ID (e.g., `@grant_agent:windychat.ai`) |
| `access_token` | yes | Long-lived Matrix access token. |
| `device_id` | yes | Matrix device ID minted at pairing. Used so the user can revoke this specific session without logging out other devices. |
| `default_room_id` | no | If present, the room the agent should join on first connect (typically the user-agent DM room). |

## Mail block (`windy_mail`)

Three sub-blocks: `imap` (read), `smtp` (send), `jmap` (modern unified). Issuers SHOULD provide all three; consumers pick whichever they support.

| Sub-block field | Notes |
|---|---|
| `host` | DNS name of the mail server. |
| `port` | TCP port. |
| `tls` | Enum: `implicit` (TLS from connect, port 465/993), `starttls` (upgrade after EHLO/CAPABILITY, port 587/143), `none` (forbidden in production, allowed in dev). |
| `username` | Authentication identity. Usually equals the mailbox address. |
| `password` | App password (NOT the user's Windy account password). Scoped to mail; revocable independently. |

## Inference block (`windy_mind`)

The `kind` field discriminates the inference protocol. v1 defines only `openai-compatible` (because that is the universal de-facto standard, and the format every framework already understands).

### `kind: "openai-compatible"`

| Field | Required | Notes |
|---|---|---|
| `base_url` | yes | What the agent sets as `OPENAI_BASE_URL`. |
| `api_key` | yes | What the agent sets as `OPENAI_API_KEY`. MAY equal the EPT (if Mind accepts EPTs directly) or a separately-scoped token. |
| `default_model` | no | A sensible default model identifier — MUST be a concrete id present in Mind's live catalogue (`GET /v1/models`), e.g. `llama-3.3-70b-versatile`. (The old `windy-mind-auto` placeholder was never a real catalogue id and 422'd on an agent's first call — SOTU-2 G10. If Mind ships a real router alias, adopt it here.) |
| `models_endpoint` | no | Where to fetch the model catalogue. Defaults to `<base_url>/models` per OpenAI convention. |

## Free tier

A bundle with `tier: "free"` MAY omit the `eternitas` block entirely. In that case the agent is identified to Windy services by an account-scoped token in each service block — i.e., the per-service `access_token` / `api_key` / `password` fields — rather than by a portable Eternitas passport.

Free-tier bundles:
- CAN authenticate to Mail/Chat/Mind under the user's own identity
- CANNOT engage in agent-to-agent communication on Windy Chat (gated by Eternitas presence)
- CANNOT participate in features that key off integrity band / clearance

The recommended default is `tier: "credentialed"`. The CLI prompts the user explicitly.

## How a consumer uses the bundle

Pseudocode for an agent framework that received a bundle:

```python
bundle = json.loads(received_bundle)

if bundle["bundle_version"].split(".")[0] != "1":
    raise IncompatibleBundle()

if datetime.now(UTC) > parse(bundle["expires_at"]):
    raise ExpiredBundle()

# Verify the EPT (optional but recommended)
if "eternitas" in bundle:
    jwks = fetch(bundle["eternitas"]["jwks_url"])
    verify_jwt(bundle["eternitas"]["ept"], jwks)

# Wire up each block the framework cares about
if "windy_mail" in bundle:
    write_himalaya_account(bundle["windy_mail"])
if "windy_chat" in bundle and bundle["windy_chat"]["kind"] == "matrix":
    write_matrix_credentials(bundle["windy_chat"])
if "windy_mind" in bundle and bundle["windy_mind"]["kind"] == "openai-compatible":
    write_openai_provider(bundle["windy_mind"])
```

## How an issuer produces the bundle

A reference issuer (Windy Connect):

1. User completes OAuth (Sign in with Google / Apple).
2. Issuer calls Eternitas `/api/v1/bots/auto-hatch` with operator identity, receives passport + EPT.
3. Issuer provisions Mail mailbox via Stalwart JMAP admin, receives credentials.
4. Issuer provisions Chat identity via Synapse admin API, receives access token.
5. Issuer mints Mind API key scoped to the new passport.
6. Issuer assembles the bundle and returns it (via OAuth callback, deep-link, or stdio).

## Versioning

- **v1.x** is additive only. New service blocks, new optional fields. Consumers built for v1.0 MUST continue to function against any v1.x bundle by ignoring unknowns.
- **v2** would be reserved for breaking changes (e.g., a fundamental restructure). Issuers MUST signal a major bump in `bundle_version`. Consumers SHOULD refuse bundles whose major they don't implement.

## Open questions for v1 → v1.1

- **Calendar block.** OpenClaw advertises calendar management. Windy has no calendar product. If/when one ships, add `windy_calendar` with CalDAV credentials.
- **Triad blocks.** Once Windy Text / Call / Cell ship (per memory `reference_call_cell_text_triad.md`), add a `windy_phone` block with the agent's number + Twilio-equivalent credentials.
- **Cloud block.** If Windy Cloud-hosted OpenClaw becomes a thing, add `windy_cloud` with VPS handle + SSH key.
- **Inference: non-OpenAI-compatible providers.** Add `kind: "anthropic-compatible"`, `kind: "mcp"`, etc. as the ecosystem matures.

## Non-goals

- This spec does NOT define how the user authenticates to the issuer. That's the issuer's choice (Sign in with Google / Apple / email / etc.).
- This spec does NOT define the wire protocol between issuer and consumer. JSON over HTTPS is recommended; other transports are allowed.
- This spec does NOT govern Eternitas's internal data model — only the externally-visible passport claims.
