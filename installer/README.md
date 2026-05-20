# `get.windyconnect.com` installer

One-line install script for the `windy-connect` CLI. Hosted on Cloudflare R2 and proxied via Cloudflare DNS.

```bash
curl -fsSL https://get.windyconnect.com | sh
```

## Architecture (per [reference_r2_desktop_distribution_pattern](../docs/dns-plan.md))

```
User
  │
  │  curl https://get.windyconnect.com
  ▼
Cloudflare DNS  ──CNAME──>  R2 public domain
                              │
                              ▼
                       windy-connect-releases  (R2 bucket)
                              │
                              └── install.sh   (this script)
```

## Deploy

```bash
# 1. Create the R2 bucket (one-time)
npx wrangler r2 bucket create windy-connect-releases \
  --jurisdiction=default

# 2. Upload the installer
npx wrangler r2 object put \
  windy-connect-releases/install.sh \
  --file installer/install.sh \
  --content-type "text/plain; charset=utf-8" \
  --cache-control "public, max-age=300"

# 3. Add the CNAME (DNS plan documents this)
#    get.windyconnect.com  →  windy-connect-releases.<account-hash>.r2.cloudflarestorage.com
#    Proxy: ON (orange cloud)
#
# Or use a custom R2 domain: https://developers.cloudflare.com/r2/buckets/public-buckets/
```

Verify after deploy:

```bash
curl -fsSL https://get.windyconnect.com | head -5     # should show the banner
curl -fsSL https://get.windyconnect.com | sh -s -- --help
```

## What the script does

1. Detects OS (macOS / Linux supported; Windows recommends WSL).
2. Verifies Python 3.11+ is available.
3. Installs `windy-connect` via `pipx` (preferred) or `pip install --user`.
4. Source: `git+https://github.com/sneakyfree/windy-connect.git@main` until the package is on PyPI; then switches to `windy-connect`.
5. Warns if `~/.local/bin` isn't on PATH.
6. Runs `windy version` to confirm.

## Uninstall

```bash
curl -fsSL https://get.windyconnect.com | sh -s -- --uninstall
```

## Why bash + curl instead of Homebrew / PyPI only?

- **Discoverability**: `curl get.<product>.com | sh` is the universal install ritual; users expect it for new CLI tools.
- **Pre-PyPI**: lets us install from git while the PyPI listing is being set up.
- **OS-agnostic**: one script for mac + linux, gives consistent UX guidance (PATH, pipx vs pip).
- **Homebrew comes later**: published once the API is stable enough to commit to a formula.
