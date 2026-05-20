# Windy Access — OpenClaw ClawHub skill

The ClawHub-distributable skill that wires an OpenClaw install into the Windy ecosystem in one command.

## What this does

When a user clicks "Install" on `windy-access` in ClawHub, the install hook runs:

```
windy connect
```

which:

1. Detects this is an OpenClaw install (it knows because ClawHub triggered it).
2. Walks the user through the Eternitas opt-in prompt (per ADR-052).
3. Opens a browser to `https://windyconnect.com/pair`, where the user signs in with Google.
4. Receives an Eternitas Agent Credentials Bundle and writes:
   - `$XDG_CONFIG_HOME/openclaw/secrets/windy-chat.env` — Matrix homeserver + access token
   - `$XDG_CONFIG_HOME/openclaw/secrets/windy-mind.env` — Mind API key
   - `$XDG_CONFIG_HOME/openclaw/extensions/windy-mind/openclaw.plugin.json` — Mind provider manifest
   - A marker-bounded block in `$XDG_CONFIG_HOME/himalaya/config.toml` — Mail (IMAP/SMTP/JMAP)

After install, OpenClaw can:

- **Send/receive mail** as `<agent>@windymail.ai` (via Himalaya, which OpenClaw already wraps).
- **Chat with humans (and, with Eternitas, other agents)** on `matrix.windychat.ai`.
- **Use Windy Mind as an OpenAI-compatible provider** at `https://api.windymind.ai/v1`.

## Why ClawHub instead of "just `pipx install windy-connect`"

Three reasons:

1. **Discoverability** — ClawHub users browse capabilities they don't yet know they want. "Get your agent an email address" needs to appear in that catalog.
2. **Reversibility** — ClawHub's uninstall hook runs `windy disconnect --yes`, which cleanly removes Windy credentials (deletes owned files + strips marker-bounded blocks from shared configs) without affecting the user's other Himalaya accounts.
3. **Status visibility** — ClawHub can call `windy status` to surface "connected as X, expires in Y days" inside the OpenClaw UI.

## Publish

```bash
# 1. Verify the manifest renders correctly against the ClawHub schema
clawhub validate ./skill.json     # TODO: real command pending ClawHub docs

# 2. Push to the ClawHub registry
clawhub publish ./skill.json      # TODO: real command pending ClawHub docs

# 3. Once published, users see it at:
#    https://clawhub.openclaw.dev/skills/windy-access
```

## Open questions

The manifest at `skill.json` includes a `_clawhub_todo` block listing fields we need to verify against the actual ClawHub schema. The current shape is inferred from `extensions/openrouter/openclaw.plugin.json` in OpenClaw's tree (which is the closest sibling). Once the ClawHub registry exposes a JSON schema, run `clawhub validate` and adjust.

## Companion

- The CLI itself: `pipx install windy-connect` or `curl get.windyconnect.com | sh`
- Bundle spec: [docs/bundle-spec-v1.md](../../docs/bundle-spec-v1.md)
- ADR-052 (two-tier access): [docs/adr/](../../docs/adr/)
