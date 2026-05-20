# DNS plan — windyconnect.com

**Status:** Zone live in Cloudflare. `api.windyconnect.com` attached 2026-05-20 as a Workers Custom Domain (auto-creates DNS + edge cert + service binding to `windy-connect-orchestrator`). All other planned hostnames still pending their milestones.

- Cloudflare zone ID: `1406c9a30756a386c7465c90877595f2`
- Cloudflare account ID: `193b347aedeaafe35de0b5a534b2d9aa`
- Status: active
- Operator token for DNS work: **WindyDnsEditToken** in `kit-army-config/ACCESS_LOCKBOX.md` (Zone:Read + DNS:Edit, scoped)

## Why this is empty

`windyconnect.com` was purchased 2026-05-20. The orchestrator backend, installer host, and browser pairing flow do not yet exist. Populating DNS records that point at nonexistent backends produces noisy NXDOMAIN-equivalents and false confidence. **Records get added when the surface they point at is ready to serve traffic.**

## Planned record map

| Hostname | Type | Target | Purpose | Unblocked by milestone |
|---|---|---|---|---|
| `windyconnect.com` (apex) | CNAME or A | Cloudflare Pages project (marketing site) | Public landing page | M2 — marketing site shipped |
| `www.windyconnect.com` | CNAME | apex | Conventional alias | M2 |
| `get.windyconnect.com` | CNAME | R2 custom domain (`windy-connect-releases` bucket) | One-line installer: `curl https://get.windyconnect.com \| sh` serves the install script | M3 — installer drafted + R2 bucket created (pattern per [[reference_r2_desktop_distribution_pattern]]) |
| `pair.windyconnect.com` | CNAME/A | Cloudflare Pages or orchestrator EC2 | Browser pairing flow page the CLI opens after Sign-in-with-Google | M4 — pairing page deployed |
| `api.windyconnect.com` | **Workers Custom Domain** | `windy-connect-orchestrator` (Worker) | The OAuth orchestrator backend | ✅ **DONE 2026-05-20.** `cert_id=3badf8d0-9c60-49fe-b0d9-f3f9f25e5abb`, attachment id `5f0390d9f41a635e886c65c62bccc7f34db788e4`. Tested: `GET /healthz` → 200. Provisioned with `TheWindstormCloudflareGodToken` (`workers/domains` PUT). |

## Operational notes

- All records SHOULD be **proxied (orange cloud)** by default per Windy convention. Exception: any record that participates in a TLS handshake the proxy can't terminate (rare).
- Issue ACM/Origin certs through Cloudflare's edge; backend uses Origin CA cert for end-to-end encryption.
- DNS edits go through PR-reviewable scripts (TBD) rather than ad-hoc API calls — preserves audit trail. For initial bootstrap, manual API calls with `WindyDnsEditToken` are acceptable; once we exceed ~5 records the bash script lint pattern from [[reference_canonical_domains_lint]] should apply.

## TODOs that block populating

- [ ] **Marketing site (M2):** decide whether to build a simple static landing page in this repo's `site/` directory or stand up a separate `sneakyfree/windy-connect-site` per [[reference_repo_naming_convention]]. Default: separate repo when it's ready.
- [ ] **Installer (M3):** draft the install script (~50 lines: download CLI artifact for user's platform, verify checksum, place at `~/.local/bin/windy`). Host script in R2 bucket `windy-connect-releases` per [[reference_r2_desktop_distribution_pattern]].
- [ ] **Pairing page (M4):** decide between Cloudflare Pages (cheap, fits the marketing-adjacent UX) or co-located with the orchestrator backend (single source of truth for the OAuth handlers). Probably Pages for the static shell + iframe/postMessage to the orchestrator for credential exchange.
- [ ] **Orchestrator (M5):** EC2 + Caddy + FastAPI, per [[project_adr048_operational_substrate]]. Will need a `SUBSTRATE.md` once deployed.

## How to add a record once a milestone is reached

```bash
# Source the token from the lockbox
CF_TOKEN="<value of WindyDnsEditToken from ACCESS_LOCKBOX.md>"
ZONE_ID="1406c9a30756a386c7465c90877595f2"

# Example: point get.windyconnect.com at the R2 custom domain
curl -X POST "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records" \
  -H "Authorization: Bearer ${CF_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{
    "type": "CNAME",
    "name": "get",
    "content": "windy-connect-releases.r2.cloudflarestorage.com",
    "proxied": true,
    "comment": "Installer; populated at M3"
  }'
```

## Canonical domains list

`windyconnect.com` should be added to the canonical-domains lint registry (see [[reference_canonical_domains_lint]] — JSON source-of-truth in `kit-army-config/`). This ensures non-canonical mentions of the domain across other Windy repos get flagged in PR review. Until that's done, manually grep for typos in PRs touching windy-connect.

## Operator runbook (when shit breaks)

- Records exist but resolution fails → check Cloudflare proxy status; orange cloud requires the origin to present a valid TLS cert (Cloudflare Origin CA is fine)
- Resolution works but origin 502s → check Caddy / orchestrator health
- DNSSEC issues → Cloudflare manages DNSSEC; check zone DNSSEC settings, not records
- Token rejected → `WindyDnsEditToken` is scoped Zone:Read + DNS:Edit only. For higher-privilege ops use `TheWindstormCloudflareGodToken` (lockbox; lives on Kit 0 VPS)
