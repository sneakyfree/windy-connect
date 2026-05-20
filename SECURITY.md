# Security Policy

## Supported versions

We support the latest minor version on PyPI. Security fixes land there first
and are backported only when the previous version is widely deployed.

| Version | Supported |
|---|---|
| 0.2.x   | ✅ |
| < 0.2   | ❌ |

## Reporting a vulnerability

**Please do not open a public GitHub issue for security bugs.**

Email **security@windyconnect.com** with:
- A description of the issue and its impact
- Steps to reproduce (or a proof-of-concept)
- Your name + affiliation (optional)

We aim to:
- Acknowledge your report within **3 business days**
- Provide a remediation timeline within **7 business days**
- Disclose the issue publicly only after a fix has shipped

## What we consider in-scope

- Authentication bypass on `/v1/device/*` or `/v1/pair/*`
- Cross-site request forgery on `/v1/pair/submit`
- Eternitas Passport Token (EPT) signature bypass or forgery
- Unauthorized credential issuance from the Worker
- Leaking secrets in error responses or logs
- Path traversal or arbitrary write through any writer
- Tampering with installer payloads served from `get.windyconnect.com`

## What is out of scope

- Vulnerabilities in third-party services we depend on (PyPI, ClawHub,
  Cloudflare, Resend, AWS); report those upstream
- Issues that require a compromised host environment to exploit
- DoS by exhausting your own account quotas

## Coordinated disclosure

If you've found a critical issue affecting multiple Windy products
(`windy-pro`, `eternitas`, `windy-mail`, `windy-chat`, `windy-mind`, etc.),
email **security@windyconnect.com** and mention the cross-product nature.
We'll loop in maintainers of the other affected projects under embargo.

## Known security trade-offs

- The orchestrator's `/v1/device/init` endpoint is currently lenient about
  malformed JSON. (Closed in 0.2.2.) Pre-OAuth-wiring, this is acceptable —
  see the design note in `docs/upstream-gaps.md`.
- Bundles minted while `ENABLE_REAL_PROVISIONING=false` are sandbox-only and
  carry no signing authority. **Do not use them for production trust
  decisions.** Look at the `eternitas.ept` field — if its `kid` is `mock`,
  it's a sandbox bundle.
