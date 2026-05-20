"""State persistence: round-trip, atomic write, perms."""

from __future__ import annotations

import os
import stat
from datetime import UTC, datetime
from pathlib import Path


from windy_connect import state as state_mod
from windy_connect.bundle import Bundle
from windy_connect.state import State
from windy_connect.writers.base import BlockEdit, WriteResult


def _state(bundle: Bundle) -> State:
    return State(
        connected_at=datetime.now(UTC),
        bundle=bundle,
        writes=[
            WriteResult(
                agent_slug="generic",
                owned_files=[Path("/tmp/test/bundle.json")],
                block_edits=[
                    BlockEdit(
                        file_path=Path("/tmp/test/config.toml"),
                        marker_start="# --- windy:start ---",
                        marker_end="# --- windy:end ---",
                    )
                ],
            )
        ],
    )


def test_state_load_returns_none_when_absent(sandbox: Path) -> None:
    assert state_mod.load() is None


def test_state_round_trip(sandbox: Path, credentialed_bundle: Bundle) -> None:
    original = _state(credentialed_bundle)
    path = state_mod.save(original)
    assert path.exists()

    loaded = state_mod.load()
    assert loaded is not None
    assert loaded.bundle.tier == "credentialed"
    assert loaded.bundle.eternitas is not None
    assert loaded.bundle.eternitas.passport == original.bundle.eternitas.passport
    assert len(loaded.writes) == 1
    assert loaded.writes[0].agent_slug == "generic"
    assert loaded.writes[0].owned_files == [Path("/tmp/test/bundle.json")]
    assert loaded.writes[0].block_edits[0].marker_start == "# --- windy:start ---"


def test_state_file_is_0600(sandbox: Path, credentialed_bundle: Bundle) -> None:
    state_mod.save(_state(credentialed_bundle))
    path = state_mod.state_path()
    mode = stat.S_IMODE(os.stat(path).st_mode)
    assert mode == 0o600


def test_state_delete(sandbox: Path, credentialed_bundle: Bundle) -> None:
    state_mod.save(_state(credentialed_bundle))
    assert state_mod.delete() is True
    assert state_mod.delete() is False
    assert state_mod.load() is None


def test_state_save_overwrites(sandbox: Path, credentialed_bundle: Bundle, free_bundle: Bundle) -> None:
    state_mod.save(_state(credentialed_bundle))
    state_mod.save(_state(free_bundle))
    loaded = state_mod.load()
    assert loaded is not None
    assert loaded.bundle.tier == "free"
    assert loaded.bundle.eternitas is None


def test_state_save_creates_parent(sandbox: Path, credentialed_bundle: Bundle) -> None:
    path = state_mod.state_path()
    assert not path.parent.exists()
    state_mod.save(_state(credentialed_bundle))
    assert path.parent.is_dir()
