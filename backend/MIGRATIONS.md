# Worker migrations

This Worker uses Cloudflare Durable Objects (DOs) for the device-code
session store. DO classes are versioned via wrangler's `[[migrations]]`
mechanism — each change to a DO's class identity (add new class, rename,
delete, change storage backend) must declare a migration with a fresh tag.

## Current state

| Tag | Date | Change |
|---|---|---|
| `v1-sessions` | 2026-05-20 | Initial: `DeviceSessions` DO class with SQLite-backed storage. |

## How to bump

When you change DO class shape:

1. Add a new `[[migrations]]` block in `backend/wrangler.toml`:
   ```toml
   [[migrations]]
   tag = "v2-<change-name>"
   # one of:
   new_sqlite_classes = ["NewClass"]
   deleted_classes = ["OldClass"]
   renamed_classes = [{from = "Old", to = "New"}]
   transferred_classes = [{from = "Old", from_script = "old-script", to = "New"}]
   ```
2. Keep all PRIOR `[[migrations]]` blocks in the file. Wrangler walks them
   in order to compute the current state — removing an old tag breaks
   future deploys.
3. Deploy via `backend/scripts/deploy.sh`. The direct-API path handles
   migration tag preconditions automatically.

## Gotchas

- **Don't delete a DO class without `deleted_classes`.** The objects
  remain in Cloudflare's state forever otherwise (orphaned, billable).
- **SQLite vs in-memory DOs are not interchangeable.** Migrating between
  them requires `transferred_classes` to a new script + DDL replay.
- **Migration tag precondition errors** (HTTP 412, code 10079) mean the
  account state diverged from what `wrangler.toml` declares. Inspect with:
  ```
  curl -sS -H "Authorization: Bearer $CF_TOKEN" \
    https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/workers/scripts/$SCRIPT/script-settings
  ```
  to see the migration tag Cloudflare thinks is current.

## Why DO and not KV

KV would be simpler, but **none of the tokens in `ACCESS_LOCKBOX.md` have
`Workers KV:Edit` scope** — verified 2026-05-20 against the god token
(returned auth error 10000). KV namespace creation requires Cloudflare
dashboard access we don't have via API. DOs are code-defined and create
themselves at deploy time, sidestepping the issue.

If KV access ever lands, `backend/src/store.ts` already prefers the KV
path (`env.DEVICE_CODES`) over the DO path (`env.SESSIONS`) — flipping
back is a wrangler.toml edit.

See: `feedback_cf_kv_token_gap` in MEMORY.md.
