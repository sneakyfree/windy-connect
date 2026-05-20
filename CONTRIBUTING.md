# Contributing to windy-connect

Thanks for your interest. This is the agent-onboarding kernel of the Windy
ecosystem — it has to work reliably for a grandma running `windy connect`
on her laptop and for a fleet of Hermes Agents on a GPU farm. We hold quality
above shipping speed.

## Quick start

```bash
git clone https://github.com/sneakyfree/windy-connect
cd windy-connect
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
pytest tests/ -q              # 60+ tests, must all pass
ruff check src/               # must be clean
```

## What lives where

```
src/windy_connect/         Python CLI (PyPI: windy-connect)
  ├─ cli.py                Typer command surface
  ├─ orchestrator.py       device-code client (RFC 8628)
  ├─ detect.py             host-agent detection
  ├─ writers/              per-agent writers (OpenClaw, Hermes, Claude Code, Generic)
  ├─ doctor.py             diagnostics
  └─ _skill_data/SKILL.md  packaged-with-wheel canonical skill markdown

backend/                   Cloudflare Worker (api.windyconnect.com)
  ├─ src/index.ts          entrypoint
  ├─ src/routes/           HTTP handlers
  ├─ src/sessions_do.ts    Durable Object backing the device-code store
  ├─ wrangler.toml         deploy config
  └─ scripts/deploy.sh     canonical deploy path (see MIGRATIONS.md)

skills/windy-access/       canonical skill folder
  ├─ SKILL.md              the skill body (markdown + YAML frontmatter)
  └─ README.md             ClawHub schema reference + publish recipe

docs/                      design + ops docs
tests/                     pytest suite
```

## Pull request checklist

- [ ] `pytest tests/ -q` passes locally (CI also enforces)
- [ ] `ruff check src/` clean
- [ ] New behavior has a test
- [ ] User-visible changes have a `CHANGELOG.md` entry under `[Unreleased]`
- [ ] If you changed `skills/windy-access/SKILL.md`, you also updated the
      Worker's `.well-known/skills/index.json` version + the wheel's bundled
      copy (handled by hatch `force-include`, just bump in `pyproject.toml`)
- [ ] If you changed `.github/workflows/*`, your GitHub auth has the
      `workflow` scope (`gh auth refresh -s workflow`)

## Release process

We use PyPI Trusted Publishers — no manual tokens, no manual `twine upload`.

1. Bump `version` in `pyproject.toml` on `main`.
2. Add release notes under the version heading in `CHANGELOG.md`.
3. Tag: `git tag v<version> && git push origin v<version>`.
4. Watch `.github/workflows/release.yml` — `pypa/gh-action-pypi-publish`
   publishes to PyPI with sigstore attestations on tag push.
5. Bump `SKILL_VERSION` in `backend/src/routes/skills.ts` to match,
   then `bash backend/scripts/deploy.sh` to ship the new index.json.

## Reporting bugs

Open a GitHub issue with:
- The output of `windy doctor` (sanitized — it does not include secrets)
- Your OS + Python version
- What you ran, what happened, what you expected

For security issues, see `SECURITY.md`.

## License

By contributing, you agree your work is licensed under the MIT License,
matching the repo's `LICENSE` file.
