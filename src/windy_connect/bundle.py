"""Pydantic models for the Eternitas Agent Credentials Bundle.

Mirrors ``docs/bundle-spec-v1.md``. Consumers MUST validate ``bundle_version`` and
ignore unknown fields per the spec's forward-compatibility rule.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, HttpUrl


class Issuer(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str = Field(description="Stable slug identifying the ecosystem that issued this bundle.")
    url: HttpUrl
    icon: HttpUrl | None = None


class EternitasBlock(BaseModel):
    model_config = ConfigDict(extra="ignore")

    ept: str = Field(description="The Eternitas Passport Token (ES256 JWT).")
    passport: str = Field(description="Human-readable passport ID (e.g., ET26-K7BF-42MN).")
    operator_id: str
    clearance_level: Literal["registered", "verified", "cleared", "top_secret", "eternal"]
    integrity_band: Literal["critical", "poor", "fair", "good", "exceptional"]
    jwks_url: HttpUrl
    revocation_check_url: HttpUrl | None = None


class MatrixChat(BaseModel):
    model_config = ConfigDict(extra="ignore")

    kind: Literal["matrix"]
    homeserver: HttpUrl
    matrix_user_id: str = Field(description="Fully-qualified Matrix ID, e.g., @alice:windychat.ai")
    access_token: str
    device_id: str
    default_room_id: str | None = None


class MailEndpoint(BaseModel):
    model_config = ConfigDict(extra="ignore")

    host: str
    port: int
    tls: Literal["implicit", "starttls", "none"]
    username: str
    password: str


class JmapEndpoint(BaseModel):
    model_config = ConfigDict(extra="ignore")

    endpoint: HttpUrl
    account_id: str
    username: str
    password: str


class MailBlock(BaseModel):
    model_config = ConfigDict(extra="ignore")

    address: str
    display_name: str | None = None
    imap: MailEndpoint | None = None
    smtp: MailEndpoint | None = None
    jmap: JmapEndpoint | None = None


class OpenAICompatibleMind(BaseModel):
    model_config = ConfigDict(extra="ignore")

    kind: Literal["openai-compatible"]
    base_url: HttpUrl
    api_key: str
    default_model: str | None = None
    models_endpoint: HttpUrl | None = None


class Bundle(BaseModel):
    """The full Eternitas Agent Credentials Bundle.

    Per spec v1, only ``eternitas`` is mandatory among service blocks; the rest are optional.
    Free-tier bundles MAY omit ``eternitas`` entirely (see ADR-052).
    """

    model_config = ConfigDict(extra="ignore")

    bundle_version: str = Field(pattern=r"^\d+\.\d+(\.\d+)?(-\w+)?$")
    issuer: Issuer
    issued_at: datetime
    expires_at: datetime
    refresh_url: HttpUrl | None = None

    eternitas: EternitasBlock | None = None

    windy_chat: MatrixChat | None = None
    windy_mail: MailBlock | None = None
    windy_mind: OpenAICompatibleMind | None = None

    tier: Literal["free", "credentialed"]

    @property
    def is_supported(self) -> bool:
        """v1 consumers handle v1.x bundles; v2+ requires explicit support."""
        major = self.bundle_version.split(".", 1)[0]
        return major == "1"

    @property
    def is_expired(self) -> bool:
        return datetime.now(self.expires_at.tzinfo) > self.expires_at
