"""Write Windy credentials into an OpenClaw installation.

Per the OpenClaw audit (2026-05-20):
- Matrix channel reads ``MATRIX_HOMESERVER`` / ``MATRIX_USER_ID`` / ``MATRIX_ACCESS_TOKEN``
  env vars resolved through the central secrets module.
- Mail is delegated to Himalaya (config at ``~/.config/himalaya/config.toml``); we
  append a ``[accounts.windy]`` block.
- Mind is wired as an OpenAI-compatible provider via a ~30-line plugin manifest
  modeled on ``extensions/openrouter/openclaw.plugin.json``; we write the manifest
  and set ``WINDY_MIND_API_KEY``.

The writer chooses an OpenClaw secrets path (``$XDG_CONFIG_HOME/openclaw/secrets/windy.env``)
that OpenClaw's secret loader picks up automatically; we do not edit OpenClaw's
internal config TOML directly.
"""

from __future__ import annotations

import json
import os
import textwrap
from pathlib import Path

from ..bundle import Bundle
from .base import WriteResult, Writer


class OpenClawWriter(Writer):
    slug = "openclaw"
    display_name = "OpenClaw"

    def write(self, bundle: Bundle) -> WriteResult:
        result = WriteResult(agent_slug=self.slug)
        config_root = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "openclaw"

        # --- Matrix (Windy Chat) ---
        if bundle.windy_chat and bundle.windy_chat.kind == "matrix":
            env_lines = [
                f'MATRIX_HOMESERVER="{bundle.windy_chat.homeserver}"',
                f'MATRIX_USER_ID="{bundle.windy_chat.matrix_user_id}"',
                f'MATRIX_ACCESS_TOKEN="{bundle.windy_chat.access_token}"',
                f'MATRIX_DEVICE_ID="{bundle.windy_chat.device_id}"',
            ]
            if bundle.windy_chat.default_room_id:
                env_lines.append(f'WINDY_CHAT_DEFAULT_ROOM="{bundle.windy_chat.default_room_id}"')
            env_path = config_root / "secrets" / "windy-chat.env"
            self._write(env_path, "\n".join(env_lines) + "\n", result)
        else:
            result.skipped.append("windy_chat: no Matrix block in bundle")

        # --- Mind (OpenAI-compatible provider) ---
        if bundle.windy_mind and bundle.windy_mind.kind == "openai-compatible":
            manifest = {
                "id": "windy-mind",
                "providers": ["windy-mind"],
                "providerBaseUrls": {"windy-mind": str(bundle.windy_mind.base_url)},
                "providerAuthEnvVars": {"windy-mind": ["WINDY_MIND_API_KEY"]},
                "api": "openai-responses",
            }
            manifest_path = config_root / "extensions" / "windy-mind" / "openclaw.plugin.json"
            self._write(manifest_path, json.dumps(manifest, indent=2) + "\n", result)

            env_path = config_root / "secrets" / "windy-mind.env"
            content = f'WINDY_MIND_API_KEY="{bundle.windy_mind.api_key}"\n'
            self._write(env_path, content, result)
        else:
            result.skipped.append("windy_mind: no openai-compatible block in bundle")

        # --- Mail (via Himalaya) ---
        if bundle.windy_mail:
            himalaya_path = (
                Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config"))
                / "himalaya"
                / "config.toml"
            )
            block = self._himalaya_account_block(bundle)
            self._append_or_replace_himalaya_block(himalaya_path, block, result)
        else:
            result.skipped.append("windy_mail: no mail block in bundle")

        return result

    def _himalaya_account_block(self, bundle: Bundle) -> str:
        m = bundle.windy_mail
        assert m is not None  # checked by caller
        imap_user = m.imap.username if m.imap else m.address
        imap_pass = m.imap.password if m.imap else ""
        imap_host = m.imap.host if m.imap else ""
        imap_port = m.imap.port if m.imap else 993
        smtp_host = m.smtp.host if m.smtp else ""
        smtp_port = m.smtp.port if m.smtp else 587
        return textwrap.dedent(
            f"""\
            # --- windy-connect:begin ---
            [accounts.windy]
            email = "{m.address}"
            display-name = "{m.display_name or ''}"
            default = false

            imap.host = "{imap_host}"
            imap.port = {imap_port}
            imap.login = "{imap_user}"
            imap.auth.passwd.cmd = "echo '{imap_pass}'"

            smtp.host = "{smtp_host}"
            smtp.port = {smtp_port}
            smtp.login = "{imap_user}"
            smtp.auth.passwd.cmd = "echo '{imap_pass}'"
            # --- windy-connect:end ---
            """
        )

    def _append_or_replace_himalaya_block(
        self, path: Path, block: str, result: WriteResult
    ) -> None:
        existing = path.read_text() if path.exists() else ""
        start, end = "# --- windy-connect:begin ---", "# --- windy-connect:end ---"

        if start in existing and end in existing:
            pre, _, rest = existing.partition(start)
            _, _, post = rest.partition(end)
            new = pre + block + post.lstrip("\n")
        else:
            new = (existing.rstrip() + "\n\n" + block) if existing else block

        self._write(path, new, result)

    def _write(self, path: Path, content: str, result: WriteResult) -> None:
        if self.dry_run:
            result.files_written.append(path)
            return
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
        # Secrets files: tighten perms to 0600
        if "secrets" in path.parts or path.suffix == ".env":
            path.chmod(0o600)
        result.files_written.append(path)
