# Google OAuth setup for windy-connect

The orchestrator's `/v1/oauth/google/start` and `/v1/oauth/google/callback`
routes need `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET`
secrets to flip from dev-mode (raw email) to real Sign-in-with-Google.

**Until these are set, the pair page accepts a raw email in dev-mode
(gated by `ENABLE_REAL_PROVISIONING=false`). This is fine for local
testing but MUST be wired before pre-launch.**

Two paths — pick one.

---

## Path A — Extend `windy-word-oauth` (FAST: ~2 min, no new GCP project)

Reuse the existing OAuth client from `account-server`. Single audience
across windyword.ai + windyconnect.com. Consent screen still says
"Windy Word" — acceptable for an early-pre-launch beta but the brand
mismatch will show to users.

1. Open https://console.cloud.google.com/auth/clients?project=windy-word-oauth
   (sign in as grantwhitmer3@gmail.com)
2. Click **Windy Word Web Client**
3. Under **Authorized JavaScript origins**, add:
   - `https://api.windyconnect.com`
   - `https://windyconnect.com`
4. Under **Authorized redirect URIs**, add:
   - `https://api.windyconnect.com/v1/oauth/google/callback`
5. **Save**
6. Locally, paste these into the windy-connect Worker (values from
   `ACCESS_LOCKBOX.md` § "Windy Word OAuth"):

```bash
cd ~/windy-connect/backend
echo '903006157217-t96uinfn6pm9e550143u556bmc5gl0kr.apps.googleusercontent.com' \
  | npx wrangler@latest secret put GOOGLE_OAUTH_CLIENT_ID
echo '<REDACTED-see-kit-army-config>' \
  | npx wrangler@latest secret put GOOGLE_OAUTH_CLIENT_SECRET
```

7. Verify: `curl -i https://api.windyconnect.com/v1/oauth/google/start?code=TEST-1234`
   should now return a 302 redirect to accounts.google.com (not a 503).

---

## Path B — New GCP project `windy-connect-oauth` (CLEANER: ~10 min)

Brand-clean consent screen ("Continue with Windy Connect"). Separate
audit trail, separate test-user list, separate verification path. This
is the right long-term home.

1. https://console.cloud.google.com/projectcreate
   - Project name: `Windy Connect OAuth`
   - Project ID: `windy-connect-oauth` (auto-fills)
   - Organization: leave as default (grantwhitmer3@gmail.com personal)
2. Wait ~30s for the project to provision.
3. Navigate to **APIs & Services → OAuth consent screen** in the new project
   - User Type: **External**
   - App name: `Windy Connect`
   - User support email: `hello@windyconnect.com`
   - Developer contact: `grantwhitmer3@gmail.com`
   - App domain: `windyconnect.com`
   - Authorized domains: `windyconnect.com`
   - Scopes: add `openid`, `userinfo.email`, `userinfo.profile`
   - Test users: add yourself (`grantwhitmer3@gmail.com`) + a few beta agents
   - Save
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**
   - Application type: **Web application**
   - Name: `Windy Connect Web Client`
   - Authorized JavaScript origins:
     - `https://api.windyconnect.com`
     - `https://windyconnect.com`
   - Authorized redirect URIs:
     - `https://api.windyconnect.com/v1/oauth/google/callback`
   - Create → **copy the Client ID + Client Secret immediately**
5. Add to lockbox under a new section "Windy Connect OAuth" parallel to
   "Windy Word OAuth", including project number, both URIs, and Authorized
   domains.
6. Set the secrets:

```bash
cd ~/windy-connect/backend
echo '<NEW_CLIENT_ID>' | npx wrangler@latest secret put GOOGLE_OAUTH_CLIENT_ID
echo '<NEW_CLIENT_SECRET>' | npx wrangler@latest secret put GOOGLE_OAUTH_CLIENT_SECRET
```

7. Verify with the same `curl /v1/oauth/google/start` smoke test as Path A.

---

## After either path

- **Audit ISSUER_URL drift.** Currently `wrangler.toml` has
  `ISSUER_URL = "https://windyconnect.com"` but the Worker serves `/pair`
  from `api.windyconnect.com`. The OAuth redirect URI uses `ISSUER_URL`,
  so the redirect computes to `https://windyconnect.com/v1/oauth/google/callback`
  — which doesn't resolve until the marketing site ships. Two cleanup
  options:
  - **Quick fix:** set `ISSUER_URL = "https://api.windyconnect.com"` (the
    bundle's `issuer.url` field will then point at the API host — fine for
    pre-launch, less brand-pure)
  - **Proper fix:** add a separate `API_BASE_URL` var and use it for the
    Worker's own URLs; keep `ISSUER_URL` as the brand-facing identity.
    Touches `device.ts`, `oauth.ts`, `provision.ts`.
- Flip `ENABLE_REAL_PROVISIONING="true"` in wrangler.toml `[vars]` ONLY
  AFTER all upstream provisioners (Eternitas auto-hatch, Stalwart admin,
  Synapse admin, Mind admin) are also wired. OAuth alone isn't sufficient
  to enable real provisioning — see `provision.ts` for current TODOs.
