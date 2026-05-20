# PyPI publishing setup

windy-connect is configured to publish via **PyPI Trusted Publishers**
(OIDC from GitHub Actions). No long-lived `PYPI_API_TOKEN` secret is
needed once the one-time PyPI setup below is done.

## Status

- ✅ `pyproject.toml` build config — sdist + wheel build cleanly (24 KB
  sdist after node_modules exclusions; verified 2026-05-20)
- ✅ `.github/workflows/release.yml` — tag-triggered publish workflow
- ✅ PyPI account — `sneakyfree` (lockbox documented 2026-05-20)
- ✅ Trusted Publisher registration — done 2026-05-20 (env=Any matches
  our `environment: pypi` claim; verified by successful re-run of run
  26187222167 after initial `invalid-publisher` failure)
- ✅ First release tag — `v0.1.0` pushed 2026-05-20
- ✅ Published — `windy_connect-0.1.0` live at https://pypi.org/p/windy-connect
  (sdist + wheel + PEP 740 sigstore attestations)
- ✅ Installer flag — `PYPI_PUBLISHED="true"` flipped 2026-05-20

## Re-cutting future releases

1. Bump `version` in `pyproject.toml` on main
2. `git tag v<version> && git push origin v<version>`
3. Watch the workflow in the Actions tab — publish + GitHub Release happen automatically

## Original one-time setup (kept for reference)

### 1. Register windy-connect as a pending publisher

(PyPI lets you register a publisher BEFORE the package exists. The
first successful tag-push creates the project automatically with this
publisher attached.)

1. https://pypi.org/manage/account/publishing/
2. **Add a new pending publisher → GitHub:**
   - PyPI Project Name: `windy-connect`
   - Owner: `sneakyfree`
   - Repository name: `windy-connect`
   - Workflow name: `release.yml`
   - Environment name: `pypi`
3. Save.

### 2. Add the GitHub environment

The workflow uses GitHub Environments to scope the OIDC token.

1. https://github.com/sneakyfree/windy-connect/settings/environments
2. New environment → name `pypi`. No secrets needed; the OIDC token is
   minted at job runtime.
3. (Optional) Add a required reviewer so tag-push doesn't auto-publish
   without a human ack. Recommended for the first few releases.

### 3. (Optional) TestPyPI dry-run

Same flow as steps 2-3 but with environment name `testpypi` and PyPI
host `test.pypi.org`. Lets you test the workflow without burning the
real PyPI name.

### 4. Cut the first release

Once steps 1-2 are done:

```bash
cd ~/windy-connect

# Verify version
grep '^version' pyproject.toml   # expect 0.1.0

# Tag + push
git tag v0.1.0
git push origin v0.1.0
```

Watch the Actions tab: https://github.com/sneakyfree/windy-connect/actions

If publish succeeds, the package is live at https://pypi.org/p/windy-connect.

### 5. Flip the installer flag

```bash
cd ~/windy-connect
sed -i '' 's/PYPI_PUBLISHED="false"/PYPI_PUBLISHED="true"/' installer/install.sh
git add installer/install.sh
git commit -m "Install from PyPI now that windy-connect 0.1.0 is published"
git push origin main
```

## Troubleshooting

- **Workflow fails with "pushes touching .github/workflows/* are
  rejected":** the GH auth token is missing the `workflow` scope.
  `gh auth refresh -s workflow` to fix.
- **Workflow fails at the publish step with "trusted publisher
  validation failed":** double-check that the workflow filename, owner,
  repo, and environment name on PyPI EXACTLY match this workflow.
  Common gotcha: filename includes the `.yml` extension on PyPI but
  GitHub displays it without.
- **Workflow succeeds but pip can't find the package:** PyPI's CDN can
  take 2-3 min to propagate after the first publish. Try
  `pip install --no-cache-dir windy-connect`.
