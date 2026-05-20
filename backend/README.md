# Windy Connect Orchestrator (Cloudflare Worker)

The backend the `windy connect` CLI talks to. Stateless coordinator that:

1. Hands the CLI a device-code pair (RFC 8628)
2. Hosts the `/pair` browser page where the user signs in
3. Verifies the Google identity (TODO — currently dev-mode email only)
4. Provisions an Eternitas EPT, a Stalwart mailbox, a Matrix identity, and a Mind API key
5. Composes them into an Eternitas Agent Credentials Bundle (`docs/bundle-spec-v1.md`) and returns it

## Routes

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | Redirect to `/pair` |
| GET | `/pair` | HTML page the user opens in a browser |
| GET | `/healthz` | Liveness probe |
| POST | `/v1/device/init` | CLI: start a pairing session |
| POST | `/v1/device/poll` | CLI: poll until paired, receive bundle |
| POST | `/v1/pair/submit` | Pair page: submit the entered code + identity |
| GET | `/v1/oauth/google/start` | Kick off Google OAuth |
| GET | `/v1/oauth/google/callback` | Receive Google's code, exchange for id_token, return to `/pair` |
| POST | `/v1/bundle/refresh` | Renew an expiring bundle (501 in v1) |

## What's stubbed vs. real

`ENABLE_REAL_PROVISIONING` (var, default `"false"`) gates every upstream call:

| Upstream | Sandbox (default) | Real (when `=true`) | Status |
|---|---|---|---|
| Eternitas EPT | deterministic `ET26-SBOX-XXXX` | `POST {ETERNITAS_API_URL}/api/v1/auto-hatch` | endpoint path needs verification against `sneakyfree/eternitas:routes/bots.py:95-200` |
| Stalwart mailbox | `sandbox-pass-…` values | `PUT {STALWART_ADMIN_URL}/api/principal/<local>` with Basic auth | secret `STALWART_ADMIN_PASS` from lockbox; ready to flip |
| Matrix identity | `syt_sandbox_…` token | Synapse admin API | **blocked** — no Synapse admin token in lockbox yet |
| Mind API key | `wm_sandbox_…` key | per-user key endpoint | **blocked** — Mind needs admin `/keys` endpoint |

Flipping `ENABLE_REAL_PROVISIONING=true` before all four are real will throw at runtime — keep it `false` until each is independently tested.

## Deploy

```bash
cd backend
npm install
# First time only:
npx wrangler kv:namespace create DEVICE_CODES
# Paste the returned id into wrangler.toml under kv_namespaces, then:

# Set secrets
npx wrangler secret put STALWART_ADMIN_PASS  # from kit-army-config: <REDACTED-see-kit-army-config>
# (other secrets TODO — see wrangler.toml)

# Deploy to default *.workers.dev URL
CLOUDFLARE_API_TOKEN="$(grep WindyWorkersGateToken ~/kit-army-config/ACCESS_LOCKBOX.md | grep cfut_)" \
  npx wrangler deploy

# To bind api.windyconnect.com — requires god token (Workers Routes:Edit on the zone):
#   uncomment the [[routes]] block in wrangler.toml and re-deploy with the god token.
```

## Test locally

```bash
npm run dev   # wrangler dev — Worker on http://localhost:8787

# In another shell:
curl -X POST http://localhost:8787/v1/device/init -H 'content-type: application/json' \
  -d '{"tier":"credentialed"}' | jq

# Open http://localhost:8787/pair?code=WIND-EAGL in browser, enter any email,
# click Pair, then:
curl -X POST http://localhost:8787/v1/device/poll -H 'content-type: application/json' \
  -d '{"device_code":"<from init>"}' | jq
```

## Wiring the CLI to this Worker

The CLI's `windy connect` (without `--mock`) reads `WINDY_CONNECT_API_URL` if set,
otherwise hardcoded `https://api.windyconnect.com`. After deploy, point the CLI at
the workers.dev URL:

```bash
export WINDY_CONNECT_API_URL=https://windy-connect-orchestrator.<acct>.workers.dev
windy connect
```

## Next milestones

1. Wire Synapse admin token + implement `provisionChat` real path
2. Land Mind per-user key issuance endpoint + implement `provisionMind` real path
3. Verify Eternitas auto-hatch endpoint contract
4. Implement Google id_token verification (`verifyGoogleIdToken` in routes/device.ts) using JWKS at `https://www.googleapis.com/oauth2/v3/certs`
5. Map `api.windyconnect.com` route + remove `--workers.dev` URL from CLI default
6. Implement `/v1/bundle/refresh` (rotate Mail/Mind/Matrix secrets without re-OAuth)
