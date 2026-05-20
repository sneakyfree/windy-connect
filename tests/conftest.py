"""Shared fixtures for the windy-connect test suite."""

from __future__ import annotations

import os
from collections.abc import Iterator
from pathlib import Path

import pytest

from windy_connect._mock_bundle import make_mock_bundle
from windy_connect.bundle import Bundle


@pytest.fixture
def sandbox(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[Path]:
    """Redirect HOME + XDG_CONFIG_HOME + WINDY_STATE_PATH into a tmp_path."""
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path / ".config"))
    monkeypatch.setenv("WINDY_STATE_PATH", str(tmp_path / ".windy" / "state.json"))
    # Force Path.home() to honor $HOME on POSIX.
    os.environ["HOME"] = str(tmp_path)
    yield tmp_path


@pytest.fixture
def credentialed_bundle() -> Bundle:
    return make_mock_bundle(tier="credentialed")


@pytest.fixture
def free_bundle() -> Bundle:
    return make_mock_bundle(tier="free")
