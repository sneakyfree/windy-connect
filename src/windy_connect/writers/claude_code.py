"""Write Windy credentials so Claude Code can route through Windy Mind.

Claude Code reads ``ANTHROPIC_BASE_URL`` / ``OPENAI_BASE_URL`` natively, so we
write them to ``~/.claude/windy.env`` for the user to source from their shell rc.

Mail and Chat integration for Claude Code is left for a future release — Claude
Code does not have an in-tree mail or chat surface today.
"""

from __future__ import annotations

from pathlib import Path

from ..bundle import Bundle
from .base import WriteResult, Writer


class ClaudeCodeWriter(Writer):
    slug = "claude_code"
    display_name = "Claude Code"

    def write(self, bundle: Bundle) -> WriteResult:
        result = WriteResult(agent_slug=self.slug)
        claude_dir = Path.home() / ".claude"

        if bundle.windy_mind and bundle.windy_mind.kind == "openai-compatible":
            env_path = claude_dir / "windy.env"
            content = (
                "# Source this file from your shell rc to route Claude Code through Windy Mind.\n"
                f'export OPENAI_BASE_URL="{bundle.windy_mind.base_url}"\n'
                f'export OPENAI_API_KEY="{bundle.windy_mind.api_key}"\n'
            )
            self._write_owned(env_path, content, result)
        else:
            result.skipped.append("windy_mind: no openai-compatible block in bundle")

        result.skipped.append("windy_mail: Claude Code has no native mail surface yet")
        result.skipped.append("windy_chat: Claude Code has no native chat surface yet")
        return result

    def _write_owned(self, path: Path, content: str, result: WriteResult) -> None:
        if self.dry_run:
            result.owned_files.append(path)
            return
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
        path.chmod(0o600)
        result.owned_files.append(path)
