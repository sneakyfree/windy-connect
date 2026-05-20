"""Writer behavior: dry_run + wet write + remove() reversal."""

from __future__ import annotations

from pathlib import Path


from windy_connect.bundle import Bundle
from windy_connect.writers import (
    REGISTRY,
    BlockEdit,
    ClaudeCodeWriter,
    GenericWriter,
    HermesWriter,
    OpenClawWriter,
    Writer,
    WriteResult,
)


# ---------- ClaudeCodeWriter ----------


def test_claude_code_dry_run_touches_no_files(sandbox: Path, credentialed_bundle: Bundle) -> None:
    writer = ClaudeCodeWriter(dry_run=True)
    result = writer.write(credentialed_bundle)
    assert result.error is None
    assert len(result.owned_files) == 1
    assert not (sandbox / ".claude" / "windy.env").exists()


def test_claude_code_wet_writes_env_file(sandbox: Path, credentialed_bundle: Bundle) -> None:
    writer = ClaudeCodeWriter()
    result = writer.write(credentialed_bundle)
    env_path = sandbox / ".claude" / "windy.env"
    assert env_path in result.owned_files
    assert env_path.exists()
    content = env_path.read_text()
    assert "OPENAI_BASE_URL" in content
    assert "OPENAI_API_KEY" in content
    assert credentialed_bundle.windy_mind.api_key in content
    # Mode 0600
    assert env_path.stat().st_mode & 0o777 == 0o600


def test_claude_code_remove_deletes_owned_file(sandbox: Path, credentialed_bundle: Bundle) -> None:
    writer = ClaudeCodeWriter()
    write_result = writer.write(credentialed_bundle)
    env_path = sandbox / ".claude" / "windy.env"
    assert env_path.exists()
    remove_result = writer.remove(write_result)
    assert remove_result.error is None
    assert not env_path.exists()
    assert env_path in remove_result.files_deleted


# ---------- GenericWriter ----------


def test_generic_writes_bundle_json(sandbox: Path, credentialed_bundle: Bundle) -> None:
    writer = GenericWriter()
    result = writer.write(credentialed_bundle)
    bundle_path = sandbox / ".windy" / "bundle.json"
    env_path = sandbox / ".windy" / "windy.env"
    assert bundle_path.exists()
    assert env_path.exists()
    assert bundle_path in result.owned_files
    # bundle.json should be valid bundle JSON
    reparsed = Bundle.model_validate_json(bundle_path.read_text())
    assert reparsed.tier == credentialed_bundle.tier


def test_generic_remove_cleans_both_files(sandbox: Path, credentialed_bundle: Bundle) -> None:
    writer = GenericWriter()
    result = writer.write(credentialed_bundle)
    writer.remove(result)
    assert not (sandbox / ".windy" / "bundle.json").exists()
    assert not (sandbox / ".windy" / "windy.env").exists()


# ---------- OpenClawWriter ----------


def test_openclaw_writes_all_three_surfaces(sandbox: Path, credentialed_bundle: Bundle) -> None:
    writer = OpenClawWriter()
    result = writer.write(credentialed_bundle)
    assert result.error is None
    cfg = sandbox / ".config"
    assert (cfg / "openclaw" / "secrets" / "windy-chat.env").exists()
    assert (cfg / "openclaw" / "secrets" / "windy-mind.env").exists()
    assert (cfg / "openclaw" / "extensions" / "windy-mind" / "openclaw.plugin.json").exists()
    himalaya = cfg / "himalaya" / "config.toml"
    assert himalaya.exists()
    assert "# --- windy-connect:begin ---" in himalaya.read_text()


def test_openclaw_himalaya_idempotent(sandbox: Path, credentialed_bundle: Bundle) -> None:
    """Re-running should replace the block, not duplicate it."""
    writer = OpenClawWriter()
    writer.write(credentialed_bundle)
    writer.write(credentialed_bundle)
    himalaya = sandbox / ".config" / "himalaya" / "config.toml"
    text = himalaya.read_text()
    assert text.count("# --- windy-connect:begin ---") == 1


def test_openclaw_himalaya_preserves_user_content(
    sandbox: Path, credentialed_bundle: Bundle
) -> None:
    """A pre-existing account in the user's himalaya config must survive."""
    himalaya = sandbox / ".config" / "himalaya" / "config.toml"
    himalaya.parent.mkdir(parents=True, exist_ok=True)
    user_block = (
        "[accounts.personal]\n"
        'email = "alice@example.com"\n'
        "default = true\n"
    )
    himalaya.write_text(user_block)
    OpenClawWriter().write(credentialed_bundle)
    text = himalaya.read_text()
    assert "alice@example.com" in text
    assert "# --- windy-connect:begin ---" in text


