"""Bundle pydantic model: round-trip + invariants."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from windy_connect._mock_bundle import make_mock_bundle
from windy_connect.bundle import Bundle


def test_credentialed_bundle_has_eternitas_block(credentialed_bundle: Bundle) -> None:
    assert credentialed_bundle.tier == "credentialed"
    assert credentialed_bundle.eternitas is not None
    assert credentialed_bundle.eternitas.passport.startswith("ET")


def test_free_bundle_omits_eternitas(free_bundle: Bundle) -> None:
    assert free_bundle.tier == "free"
    assert free_bundle.eternitas is None
    # But still has the service blocks
    assert free_bundle.windy_chat is not None
    assert free_bundle.windy_mail is not None
    assert free_bundle.windy_mind is not None


def test_json_round_trip_credentialed(credentialed_bundle: Bundle) -> None:
    payload = credentialed_bundle.model_dump_json()
    reparsed = Bundle.model_validate_json(payload)
    assert reparsed.tier == credentialed_bundle.tier
    assert reparsed.eternitas is not None
    assert reparsed.eternitas.passport == credentialed_bundle.eternitas.passport
    assert reparsed.windy_mail is not None
    assert reparsed.windy_mail.address == credentialed_bundle.windy_mail.address


def test_json_round_trip_free(free_bundle: Bundle) -> None:
    payload = free_bundle.model_dump_json()
    reparsed = Bundle.model_validate_json(payload)
    assert reparsed.eternitas is None
    assert reparsed.tier == "free"


def test_is_supported_for_v1() -> None:
    b = make_mock_bundle()
    assert b.bundle_version.startswith("1.")
    assert b.is_supported is True


def test_is_supported_rejects_v2() -> None:
    b = make_mock_bundle()
    b2 = b.model_copy(update={"bundle_version": "2.0"})
    assert b2.is_supported is False


def test_expiry_detects_past_expires_at() -> None:
    past = datetime.now(UTC) - timedelta(days=1)
    b = make_mock_bundle().model_copy(update={"expires_at": past})
    assert b.is_expired is True


def test_expiry_false_for_future() -> None:
    assert make_mock_bundle().is_expired is False


def test_bundle_version_pattern_rejects_garbage() -> None:
    with pytest.raises(ValueError):
        Bundle.model_validate_json(
            make_mock_bundle().model_dump_json().replace('"1.0"', '"banana"')
        )
