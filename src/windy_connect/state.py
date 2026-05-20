"""Persistent state for windy-connect.

Stored at ``~/.windy/state.json`` (mode 0600). Captures the bundle that was
provisioned plus what each writer touched, so ``windy status`` can introspect
and ``windy disconnect`` can reverse.

Override the location via ``$WINDY_STATE_PATH`` for testing.
"""

from __future__ import annotations

import os
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from .bundle import Bundle
from .writers.base import WriteResult

DEFAULT_STATE_PATH = Path.home() / ".windy" / "state.json"


class State(BaseModel):
    """Persistent state after a successful ``windy connect``."""

    model_config = ConfigDict(extra="ignore")

    state_version: Literal["1"] = "1"
    connected_at: datetime
    bundle: Bundle
    writes: list[WriteResult] = Field(default_factory=list)


def state_path() -> Path:
    env = os.environ.get("WINDY_STATE_PATH")
    return Path(env) if env else DEFAULT_STATE_PATH


def load() -> State | None:
    """Read state from disk. Returns None if absent."""
    p = state_path()
    if not p.exists():
        return None
    return State.model_validate_json(p.read_text())


def save(state: State) -> Path:
    """Atomically write state.json with mode 0600. Returns the final path."""
    p = state_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    try:
        p.parent.chmod(0o700)
    except PermissionError:
        # Parent dir not ours (e.g., shared XDG dir under test); skip rather than fail.
        pass
    payload = state.model_dump_json(indent=2, exclude_none=True)
    fd, tmp = tempfile.mkstemp(dir=p.parent, prefix=".state.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as fh:
            fh.write(payload)
        os.chmod(tmp, 0o600)
        os.replace(tmp, p)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
    return p


def delete() -> bool:
    """Remove the state file. Returns True if it existed."""
    p = state_path()
    if not p.exists():
        return False
    p.unlink()
    return True
