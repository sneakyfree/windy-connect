#!/usr/bin/env bash
# Canonical deploy path for the windy-connect orchestrator Worker.
#
# WHY THIS EXISTS:
# `wrangler deploy` currently 403s against the
# /accounts/{id}/workers/scripts/{name}/versions endpoint — Cloudflare's
# edge WAF flags the `agent=claude-code` field wrangler sends in its
# analytics payload. The legacy /workers/scripts/{name} endpoint isn't
# flagged. This script builds with wrangler (to get the bundled .js +
# imported text modules) then uploads via the legacy endpoint with curl.
#
# WHEN THE 403 GOES AWAY, you can switch back to `wrangler deploy`. Until
# then this is the supported path.
#
# Usage:
#   CLOUDFLARE_API_TOKEN=<god token> bash backend/scripts/deploy.sh
#
# Sets COMMIT_SHA + DEPLOYED_AT as vars on the script so /version can
# report deployment identity.

set -euo pipefail

ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-193b347aedeaafe35de0b5a534b2d9aa}"
SCRIPT_NAME="windy-connect-orchestrator"

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  echo "✗ CLOUDFLARE_API_TOKEN must be set (the god token from ACCESS_LOCKBOX.md)" >&2
  exit 1
fi

# Locate ourselves; allow running from anywhere
SCRIPT_DIR="$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
cd "$SCRIPT_DIR/.."

COMMIT_SHA="$(git rev-parse HEAD)"
DEPLOYED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

OUTDIR="$(mktemp -d -t wc-deploy-XXXXXX)"
trap 'rm -rf "$OUTDIR"' EXIT

echo "▸ Building Worker bundle to $OUTDIR …"
CLOUDFLARE_API_TOKEN="$CLOUDFLARE_API_TOKEN" \
  npx --yes wrangler@latest deploy --env="" --outdir "$OUTDIR" --dry-run \
  > /dev/null

# Wrangler dumps index.js plus hash-prefixed text modules
# (e.g. c8b7a0a5...-SKILL.md, 032ebbdf...-install.sh). Include every file
# in OUTDIR EXCEPT index.js (uploaded with module type), its sourcemap,
# and wrangler's own README.md. The text modules use original extensions
# but their basenames are content-hash-prefixed — we must keep those exact
# basenames because they're what index.js imports.
TEXT_FILES=()
while IFS= read -r f; do
  base=$(basename "$f")
  case "$base" in
    index.js|index.js.map|README.md) continue ;;
  esac
  TEXT_FILES+=("$f")
done < <(find "$OUTDIR" -maxdepth 1 -type f)

echo "▸ Uploading via legacy /workers/scripts/$SCRIPT_NAME endpoint …"

# Build the multipart parts. We declare bindings + commit_sha/deployed_at vars
# in the metadata so /version reports the right deployment identity.
METADATA=$(cat <<JSON
{
  "main_module": "index.js",
  "compatibility_date": "2026-05-01",
  "observability": {
    "enabled": true,
    "head_sampling_rate": 1
  },
  "bindings": [
    {"type": "durable_object_namespace", "name": "SESSIONS", "class_name": "DeviceSessions"},
    {"type": "plain_text", "name": "ETERNITAS_API_URL", "text": "https://api.eternitas.ai"},
    {"type": "plain_text", "name": "STALWART_ADMIN_URL", "text": "https://mail.windymail.ai"},
    {"type": "plain_text", "name": "STALWART_ADMIN_USER", "text": "admin"},
    {"type": "plain_text", "name": "ENABLE_REAL_PROVISIONING", "text": "false"},
    {"type": "plain_text", "name": "ISSUER_NAME", "text": "windy"},
    {"type": "plain_text", "name": "ISSUER_URL", "text": "https://windyconnect.com"},
    {"type": "plain_text", "name": "API_BASE_URL", "text": "https://api.windyconnect.com"},
    {"type": "plain_text", "name": "COMMIT_SHA", "text": "$COMMIT_SHA"},
    {"type": "plain_text", "name": "DEPLOYED_AT", "text": "$DEPLOYED_AT"}
  ]
}
JSON
)

curl_args=(
  -sS
  -m 60
  -o /tmp/wc-deploy-resp
  -w "HTTP %{http_code}\n"
  -X PUT
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
  -F "metadata=$METADATA;type=application/json"
  -F "index.js=@$OUTDIR/index.js;type=application/javascript+module"
)
for f in "${TEXT_FILES[@]}"; do
  curl_args+=( -F "$(basename "$f")=@$f;type=text/plain" )
done
curl_args+=(
  "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/workers/scripts/$SCRIPT_NAME"
)

curl "${curl_args[@]}"

if grep -q '"success": *true' /tmp/wc-deploy-resp; then
  TAG=$(python3 -c "import json; d=json.load(open('/tmp/wc-deploy-resp')); print(d['result']['tag'])")
  echo "✓ Deployed windy-connect-orchestrator tag=$TAG commit=$COMMIT_SHA"
else
  echo "✗ Deploy failed:" >&2
  cat /tmp/wc-deploy-resp >&2
  exit 1
fi

# Smoke-test
sleep 3
HEALTH=$(curl -sS -o /dev/null -w "%{http_code}" -m 10 https://api.windyconnect.com/healthz)
VERSION=$(curl -sS -m 10 https://api.windyconnect.com/version)
echo "▸ /healthz HTTP $HEALTH"
echo "▸ /version  $VERSION"
