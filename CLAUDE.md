# windy-connect — repo notes

## Windy Admin telemetry (stress-test contract) — 2026-07-07

**There is ONE super-admin dashboard for the whole ecosystem at
`https://admin.windyword.ai`** (repo `sneakyfree/windy-admin`, ADR-WA-001).
Every platform PUSHES small content-free JSON events to its central ingest;
the dashboard reads them (Fleet / Members / Agents / Cost / Experiment /
Audit). **When you stress-test this platform, it is part of the job to prove
its activity shows up on that dashboard.** Missing telemetry is a GAP to
close, exactly like a bug — and each platform verifying its own telemetry in
parallel doubles as a load test of the panel.

**This repo:** NOT WIRED — should emit connect.paired / bundle lifecycle events. Token `…__WINDY_CONNECT` is pre-minted and live in the ingest map.

**Verify during your stress test** (read token `verify-oc5` in lockbox
`secrets/windy-admin/ingest-tokens.env`):
```bash
curl -s "https://admin.windyword.ai/v1/events/tail?limit=10&platform=windy-connect" \
  -H "Authorization: Bearer <verify-oc5>" | python3 -m json.tool
```
Drive real traffic, then confirm your events appear here AND on the dashboard
page they feed. If they don't, fix the emitter (or the aggregation query).

**Hard rules (non-negotiable):**
- **Fire-and-forget**: post async, short timeout, swallow every error. A dead
  ingest must NEVER break this product (proven: chat runs fine with the ingest
  down).
- **Inert unless configured**: no-op when `WINDY_ADMIN_INGEST_URL` /
  `WINDY_ADMIN_INGEST_TOKEN` are unset.
- **Privacy hard line**: counts / costs / durations / models / ids only. Cost
  is INTEGER microcents (10^-6 USD). The ingest 422s any metadata key whose
  camelCase/snake tokens match content/text/body/message/prompt/transcript/
  subject/html/completion/reply — if you get 422'd, FIX THE EVENT, never ask
  for the guard to be loosened.

**Full brief + per-platform table + how-to-instrument:**
`~/kit-army-config/docs/windy-admin-telemetry-campaign-2026-07-07.md`.
