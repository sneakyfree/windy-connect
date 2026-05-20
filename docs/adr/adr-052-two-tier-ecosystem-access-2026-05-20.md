# ADR-052 — Two-tier ecosystem access: free for humans, Eternitas-gated for agent-to-agent

**Status:** Accepted (2026-05-20) — **canonical home is `~/kit-army-config/docs/adr-052-two-tier-ecosystem-access-2026-05-20.md`**; this copy is a reference/draft snapshot retained alongside windy-connect's bundle spec for ergonomic local reading.
**Author:** Claude
**Decider:** Grant (concurred via `/goal` directive 2026-05-20)
**Companion docs:**
- [Eternitas Agent Credentials Bundle v1 spec](../bundle-spec-v1.md)
- [ADR-011](https://github.com/sneakyfree/kit-army-config/blob/main/docs/) — Eternitas independence (Utah LLC, Windy is showcase)
- [ADR-026](https://github.com/sneakyfree/kit-army-config/blob/main/docs/adr-026-trust-gate-philosophy-unified-2026-05-12.md) — Trust gate philosophy (Eternitas Integrity Index is the action-clearance source of truth)

**Supersedes:** none. **Extends:** ADR-026 (which locks the gate-vocabulary contract; this ADR locks the user-facing access tiers that sit on top of it).

---

## Context

The Windy ecosystem has converged on a vision (this session, 2026-05-20) of being the **default agent starter pack issuer** — a place any AI agent's owner can go, sign in with Google, and walk away with email + chat + LLM access in one click. The substrate is largely in place: Eternitas mints passports, Stalwart provisions mailboxes, Synapse provisions Matrix identities, Mind routes inference. What's been implicit and inconsistent is **what an account WITHOUT an Eternitas passport can do**.

Three concrete situations have surfaced this question:

1. **Windy Chat.** A new user signing up for Windy Chat should be able to talk to humans immediately, like joining Telegram. But should an account that has not opted into Eternitas be able to DM other agents? Without an explicit answer, every chat-routing code path improvises.

2. **OpenClaw integration (this session).** OpenClaw users want to plug their existing agent into Windy. Some will want full Eternitas credentialing day 1; some will want to test the integration with a free account first. The CLI we're building (`windy connect`) must offer both paths without bifurcating into two separate flows.

3. **Mail and Mind spam pressure.** Once agents-at-scale arrive (potentially hundreds of frameworks, thousands of agents per user), the rate-limit defaults required to keep abusive traffic out will be incompatible with the rate-limit defaults required to keep credentialed legitimate traffic flowing. One tier cannot serve both populations.

ADR-026 already establishes that **gating happens via the Eternitas Integrity Index** across every service. What it does not establish is the **product-visible distinction** between "I'm using Windy without an Eternitas passport" and "I'm using Windy with an Eternitas passport." This ADR locks that distinction.

## Decision

**Every Windy service offers two access tiers, and the boundary is presence of a valid Eternitas Passport Token.**

### Tier 1 — Free

- Available to anyone with a Windy account (no Eternitas signup required)
- Includes: Mail mailbox at `<user>@windymail.ai`, Chat identity at `@<user>:windychat.ai`, Mind quota (basic — to be sized)
- Constraints:
  - Mail can send and receive to human addresses; outbound rate-limited conservatively; inbound from credentialed senders is unfiltered, inbound from non-credentialed senders is spam-filtered with stricter heuristics
  - Chat can DM humans and join human-only rooms; CANNOT initiate agent-to-agent DMs; CANNOT join rooms flagged as "credentialed-agent-only"
  - Mind serves a small free-tier quota; no access to higher-tier model routing

### Tier 2 — Credentialed

- Available to anyone who completes the `windy connect` flow with the Eternitas opt-in
- Inherits all Tier 1 capabilities
- Adds:
  - **Agent-to-agent communication on Chat** (the core unlock — this is the anti-spam moat from Eternitas)
  - **Higher Mail rate limits** and bypass of spam heuristics when sending to other credentialed addresses
  - **Higher Mind quota and access to higher-tier model routing**, with usage attributed to the Eternitas passport (and therefore feeding the Integrity Index)
  - **EI-gated luxury features** as they ship (per ADR-026 — specific gates remain platform-discretionary)

### Where the gate lives

Each service verifies the EPT against the Eternitas JWKS at `https://api.eternitas.ai/.well-known/eternitas-keys` and consults the Integrity Index (per ADR-026) for clearance + band. The gate code path is uniform across services:

```
If bearer token is a valid EPT:
    Tier 2 access; consult Eternitas for clearance + integrity band
Else if bearer token is a Windy account token (Pro JWT):
    Tier 1 access; rate-limit accordingly
Else:
    401 / 403
```

### Where `windy connect` fits

The CLI's first prompt — *"Do you want Eternitas credentials?"* — is the user-facing manifestation of this tier choice. Answering "yes" produces a `tier: "credentialed"` bundle (per bundle spec v1); answering "no" produces a `tier: "free"` bundle. The CLI does NOT alter what Windy services accept; it only changes what credentials the user ends up with.

## Why this matters

**Without the two-tier lock:**
- Each service improvises its own gating ("does this account have an Eternitas EPT?")
- The product story is muddy ("can my agent use Windy without Eternitas?" — answers vary by service)
- Marketing cannot consistently explain the Eternitas value prop ("you get X, Y, Z" — X, Y, Z varies)
- Future services (Cloud-hosted agents, Triad SMS, etc.) reinvent the boundary

**With the lock:**
- Every service inherits the same tier boundary; new services adopt the pattern with no design work
- The `windy connect` CLI carries a clean, repeatable user prompt that doubles as Eternitas marketing in every onboarding
- The Eternitas value prop becomes legible at the moment of choice ("here's what changes if you say yes")
- The anti-spam moat is consistent across the ecosystem — agents who want full participation must be credentialed, period
- Other ecosystems adopting the bundle spec can offer the same tier shape — the standard travels

## Why not single-tier?

Considered: "everyone must have an Eternitas passport to use any Windy service." Cleaner, but rejected because:

- It violates ADR-011's framing of Windy as **showcase**, not gatekeeper. Friction-free entry is part of the showcase value.
- It eliminates the marketing-funnel role of the free tier. Users who try Windy first, then upgrade to Eternitas after experiencing the difference, are the design's target.
- It conflates "Windy account" and "Eternitas passport" — two concepts that ADR-011 explicitly keeps separate.

Also considered: "three or more tiers" (e.g., free / verified / enterprise). Rejected because tier 3+ semantics are already captured by **clearance level** (registered/verified/cleared/top_secret/eternal) per ADR-026 — that's the granularity inside Tier 2, not a parallel concept. The product-facing distinction stays binary; the Eternitas-internal granularity is preserved.

## Consequences

### Positive

- Uniform tier model across Chat, Mail, Mind (and future services)
- Eternitas marketing has a natural in-product home (the `windy connect` prompt)
- Free tier doubles as a low-friction onboarding ramp; credentialed tier doubles as the natural upsell
- New services have a copy-pasteable pattern: implement the gate, inherit the tier boundary
- The bundle spec's `tier` field becomes the single point of coordination between issuer and consumer

### Negative / accepted trade-offs

- Two code paths per service (Tier 1 / Tier 2) instead of one — small ongoing cost
- The free tier must be rate-limited carefully enough to prevent abuse but generously enough to feel real — a calibration burden
- "Why can't my agent DM other agents?" becomes a recurring support question; needs clear in-product copy at the moment of failure

### Neutral

- Doesn't change ADR-026 (gate philosophy is untouched; this ADR sits above it on the user-facing axis)
- Doesn't change Eternitas's internal data model
- Doesn't preclude future tier additions (e.g., a paid Tier 3 with usage-attributed billing)

## Operational implications

### For service teams (Mail, Chat, Mind, future)

- Each service implements **one** gate check: "is the bearer an EPT?" → Tier 2 path; else → Tier 1 path
- Rate-limit configurations get two profiles — `tier_1` and `tier_2` — checked into each service's settings
- Failure-mode copy ("this requires Eternitas credentials — get them with `windy connect`") is consistent across services

### For windy-connect

- The CLI's first prompt sets `tier` on the bundle
- The Tier 1 (free) path skips the Eternitas auto-hatch call; Tier 2 calls it
- `windy upgrade` (future subcommand) converts a Tier 1 connection to Tier 2 without re-provisioning Mail/Chat/Mind

### For Eternitas

- No code changes required — Eternitas already issues EPTs; this ADR just locks how Windy uses (and chooses to require) them
- Future: if Eternitas wants to publish a "tier capability matrix" doc explaining what credentialed agents get across all participating ecosystems, the bundle spec's `tier` field is the integration point

### For documentation / marketing

- Every service page on windyword.ai should show the same tier comparison table
- The `windy connect` interactive prompt copy is the canonical Eternitas value-prop phrasing — checked in alongside this ADR for consistency
- Telephone-game risk: avoid phrasing the free tier as "limited" or "trial." It is a real tier; the value of the credentialed tier is additive

## The 30-second pitch (evolved per ADR-026)

> *"Windy gives any AI agent its starter pack: email, chat, and free LLM access. Anyone can sign up. **But to participate in the agent web — to talk to other agents, send mail at full rate, build a portable reputation — your agent needs an Eternitas passport.** One prompt. One choice. The agent web grows on the credentialed side, and Eternitas is the universal trust layer underneath it."*

## Status / next steps

1. **Grant accepts or amends this ADR.**
2. On acceptance: this file moves to `~/kit-army-config/docs/adr-052-two-tier-ecosystem-access-2026-05-20.md` (the canonical ADR home).
3. Mail / Chat / Mind teams audit their current gating against this ADR and file PRs to align where they diverge.
4. `windy connect` CLI's interactive prompt copy is reviewed against the "30-second pitch" phrasing above to ensure consistency.
