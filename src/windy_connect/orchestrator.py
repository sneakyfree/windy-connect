"""HTTP client for the windy-connect orchestrator Worker.

Implements the CLI side of the device-code OAuth flow (RFC 8628):

  1. POST /v1/device/init     → receive {device_code, user_code, verification_uri, interval}
  2. Open verification_uri in browser (or print code)
  3. Poll POST /v1/device/poll every `interval` seconds until 200 with bundle
  4. Return the parsed Bundle

Override the orchestrator URL via ``$WINDY_CONNECT_API_URL`` (defaults to the
workers.dev URL until ``api.windyconnect.com`` is mapped).
"""

from __future__ import annotations

import os
import time
import webbrowser
from dataclasses import dataclass

import httpx
from rich.console import Console

from .bundle import Bundle

DEFAULT_API_URL = "https://windy-connect-orchestrator.windyconnect.workers.dev"
MAX_POLL_SECONDS = 900  # match backend SESSION_TTL_SECONDS

console = Console()


class OrchestratorError(RuntimeError):
    """Raised when the orchestrator returns an unrecoverable error."""


@dataclass
class DeviceSession:
    device_code: str
    user_code: str
    verification_uri: str
    verification_uri_complete: str
    interval: int
    expires_in: int


def api_url() -> str:
    return os.environ.get("WINDY_CONNECT_API_URL", DEFAULT_API_URL).rstrip("/")


def init_device(tier: str) -> DeviceSession:
    """Start a device-code pairing session."""
    try:
        res = httpx.post(
            f"{api_url()}/v1/device/init",
            json={"tier": tier},
            timeout=15.0,
        )
        res.raise_for_status()
    except httpx.HTTPError as exc:
        raise OrchestratorError(f"could not reach orchestrator at {api_url()}: {exc}") from exc
    data = res.json()
    return DeviceSession(
        device_code=data["device_code"],
        user_code=data["user_code"],
        verification_uri=data["verification_uri"],
        verification_uri_complete=data["verification_uri_complete"],
        interval=int(data.get("interval", 5)),
        expires_in=int(data.get("expires_in", 900)),
    )


def poll_until_paired(session: DeviceSession, *, open_browser: bool = True) -> Bundle:
    """Poll the orchestrator until the user pairs the code, then return the bundle.

    Prints progress with Rich. Raises OrchestratorError on timeout / explicit denial.
    """
    console.print(
        f"\n[bold cyan]→[/] Open [bold]{session.verification_uri}[/] in a browser"
    )
    console.print(f"   and enter code: [bold yellow]{session.user_code}[/]\n")

    if open_browser:
        try:
            webbrowser.open(session.verification_uri_complete, new=2)
        except Exception:
            pass  # silently fall back to manual paste

    deadline = time.time() + min(session.expires_in, MAX_POLL_SECONDS)
    interval = max(2, session.interval)
    with console.status("Waiting for pairing…", spinner="dots") as _status:
        while time.time() < deadline:
            try:
                res = httpx.post(
                    f"{api_url()}/v1/device/poll",
                    json={"device_code": session.device_code},
                    timeout=15.0,
                )
            except httpx.HTTPError as exc:
                raise OrchestratorError(f"poll failed: {exc}") from exc

            if res.status_code == 200:
                bundle_dict = res.json().get("bundle")
                if not bundle_dict:
                    raise OrchestratorError("orchestrator returned 200 without a bundle")
                return Bundle.model_validate(bundle_dict)

            payload = res.json() if res.headers.get("content-type", "").startswith("application/json") else {}
            err = payload.get("error", f"http_{res.status_code}")

            if err == "authorization_pending":
                time.sleep(interval)
                continue
            if err == "slow_down":
                interval = min(interval + 5, 30)
                time.sleep(interval)
                continue
            if err == "expired_token":
                raise OrchestratorError("pairing code expired; run `windy connect` again")
            if err == "access_denied":
                raise OrchestratorError("user denied the pairing")
            raise OrchestratorError(f"orchestrator error: {err} — {payload.get('error_description', '')}")

    raise OrchestratorError("pairing timed out without a response")


def connect_via_orchestrator(tier: str, *, open_browser: bool = True) -> Bundle:
    """Convenience wrapper: init + poll."""
    session = init_device(tier)
    return poll_until_paired(session, open_browser=open_browser)