def test_openclaw_remove_strips_block_keeps_user_content(
    sandbox: Path, credentialed_bundle: Bundle
) -> None:
    """After disconnect, user's existing himalaya config must remain intact."""
    himalaya = sandbox / ".config" / "himalaya" / "config.toml"
    himalaya.parent.mkdir(parents=True, exist_ok=True)
    user_block = (
        "[accounts.personal]\n"
        'email = "alice@example.com"\n'
        "default = true\n"
    )
    himalaya.write_text(user_block)
    writer = OpenClawWriter()
    result = writer.write(credentialed_bundle)
    writer.remove(result)
    text = himalaya.read_text()
    assert "alice@example.com" in text
    assert "# --- windy-connect:begin ---" not in text
    assert "# --- windy-connect:end ---" not in text


def test_openclaw_remove_deletes_owned_secrets(
    sandbox: Path, credentialed_bundle: Bundle
) -> None:
    writer = OpenClawWriter()
    result = writer.write(credentialed_bundle)
    writer.remove(result)
    cfg = sandbox / ".config"
    assert not (cfg / "openclaw" / "secrets" / "windy-chat.env").exists()
    assert not (cfg / "openclaw" / "secrets" / "windy-mind.env").exists()


def test_openclaw_secrets_are_0600(sandbox: Path, credentialed_bundle: Bundle) -> None:
    OpenClawWriter().write(credentialed_bundle)
    p = sandbox / ".config" / "openclaw" / "secrets" / "windy-mind.env"
    assert p.stat().st_mode & 0o777 == 0o600


def test_openclaw_writes_eternitas_ept(
    sandbox: Path, credentialed_bundle: Bundle
) -> None:
    """Parity with Hermes writer: the EPT must be readable by OpenClaw skills."""
    result = OpenClawWriter().write(credentialed_bundle)
    ept_path = sandbox / ".config" / "openclaw" / "secrets" / "windy-eternitas.env"
    assert ept_path.exists()
    text = ept_path.read_text()
    assert credentialed_bundle.eternitas is not None
    assert credentialed_bundle.eternitas.ept in text
    assert credentialed_bundle.eternitas.passport in text
    assert "WINDY_ETERNITAS_JWKS_URL" in text
    # The eternitas file must be in owned_files so disconnect cleans it up
    assert ept_path in result.owned_files


def test_openclaw_skips_eternitas_for_anonymous_tier(
    sandbox: Path, free_bundle: Bundle
) -> None:
    """Free tier has no Eternitas block — writer must skip cleanly."""
    result = OpenClawWriter().write(free_bundle)
    ept_path = sandbox / ".config" / "openclaw" / "secrets" / "windy-eternitas.env"
    assert not ept_path.exists()
    assert any("eternitas" in s for s in result.skipped)


# ---------- Registry & dry-run remove ----------


def test_registry_contains_all_writers() -> None:
    assert set(REGISTRY.keys()) == {"openclaw", "hermes", "claude_code", "generic"}
    for cls in REGISTRY.values():
        assert issubclass(cls, Writer)


# ---------- HermesWriter ----------


def test_hermes_dry_run_touches_no_files(sandbox: Path, credentialed_bundle: Bundle) -> None:
    writer = HermesWriter(dry_run=True)
    result = writer.write(credentialed_bundle)
    assert result.error is None
    assert len(result.block_edits) == 1
    assert not (sandbox / ".hermes" / ".env").exists()


def test_hermes_writes_marker_block_to_env(
    sandbox: Path, credentialed_bundle: Bundle
) -> None:
    writer = HermesWriter()
    result = writer.write(credentialed_bundle)
    env_path = sandbox / ".hermes" / ".env"
    assert env_path.exists()
    text = env_path.read_text()
    assert "# --- windy-connect:begin ---" in text
    assert "# --- windy-connect:end ---" in text
    assert "WINDY_MIND_API_KEY=" in text
    assert "WINDY_MIND_BASE_URL=" in text
    assert "EMAIL_ADDRESS=" in text
    assert "IMAP_HOST=" in text
    assert "SMTP_HOST=" in text
    assert "WINDY_CHAT_HOMESERVER=" in text
    assert "WINDY_ETERNITAS_EPT=" in text
    assert any(
        e.file_path == env_path and "windy-connect" in e.marker_start
        for e in result.block_edits
    )


def test_hermes_chat_flagged_as_skipped_for_non_native_use(
    sandbox: Path, credentialed_bundle: Bundle
) -> None:
    result = HermesWriter().write(credentialed_bundle)
    assert any("Hermes has no native Matrix" in s for s in result.skipped)


def test_hermes_env_is_idempotent(sandbox: Path, credentialed_bundle: Bundle) -> None:
    writer = HermesWriter()
    writer.write(credentialed_bundle)
    writer.write(credentialed_bundle)
    text = (sandbox / ".hermes" / ".env").read_text()
    assert text.count("# --- windy-connect:begin ---") == 1


