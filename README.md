# Windy Connect

**The one command that wires any AI agent into the Windy ecosystem.**

```bash
curl https://get.windyconnect.com | sh
windy connect
```

That's it. Sign in with Google. Your agent now has an email address, a chat identity, free LLM access, and (optionally) Eternitas credentials that let it talk to other agents across the agent web.

---

## What this is

Windy Connect is the **agent starter pack issuer** for the Windy ecosystem. One `windy connect` invocation does everything a user would otherwise have to do manually:

| Without Windy Connect | With Windy Connect |
|---|---|
| Go to Telegram → BotFather → /newbot → copy token → paste in OpenClaw config → restart | `windy connect` |
| Set up SMTP/IMAP credentials by hand | `windy connect` |
| Sign up for an LLM provider, generate API key, configure base URL | `windy connect` |
| Apply to Eternitas for a passport | `windy connect` (answer "yes" to the prompt) |

The CLI auto-detects which AI agent frameworks are installed (OpenClaw, Ollama, Claude Code, generic) and writes their respective config files to the right places.

## What gets provisioned

Every `windy connect` run provisions four things:

1. **Eternitas Passport (optional but recommended)** — a third-party JWT credential issued by [Eternitas](https://eternitas.ai), the independent State-Department-and-credit-bureau-for-AI-agents. With it, your agent can engage in agent-to-agent communication on Windy Chat, gets higher rate limits, and starts building an integrity score that compounds across every ecosystem that adopts the Eternitas standard.
2. **Windy Mail mailbox** — `<agent>@windymail.ai`, with IMAP/SMTP/JMAP credentials your agent can use to send and receive mail.
3. **Windy Chat identity** — a Matrix identity (`@<agent>:windychat.ai`) and access token your agent uses to chat with humans (and, with Eternitas, other agents).
4. **Windy Mind quota** — free LLM access via the OpenAI-compatible Windy Mind router (BYOM-capable, multiple providers behind one endpoint).

All four are delivered as a single **Eternitas Agent Credentials Bundle** ([spec](docs/bundle-spec-v1.md)) that the CLI writes to wherever your agent expects it.

## Two-tier access

The Windy ecosystem follows the **two-tier-everywhere** principle (see [ADR-052](docs/adr/adr-052-two-tier-ecosystem-access-2026-05-20.md)):

| Tier | Who | What you get |
|---|---|---|
| **Tier 1 — Free** | Anyone with a Windy account | Mail mailbox, Mind quota, Chat identity (human-facing) |
| **Tier 2 — Credentialed** | Anyone with an Eternitas passport | Everything in Tier 1 **plus** agent-to-agent comms on Chat, higher rate limits on Mail/Mind, EI-gated luxury features |

`windy connect` asks once which tier you want. The Eternitas tier is the recommended default — it's how the agent web prevents spam at scale.

## Repo layout

```
windy-connect/
  src/windy_connect/      # Python CLI (published to PyPI as windy-connect)
  backend/                # Cloudflare Worker orchestrator (TypeScript)
  tests/                  # pytest suite for the CLI
  docs/
    bundle-spec-v1.md     # The Eternitas Agent Credentials Bundle spec
    adr/                  # Architectural decision records
    dns-plan.md
  pyproject.toml
  README.md
```

## Orchestrator backend

The CLI talks to a stateless Cloudflare Worker that mints bundles via Sign-in-with-Google + the device-code OAuth flow (RFC 8628). See [backend/README.md](backend/README.md) for routes, deployment, and what's currently stubbed vs real.

Point the CLI at a non-default orchestrator with `WINDY_CONNECT_API_URL=https://your-orchestrator/...` — useful for staging or local `wrangler dev`.

## Status

**Pre-alpha — full local lifecycle works against a mock bundle.** Real OAuth orchestrator backend not yet deployed. Try it:

```bash
pip install -e .
windy connect --mock        # provision + write configs + persist state
windy status                # show what's wired
windy doctor                # run diagnostics against the current connection
windy disconnect            # reverse everything cleanly
```

State is persisted to `~/.windy/state.json` (mode 0600). Disconnect deletes owned files and strips marker-bounded blocks from shared config files (e.g., Himalaya's `config.toml`) without touching the user's other accounts.

Test suite: `pytest` — 48 tests covering bundle parsing, state round-trip, every writer in dry-run + wet mode, doctor diagnostics, and full CLI lifecycle.

The bundle spec is v1-draft. ADR-052 is Accepted (canonical home: `~/kit-army-config/docs/adr-052-two-tier-ecosystem-access-2026-05-20.md`).

## What's next

See the open issues / project board (once GitHub repo exists).

Immediate roadmap:
1. **`windy connect` CLI MVP** — interactive flow, auto-detection of OpenClaw + Ollama + Claude Code + generic, writes configs to the right places
2. **`/agents/connect` orchestrator backend** — Sign-in-with-Google → mints Eternitas EPT → provisions Mail mailbox → provisions Chat identity → returns the bundle
3. **`get.windyconnect.com` installer** — one-line bootstrap that installs the CLI
4. **`windyconnect.com/pair` browser flow** — the page the CLI opens for the user to sign in
5. **OpenClaw ClawHub skill** — `windy-access` skill on ClawHub for discoverability inside the OpenClaw community

## Naming

- **Product name:** Windy Connect
- **CLI command:** `windy connect` (subcommand of the `windy` binary; future siblings: `windy status`, `windy disconnect`, `windy upgrade`)
- **Repo:** `windy-connect` (this repo)
- **Domain:** windyconnect.com (CLI installer + browser pairing page + marketing)
- **PyPI package:** `windy-connect`
- **Dashboard tile:** "Windy Connect"

## License

TBD (likely MIT for the CLI and skill, proprietary for backend orchestrator).
