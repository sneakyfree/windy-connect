---
name: windy-access
description: "Wire an OpenClaw agent into the Windy ecosystem in one command. Use when the user wants their agent to have an email address (Windy Mail), a chat identity on Matrix (Windy Chat), an Eternitas passport (verifiable identity), and free LLM access (Windy Mind, OpenAI-compatible). Triggers on phrases like 'connect my agent to Windy', 'give my agent an email', 'set up windy-connect', 'agent credentials bundle'. Pairing happens in a browser via Sign-in-with-Google; the CLI writes credentials into XDG config locations OpenClaw already reads."
user-invocable: true
license: MIT
compatibility: Designed for OpenClaw and other agent runtimes that follow the XDG Base Directory spec for secrets and extensions. Requires Python 3.11+ on macOS or Linux.
metadata:
  author: sneakyfree
  version: "0.1.0"
  openclaw:
    emoji: "🌪️"
    homepage: https://github.com/sneakyfree/windy-connect
    requires:
      bins:
        - python3
    install: []
allowed-tools: Read Bash(windy:*) Bash(pipx:*) Bash(curl:*) Bash(python3:*) AskUserQuestion
---

**Persona:** You are an agent-onboarding assistant who completes a one-shot pairing between an OpenClaw install and the Windy ecosystem. You preserve idempotency and reversibility above all else — every write goes into XDG-conventional locations the host runtime already reads, and every change is undoable via `windy disconnect`.

# What this skill does

`windy connect` mints an **Eternitas Agent Credentials Bundle (v1)** for the current agent and writes four sets of credentials into the host OpenClaw install:

| Credential | File written | Purpose |
|---|---|---|
| Windy Mail (IMAP/SMTP/JMAP) | marker-bounded block in `$XDG_CONFIG_HOME/himalaya/config.toml` | Send/receive email as `<agent>@windymail.ai` |
| Windy Chat (Matrix) | `$XDG_CONFIG_HOME/openclaw/secrets/windy-chat.env` | Talk on `matrix.windychat.ai` with humans (and, with Eternitas, other agents) |
| Windy Mind (OpenAI-compatible LLM) | `$XDG_CONFIG_HOME/openclaw/secrets/windy-mind.env` + `$XDG_CONFIG_HOME/openclaw/extensions/windy-mind/openclaw.plugin.json` | Free / tiered LLM access at `https://api.windymind.ai/v1` |
| Eternitas passport (optional, opt-in) | bundle field; surfaced via `windy status` | Verifiable identity for agent-to-agent trust (per ADR-052 two-tier access) |

# When to use this skill

Trigger when the user asks for any of:

- "Give my agent an email address."
- "Connect my OpenClaw to Windy."
- "Set up a Matrix identity for this agent."
- "Wire in a free LLM provider."
- "Pair my agent with an Eternitas passport."

Skip this skill if `windy status` already reports a live, non-expired bundle — pairing is idempotent but the user usually doesn't need a second one.

# How to use this skill

## 1. Verify the CLI is installed

```bash
windy version
```

If `windy` is not on PATH:

```bash
curl -fsSL https://get.windyconnect.com | sh
# or, manually:
pipx install windy-connect
```

The installer is idempotent and chooses pipx > pip --user based on what's available. Python 3.11+ is required.

## 2. Run the pair flow

```bash
windy connect
```

This:

1. Opens `https://api.windyconnect.com/pair` in the user's default browser with a one-time user code.
2. Polls `POST /v1/device/poll` (RFC 8628 device-code flow) until the user finishes Sign-in-with-Google in the browser.
3. Receives the bundle, validates it against the Eternitas JWKS, and writes credentials into the locations in the table above.

The CLI prints a clear summary of every file it wrote and every config block it touched (marker-bounded so reversal is exact).

## 3. Verify

```bash
windy status
```

Reports what's wired and when each credential expires. Bundles refresh automatically when within 7 days of expiry (or when `windy refresh` is invoked).

## 4. Unwind, if needed

```bash
windy disconnect --yes
```

Removes every file the CLI wrote and strips every marker-bounded block. **Does not touch the user's other Himalaya accounts or any unrelated OpenClaw extensions.**

# Tier choice (per ADR-052)

The pair page asks the user to pick one of two tiers:

- **Anonymous tier** — no Eternitas passport. Email + chat + Mind all work; identity is a per-install opaque token.
- **Credentialed tier** — Eternitas passport minted; agent can authenticate to other agents in the ecosystem (and, eventually, to humans who require verifiable identity).

When you (the assistant) run this skill on behalf of the user, ask which tier they want unless they've already specified. Default to anonymous if uncertain — they can `windy upgrade` later.

# When things go wrong

| Symptom | Likely cause | Fix |
|---|---|---|
| `windy: command not found` after install | `~/.local/bin` not on PATH | Add `export PATH="$HOME/.local/bin:$PATH"` to shell rc; reopen shell |
| Pair page returns "device-code expired" | User took >15 min in the browser | Re-run `windy connect` to start a new session |
| `windy status` shows everything except Mail | Stalwart admin endpoint unreachable | Network issue — retry; if persistent, file a windy-connect issue |
| Mind requests get 401 from `api.windymind.ai` | Mind admin-key endpoint not yet wired (pre-launch) | Tracked in `docs/upstream-gaps.md`; the sandbox key works for local testing |

# Files this skill touches

This skill ONLY runs `windy` CLI commands. It does NOT write files directly — every write goes through `windy connect`, which uses marker-bounded blocks and isolated env files so that reversal is precise. Do not bypass `windy connect` to install credentials manually.
