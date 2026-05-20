"""Tests for `windy doctor`."""

from __future__ import annotations

import base64
import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import httpx
import pytest

from windy_connect import doctor, state as state_mod
from windy_connect._mock_bundle import make_mock_bundle
from windy_connect.bundle import Bundle
from windy_connect.state import State
from windy_connect.writers.base import BlockEdit, WriteResult


@pytest.fixture
def stub_network(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """Replace httpx.get with a fake that records URLs and returns 200."""
    seen: list[str] = []

    class FakeResponse:
        status_code = 200
        text = "ok"

    def fake_get(url: str, **_kw: Any) -> FakeResponse:
        seen.append(url)
        return FakeResponse()

    monkeypatch.setattr(doctor.httpx, "get", fake_get)
    return seen


def _save_state(b: Bundle) -> State:
    s = State(connected_at=datetime.now(UTC), bundle=b, writes=[])
    state_mod.save(s)
    return s


def test_doctor_no_state(sandbox: Path) -> None:
    checks = doctor.run_all_checks()
    assert len(checks) == 1
    assert checks[0].ok is False
    assert "no ~/.windy/state.json" in checks[0].detail


def test_doctor_all_green(sandbox: Path, stub_network: list[str], credentialed_bundle: Bundle) -> None:
    """A clean install with mock bundle should report all checks ok."""
    _save_state(credentialed_bundle)
    checks = doctor.run_all_checks()
    failed = [c for c in checks if not c.ok]
    assert failed == [], f"unexpected failures: {[(c.name, c.detail) for c in failed]}"


def test_doctor_expired_bundle(sandbox: Path, stub_network: list[str], credentialed_bundle: Bundle) -> None:
    past = datetime.now(UTC) - timedelta(days=1)
    b = credentialed_bundle.model_copy(update={"expires_at": past})
    _save_state(b)
    checks = doctor.run_all_checks()
    expiry_check = next(c for c in checks if c.name == "Bundle expiry")
    assert expiry_check.ok is False
    assert "EXPIRED" in expiry_check.detail


def test_doctor_warns_near_expiry(sandbox: Path, stub_network: list[str], credentialed_bundle: Bundle) -> None:
    soon = datetime.now(UTC) + timedelta(days=2)
    b = credentialed_bundle.model_copy(update={"expires_at": soon})
    _save_state(b)
    checks = doctor.run_all_checks()
    expiry_check = next(c for c in checks if c.name == "Bundle expiry")
    assert expiry_check.ok is True
    assert expiry_check.warning is True


def test_doctor_detects_missing_owned_file(sandbox: Path, stub_network: list[str], credentialed_bundle: Bundle) -> None:
    s = State(
        connected_at=datetime.now(UTC),
        bundle=credentialed_bundle,
        writes=[
            WriteResult(
                agent_slug="claude_code",
                owned_files=[sandbox / ".claude" / "windy.env"],  # doesn't exist
            )
        ],
    )
    state_mod.save(s)
    checks = doctor.run_all_checks()
    write_check = next(c for c in checks if c.name == "claude_code writes")
    assert write_check.ok is False
    assert "missing" in write_check.detail


def test_doctor_detects_missing_block_marker(sandbox: Path, stub_network: list[str], credentialed_bundle: Bundle) -> None:
    config = sandbox / "himalaya.toml"
    config.write_text("[accounts.personal]\nemail = 'a@b'\n")  # no windy-connect marker
    s = State(
        connected_at=datetime.now(UTC),
        bundle=credentialed_bundle,
        writes=[
            WriteResult(
                agent_slug="openclaw",
                block_edits=[
                    BlockEdit(
                        file_path=config,
                        marker_start="# --- windy-connect:begin ---",
                        marker_end="# --- windy-connect:end ---",
                    )
                ],
            )
        ],
    )
    state_mod.save(s)
    checks = doctor.run_all_checks()
    write_check = next(c for c in checks if c.name == "openclaw writes")
    assert write_check.ok is False
    assert "marker missing" in write_check.detail


def test_doctor_ept_decode(sandbox: Path, stub_network: list[str]) -> None:
    """A bundle with a real JWT-shaped EPT should decode and surface claims."""
    future = int((datetime.now(UTC) + timedelta(days=30)).timestamp())
    payload = base64.urlsafe_b64encode(
        json.dumps({"sub": "ET26-TEST-0001", "exp": future}).encode()
    ).rstrip(b"=").decode()
    ept = f"eyJhbGciOiJFUzI1NiJ9.{payload}.SIGNATURE"
    b = make_mock_bundle(tier="credentialed")
    assert b.eternitas is not None
    b = b.model_copy(update={"eternitas": b.eternitas.model_copy(update={"ept": ept})})
    _save_state(b)
    checks = doctor.run_all_checks()
    ept_check = next(c for c in checks if c.name == "Eternitas EPT")
    assert ept_check.ok is True
    assert "ET26-TEST-0001" in ept_check.detail


def test_doctor_ept_expired(sandbox: Path, stub_network: list[str]) -> None:
    past = int((datetime.now(UTC) - timedelta(days=1)).timestamp())
    payload = base64.urlsafe_b64encode(
        json.dumps({"sub": "ET26-TEST", "exp": past}).encode()
    ).rstrip(b"=").decode()
    ept = f"eyJhbGciOiJFUzI1NiJ9.{payload}.SIGNATURE"
    b = make_mock_bundle(tier="credentialed")
    assert b.eternitas is not None
    b = b.model_copy(update={"eternitas": b.eternitas.model_copy(update={"ept": ept})})
    _save_state(b)
    checks = doctor.run_all_checks()
    ept_check = next(c for c in checks if c.name == "Eternitas EPT")
    assert ept_check.ok is False
    assert "expired" in ept_check.detail


def test_doctor_network_probe_unreachable_is_warning(
    sandbox: Path, monkeypatch: pytest.MonkeyPatch, credentialed_bundle: Bundle
) -> None:
    """Network probe failures should be warnings, not failures."""
    def fake_get(*_args: Any, **_kw: Any) -> Any:
        raise httpx.ConnectError("simulated")

    monkeypatch.setattr(doctor.httpx, "get", fake_get)
    _save_state(credentialed_bundle)
    checks = doctor.run_all_checks()
    # No checks should be hard failures from network alone
    probe_names = {"Eternitas JWKS", "Mail SMTP", "Mail JMAP", "Matrix homeserver", "Mind models endpoint", "Orchestrator"}
    for c in checks:
        if c.name in probe_names:
            assert c.ok is True
            assert c.warning is True
