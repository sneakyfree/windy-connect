"""Inline mock bundle used by ``windy connect --mock``.

Lets us exercise the full CLI flow + writers without a live orchestrator backend.
Replaced by real orchestrator response once that ships.
"""

from __future__ import annotations

import base64
import json
from datetime import UTC, datetime, timedelta

from .bundle import (
    Bundle,
    EternitasBlock,
    Issuer,
    JmapEndpoint,
    MailBlock,
    MailEndpoint,
    MatrixChat,
    OpenAICompatibleMind,
)


def make_mock_bundle(*, tier: str = "credentialed") -> Bundle:
    """Synthesize a realistic bundle for local testing."""
    now = datetime.now(UTC)
    expires = now + timedelta(days=30)

    eternitas: EternitasBlock | None = None
    if tier == "credentialed":
        ept_payload = (
            base64.urlsafe_b64encode(
                json.dumps(
                    {"sub": "ET26-MOCK-0001", "exp": int(expires.timestamp())}
                ).encode()
            )
            .rstrip(b"=")
            .decode()
        )
        eternitas = EternitasBlock(
            ept=f"eyJhbGciOiJFUzI1NiIsImtpZCI6Im1vY2sifQ.{ept_payload}.MOCK",
            passport="ET26-MOCK-0001",
            operator_id="op_mock_0000000000000000000000",
            clearance_level="verified",
            integrity_band="fair",
            jwks_url="https://api.eternitas.ai/.well-known/eternitas-keys",
            revocation_check_url="https://api.eternitas.ai/api/v1/passports/ET26-MOCK-0001/status",
        )

    return Bundle(
        bundle_version="1.0",
        issuer=Issuer(
            name="windy",
            url="https://windyconnect.com",
            icon="https://windyconnect.com/favicon.png",
        ),
        issued_at=now,
        expires_at=expires,
        refresh_url="https://api.windyconnect.com/v1/bundle/refresh",
        eternitas=eternitas,
        windy_chat=MatrixChat(
            kind="matrix",
            homeserver="https://matrix.windychat.ai",
            matrix_user_id="@mock_agent:windychat.ai",
            access_token="syt_mock_access_token_replace_in_real_flow",
            device_id="WINDY_CONNECT_MOCK_DEVICE",
            default_room_id="!mockroom:windychat.ai",
        ),
        windy_mail=MailBlock(
            address="mock_agent@windymail.ai",
            display_name="Mock Agent",
            imap=MailEndpoint(
                host="imap.windymail.ai",
                port=993,
                tls="implicit",
                username="mock_agent@windymail.ai",
                password="mock-app-password-1234",
            ),
            smtp=MailEndpoint(
                host="smtp.windymail.ai",
                port=587,
                tls="starttls",
                username="mock_agent@windymail.ai",
                password="mock-app-password-1234",
            ),
            jmap=JmapEndpoint(
                endpoint="https://jmap.windymail.ai/jmap",
                account_id="u_mock_account",
                username="mock_agent@windymail.ai",
                password="mock-app-password-1234",
            ),
        ),
        windy_mind=OpenAICompatibleMind(
            kind="openai-compatible",
            base_url="https://api.windymind.ai/v1",
            api_key="wm_mock_api_key_replace_in_real_flow",
            default_model="windy-mind-auto",
            models_endpoint="https://api.windymind.ai/v1/models",
        ),
        tier=tier,  # type: ignore[arg-type]
    )
