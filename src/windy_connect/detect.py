"""Detect AI-agent installations on the local machine.

The CLI uses this to populate the "Detected on this system:" prompt and to know
which writers to invoke after a successful pairing.

Detectors are intentionally lightweight (file/path checks, no network probes) so
``windy connect`` boots fast even on cold machines.
"""

from __future__ import annotations

import os
import shutil
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class AgentInfo:
    """What we know about a detected (or undetected) agent."""

    slug: str
    """Stable ID used by the writers registry. E.g., 'openclaw', 'claude_code', 'generic'."""

    display_name: str
    """Human-friendly name shown in CLI prompts."""

    detected: bool
    """True if we found evidence of this agent on the machine."""

    install_path: Path | None = None
    """Where its config lives, if applicable. None for generic / fallback."""

    binary_path: Path | None = None
    """Path to the agent's executable, if found."""

    notes: str | None = None
    """Optional context to surface to the user (e.g., 'CLI found but no config dir yet')."""


def _which(name: str) -> Path | None:
    """``shutil.which`` but returns a ``Path`` or None."""
    found = shutil.which(name)
    return Path(found) if found else None


def detect_openclaw() -> AgentInfo:
    """Look for OpenClaw — checks $XDG_CONFIG_HOME/openclaw and the ``openclaw`` binary.

    OpenClaw stores per-extension configs under its config root; the directory
    presence is the most reliable signal because the CLI binary name is the same
    on every platform.
    """
    config_root = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config"))
    openclaw_config = config_root / "openclaw"
    binary = _which("openclaw")

    detected = openclaw_config.is_dir() or binary is not None
    notes = None
    if binary and not openclaw_config.is_dir():
        notes = "CLI present but no config dir yet; will be created on first run."

    return AgentInfo(
        slug="openclaw",
        display_name="OpenClaw",
        detected=detected,
        install_path=openclaw_config if openclaw_config.is_dir() else None,
        binary_path=binary,
        notes=notes,
    )


def detect_hermes() -> AgentInfo:
    """Look for Hermes Agent — checks ``$HERMES_HOME`` / ``~/.hermes`` and the ``hermes`` binary.

    Nous Research's Hermes Agent ships its config directly under ``~/.hermes/`` rather
    than the XDG dir; the env-var override lets fleet machines relocate it.
    """
    hermes_root = Path(os.environ.get("HERMES_HOME", Path.home() / ".hermes"))
    binary = _which("hermes")

    detected = hermes_root.is_dir() or binary is not None
    notes = None
    if binary and not hermes_root.is_dir():
        notes = "CLI present but no config dir yet; will be created on first run."

    return AgentInfo(
        slug="hermes",
        display_name="Hermes Agent",
        detected=detected,
        install_path=hermes_root if hermes_root.is_dir() else None,
        binary_path=binary,
        notes=notes,
    )


def detect_claude_code() -> AgentInfo:
    """Look for Claude Code — checks ``~/.claude`` and the ``claude`` binary."""
    claude_config = Path.home() / ".claude"
    binary = _which("claude")

    return AgentInfo(
        slug="claude_code",
        display_name="Claude Code",
        detected=claude_config.is_dir() or binary is not None,
        install_path=claude_config if claude_config.is_dir() else None,
        binary_path=binary,
    )


def detect_himalaya() -> AgentInfo:
    """Look for a Himalaya install — OpenClaw uses it for mail and many agents do too.

    Detecting it separately lets us decide whether the OpenClaw writer (which adds a
    Himalaya account) is sufficient or whether the generic writer should also wire
    Himalaya for a standalone user.
    """
    config = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "himalaya"
    binary = _which("himalaya")
    return AgentInfo(
        slug="himalaya",
        display_name="Himalaya (mail CLI)",
        detected=config.is_dir() or binary is not None,
        install_path=config if config.is_dir() else None,
        binary_path=binary,
    )


def detect_generic() -> AgentInfo:
    """The always-on fallback. Writes a canonical bundle to ~/.windy/bundle.json.

    Any custom framework (LangChain, AutoGen, in-house agent code) can read from
    this canonical location without needing a dedicated writer.
    """
    return AgentInfo(
        slug="generic",
        display_name="Generic / Custom agent (~/.windy/bundle.json)",
        detected=True,  # always available
        install_path=Path.home() / ".windy",
    )


def detect_all() -> list[AgentInfo]:
    """Run every detector. Returns the list in stable order for UI presentation."""
    return [
        detect_openclaw(),
        detect_hermes(),
        detect_claude_code(),
        detect_himalaya(),
        detect_generic(),
    ]
