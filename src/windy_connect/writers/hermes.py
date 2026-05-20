"""Write Windy credentials into a Hermes Agent installation.

Hermes config layout (Nous Research docs, verified 2026-05-20):

    ~/.hermes/
        .env                   # secrets (env vars) — SHARED, use marker block
        config.yaml            # non-secret config — SHARED, we don't touch it
        auth.json              # OAuth credentials
        SOUL.md                # agent identity
        memories/              # persistent memory
        skills/                # installed skills
        cron/, sessions/, logs/

We write a marker-delimited block to ``~/.hermes/.env`` rather than dropping
isolated files so the secret stays in the one place Hermes already reads.
``windy disconnect`` strips only our marked block, leaving any user-managed
env vars untouched.

LLM: Hermes is provider-pluggable. We expose Windy Mind via
``WINDY_MIND_API_KEY`` + ``WINDY_MIND_BASE_URL`` rather than clobbering
``OPENAI_API_KEY`` — the agent learns to use those vars from the windy-access
SKILL.md, and the user's existing OpenAI access (if any) is preserved.

Mail: Hermes has native ``EMAIL_ADDRESS`` / ``EMAIL_PASSWORD`` / IMAP/SMTP env
vars. We populate those directly so Hermes's built-in email tool works without
any skill bridge.

Chat: Hermes does not natively support Matrix (its messaging surfaces today are
Slack/Telegram/WhatsApp/Email/Teams/Discord). We surface the Matrix credentials
through ``WINDY_CHAT_*`` env vars so skills/MCP servers can consume them, but we
do not pretend native Matrix exists.
"""

from __future__ import annotations

import os
from pathlib import Path

from importlib import resources

from ..bundle import Bundle
from .base import BlockEdit, WriteResult, Writer

ENV_MARKER_START = "# --- windy-connect:begin ---"
ENV_MARKER_END = "# --- windy-connect:end ---"


def _bundled_skill_md() -> str | None:
    """Return the canonical windy-access SKILL.md packaged with this wheel.

    Returns None if the package data isn't bundled (e.g. running from an
    editable install before the data file was force-included). In that case
    we skip the skill auto-install — the env-var block alone is sufficient
    for the runtime to function.
    """
    try:
        return (
            resources.files("windy_connect._skill_data")
            .joinpath("SKILL.md")
            .read_text(encoding="utf-8")
        )
    except (FileNotFoundError, ModuleNotFoundError):
        return None


class HermesWriter(Writer):
    slug = "hermes"
    display_name = "Hermes Agent"

    def write(self, bundle: Bundle) -> WriteResult:
        result = WriteResult(agent_slug=self.slug)
        hermes_root = Path(os.environ.get("HERMES_HOME", Path.home() / ".hermes"))
        env_path = hermes_root / ".env"

        block_lines: list[str] = []

        if bundle.windy_mind and bundle.windy_mind.kind == "openai-compatible":
            block_lines += [
                f'WINDY_MIND_BASE_URL="{bundle.windy_mind.base_url}"',
                f'WINDY_MIND_API_KEY="{bundle.windy_mind.api_key}"',
            ]
            if bundle.windy_mind.default_model:
                block_lines.append(f'WINDY_MIND_DEFAULT_MODEL="{bundle.windy_mind.default_model}"')
        else:
            result.skipped.append("windy_mind: no openai-compatible block in bundle")

        if bundle.windy_mail:
            m = bundle.windy_mail
            block_lines.append(f'EMAIL_ADDRESS="{m.address}"')
            if m.imap:
                block_lines += [
                    f'EMAIL_PASSWORD="{m.imap.password}"',
                    f'IMAP_HOST="{m.imap.host}"',
                    f'IMAP_PORT={m.imap.port}',
                    f'IMAP_USERNAME="{m.imap.username}"',
                ]
            if m.smtp:
                block_lines += [
                    f'SMTP_HOST="{m.smtp.host}"',
                    f'SMTP_PORT={m.smtp.port}',
                    f'SMTP_USERNAME="{m.smtp.username}"',
                    f'SMTP_PASSWORD="{m.smtp.password}"',
                ]
        else:
            result.skipped.append("windy_mail: no mail block in bundle")

        if bundle.windy_chat and bundle.windy_chat.kind == "matrix":
            # Hermes lacks native Matrix support; expose as windy-namespaced env
            # vars so any future skill/MCP can consume them. Flag the gap so the
            # CLI status output is honest.
            c = bundle.windy_chat
            block_lines += [
                f'WINDY_CHAT_HOMESERVER="{c.homeserver}"',
                f'WINDY_CHAT_USER_ID="{c.matrix_user_id}"',
                f'WINDY_CHAT_ACCESS_TOKEN="{c.access_token}"',
                f'WINDY_CHAT_DEVICE_ID="{c.device_id}"',
            ]
            result.skipped.append(
                "windy_chat: Hermes has no native Matrix tool; credentials written "
                "as WINDY_CHAT_* for skills/MCP to consume"
            )
        else:
            result.skipped.append("windy_chat: no Matrix block in bundle")

        if bundle.eternitas:
            block_lines += [
                f'WINDY_ETERNITAS_EPT="{bundle.eternitas.ept}"',
                f'WINDY_ETERNITAS_PASSPORT="{bundle.eternitas.passport}"',
            ]

        if not block_lines:
            # Nothing to write — bundle was empty.
            return result

        block = (
            ENV_MARKER_START
            + "\n"
            + "\n".join(block_lines)
            + "\n"
            + ENV_MARKER_END
            + "\n"
        )
        self._append_or_replace_block(
            env_path, block, ENV_MARKER_START, ENV_MARKER_END, result
        )

        # --- Skill auto-install (parity with OpenClaw's plugin manifest drop)
        # Hermes scans ~/.hermes/skills/ for SKILL.md files. Dropping the
        # canonical windy-access SKILL.md there means the agent picks the
        # skill up without the user having to `hermes skills tap add` first.
        skill_md = _bundled_skill_md()
        if skill_md is not None:
            skill_dir = hermes_root / "skills" / "windy-access"
            skill_path = skill_dir / "SKILL.md"
            if self.dry_run:
                result.owned_files.append(skill_path)
            else:
                skill_dir.mkdir(parents=True, exist_ok=True)
                skill_path.write_text(skill_md, encoding="utf-8")
                result.owned_files.append(skill_path)
        else:
            result.skipped.append(
                "skill auto-install: SKILL.md not bundled in this wheel "
                "(editable install? users should still pick up the env block)"
            )

        return result

    def _append_or_replace_block(
        self,
        path: Path,
        block: str,
        marker_start: str,
        marker_end: str,
        result: WriteResult,
    ) -> None:
        edit = BlockEdit(file_path=path, marker_start=marker_start, marker_end=marker_end)
        if self.dry_run:
            result.block_edits.append(edit)
            return

        existing = path.read_text() if path.exists() else ""

        if marker_start in existing and marker_end in existing:
            pre, _, rest = existing.partition(marker_start)
            _, _, post = rest.partition(marker_end)
            new = pre + block + post.lstrip("\n")
        else:
            new = (existing.rstrip() + "\n\n" + block) if existing else block

        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(new)
        path.chmod(0o600)
        result.block_edits.append(edit)