def test_hermes_preserves_user_env_vars(
    sandbox: Path, credentialed_bundle: Bundle
) -> None:
    env_path = sandbox / ".hermes" / ".env"
    env_path.parent.mkdir(parents=True, exist_ok=True)
    env_path.write_text('OPENROUTER_API_KEY="user-owned-key"\n')
    HermesWriter().write(credentialed_bundle)
    text = env_path.read_text()
    assert 'OPENROUTER_API_KEY="user-owned-key"' in text
    assert "# --- windy-connect:begin ---" in text


def test_hermes_remove_strips_block_keeps_user_env(
    sandbox: Path, credentialed_bundle: Bundle
) -> None:
    env_path = sandbox / ".hermes" / ".env"
    env_path.parent.mkdir(parents=True, exist_ok=True)
    env_path.write_text('OPENROUTER_API_KEY="user-owned-key"\n')
    writer = HermesWriter()
    result = writer.write(credentialed_bundle)
    writer.remove(result)
    text = env_path.read_text()
    assert 'OPENROUTER_API_KEY="user-owned-key"' in text
    assert "# --- windy-connect:begin ---" not in text
    assert "WINDY_MIND_API_KEY=" not in text


def test_hermes_env_is_0600(sandbox: Path, credentialed_bundle: Bundle) -> None:
    HermesWriter().write(credentialed_bundle)
    env_path = sandbox / ".hermes" / ".env"
    assert env_path.stat().st_mode & 0o777 == 0o600


def test_hermes_honors_hermes_home_env_var(
    sandbox: Path, credentialed_bundle: Bundle, monkeypatch
) -> None:
    relocated = sandbox / "fleet-hermes-root"
    monkeypatch.setenv("HERMES_HOME", str(relocated))
    HermesWriter().write(credentialed_bundle)
    assert (relocated / ".env").exists()
    assert not (sandbox / ".hermes" / ".env").exists()


def test_hermes_auto_installs_windy_access_skill(
    sandbox: Path, credentialed_bundle: Bundle
) -> None:
    """Parity with OpenClaw plugin-manifest drop: Hermes should also have
    a skill file dropped into ~/.hermes/skills/windy-access/SKILL.md so the
    agent picks it up without the user running `hermes skills tap add`."""
    from windy_connect.writers.hermes import _bundled_skill_md

    if _bundled_skill_md() is None:
        # In an editable install without package data; assertion is conditional.
        return

    result = HermesWriter().write(credentialed_bundle)
    skill_path = sandbox / ".hermes" / "skills" / "windy-access" / "SKILL.md"
    assert skill_path.exists()
    text = skill_path.read_text()
    assert text.startswith("---\nname: windy-access")
    assert "Hermes Agent" in text
    assert skill_path in result.owned_files


def test_hermes_remove_cleans_up_skill_file(
    sandbox: Path, credentialed_bundle: Bundle
) -> None:
    from windy_connect.writers.hermes import _bundled_skill_md

    if _bundled_skill_md() is None:
        return

    writer = HermesWriter()
    result = writer.write(credentialed_bundle)
    skill_path = sandbox / ".hermes" / "skills" / "windy-access" / "SKILL.md"
    assert skill_path.exists()
    writer.remove(result)
    assert not skill_path.exists()


def test_dry_run_remove_does_not_touch_files(
    sandbox: Path, credentialed_bundle: Bundle
) -> None:
    wet = GenericWriter()
    result = wet.write(credentialed_bundle)
    bundle_path = sandbox / ".windy" / "bundle.json"
    assert bundle_path.exists()

    dry = GenericWriter(dry_run=True)
    dry.remove(result)
    assert bundle_path.exists()  # untouched by dry-run remove


def test_remove_missing_files_no_op(sandbox: Path) -> None:
    """If a tracked file has already been deleted, remove() should report skipped, not error."""
    fake = WriteResult(
        agent_slug="claude_code",
        owned_files=[sandbox / ".claude" / "windy.env"],  # doesn't exist
    )
    result = ClaudeCodeWriter().remove(fake)
    assert result.error is None
    assert result.files_deleted == []
    assert any("already gone" in s for s in result.skipped)


def test_remove_strip_block_missing_markers_is_safe(sandbox: Path) -> None:
    """If user edited the config and removed our markers, strip should no-op gracefully."""
    f = sandbox / "config.toml"
    f.write_text("# user wrote this manually\n[user]\nx = 1\n")
    record = WriteResult(
        agent_slug="openclaw",
        block_edits=[
            BlockEdit(
                file_path=f,
                marker_start="# --- windy-connect:begin ---",
                marker_end="# --- windy-connect:end ---",
            )
        ],
    )
    OpenClawWriter().remove(record)
    assert "[user]" in f.read_text()  # user's content untouched
