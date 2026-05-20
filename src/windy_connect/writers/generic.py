"""Generic fallback writer.

Writes the full bundle as JSON to ``~/.windy/bundle.json`` and a sourceable env
snippet alongside. Useful for custom agent frameworks (LangChain, AutoGen,
in-house code) that don't have a dedicated writer.
"""

from __future__ import annotations

from pathlib import Path

from ..bundle import Bundle
from .base import WriteResult, Writer


class GenericWriter(Writer):
    slug = "generic"
    display_name = "Generic / custom agent"

    def write(self, bundle: Bundle) -> WriteResult:
        result = WriteResult(agent_slug=self.slug)
        windy_dir = Path.home() / ".windy"
        bundle_path = windy_dir / "bundle.json"

        bundle_json = bundle.model_dump_json(indent=2, exclude_none=True)
        self._write_owned(bundle_path, bundle_json, result)

        env_lines: list[str] = []
        if bundle.windy_mind:
            env_lines.append(f'export OPENAI_BASE_URL="{bundle.windy_mind.base_url}"')
            env_lines.append(f'export OPENAI_API_KEY="{bundle.windy_mind.api_key}"')
        if bundle.windy_chat:
            env_lines.append(f'export MATRIX_HOMESERVER="{bundle.windy_chat.homeserver}"')
            env_lines.append(f'export MATRIX_USER_ID="{bundle.windy_chat.matrix_user_id}"')
            env_lines.append(f'export MATRIX_ACCESS_TOKEN="{bundle.windy_chat.access_token}"')
        if bundle.windy_mail:
            env_lines.append(f'export WINDY_MAIL_ADDRESS="{bundle.windy_mail.address}"')
        if env_lines:
            self._write_owned(windy_dir / "windy.env", "\n".join(env_lines) + "\n", result)

        return result

    def _write_owned(self, path: Path, content: str, result: WriteResult) -> None:
        if self.dry_run:
            result.owned_files.append(path)
            return
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
        if path.suffix in (".env", ".json"):
            path.chmod(0o600)
        result.owned_files.append(path)
