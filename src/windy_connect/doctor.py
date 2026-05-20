"""`windy doctor` — local diagnostics for a paired Windy install.

Checks (in order, each one independent):

  1. State file present + parses
  2. Bundle expiry  +  EPT claim exp
  3. For each per-agent write: owned files exist + marker blocks present in shared files
  4. Eternitas JWKS reachable (HTTPS HEAD)
  5. Mail/Chat/Mind endpoints reachable (HTTPS HEAD on a sensible probe path)
  6. Orchestrator reachable (GET /healthz)

No network call exceeds a 5s timeout. The doctor only diagnoses — it never
modifies state. Use `windy connect --force` to re-pair if doctor surfaces
fatal issues.
"""

from __future__ import annotations

import base64
import json
import os
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

import httpx

from . import state as state_mod
from .bundle import Bundle
from .orchestrator import api_url

PROBE_TIMEOUT = 5.0


@dataclass
class Check:
    name: str
    ok: bool
    detail: str
    warning: bool = False  # ok=True but worth surfacing


def run_all_checks() -> list[Check]:
    checks: list[Check] = []

    state = state_mod.load()
    if state is None:
        checks.append(Check("State file", False, "no ~/.windy/state.json — run `windy connect`"))
        return checks
    checks.append(Check("State file", True, f"{state_mod.state_path()} ({len(state.writes)} writes)"))

    checks.append(_check_bundle_expiry(state.bundle))
    checks.append(_check_ept(state.bundle))

    checks.extend(_check_writes(state))

    checks.append(_probe("Eternitas JWKS", _jwks_url(state.bundle)))
    if state.bundle.windy_mail:
        checks.append(_probe("Mail SMTP", f"https://{state.bundle.windy_mail.smtp.host}" if state.bundle.windy_mail.smtp else None))
        checks.append(_probe("Mail JMAP", str(state.bundle.windy_mail.jmap.endpoint) if state.bundle.windy_mail.jmap else None))
    if state.bundle.windy_chat:
        checks.append(_probe("Matrix homeserver", f"{state.bundle.windy_chat.homeserver}_matrix/client/versions"))
    if state.bundle.windy_mind:
        checks.append(_probe("Mind models endpoint", str(state.bundle.windy_mind.models_endpoint or state.bundle.windy_mind.base_url)))

    checks.append(_probe("Orchestrator", f"{api_url()}/healthz"))

    return checks


def _check_bundle_expiry(b: Bundle) -> Check:
    now = datetime.now(b.expires_at.tzinfo or UTC)
    delta = b.expires_at - now
    days = delta.days
    if b.is_expired:
        return Check("Bundle expiry", False, f"EXPIRED {(-delta).days}d ago — re-run `windy connect`")
    if days <= 3:
        return Check("Bundle expiry", True, f"expires in {days}d — re-pair soon", warning=True)
    return Check("Bundle expiry", True, f"expires in {days}d")


def _check_ept(b: Bundle) -> Check:
    if b.eternitas is None:
        return Check("Eternitas EPT", True, "free tier — no EPT in this bundle", warning=False)
    ept = b.eternitas.ept
    if "." not in ept:
        return Check("Eternitas EPT", False, "EPT is not a JWT")
    try:
        _header, payload, _sig = ept.split(".", 2)
        claims_json = base64.urlsafe_b64decode(payload + "==").decode()
        claims = json.loads(claims_json)
    except Exception as exc:  # noqa: BLE001
        return Check("Eternitas EPT", False, f"could not decode EPT: {exc}")

    exp = claims.get("exp")
    if exp is None:
        return Check("Eternitas EPT", True, "no exp claim", warning=True)
    exp_dt = datetime.fromtimestamp(exp, tz=UTC)
    if exp_dt < datetime.now(UTC):
        return Check("Eternitas EPT", False, f"EPT expired at {exp_dt.isoformat()}")
    return Check(
        "Eternitas EPT",
        True,
        f"sub={claims.get('sub', '?')}, exp={exp_dt.date().isoformat()}",
    )


def _check_writes(state) -> list[Check]:  # noqa: ANN001 — local helper
    out: list[Check] = []
    for w in state.writes:
        missing_files = [p for p in w.owned_files if not Path(p).exists()]
        missing_blocks = []
        for edit in w.block_edits:
            p = Path(edit.file_path)
            if not p.exists():
                missing_blocks.append(f"file missing: {p}")
            else:
                text = _safe_read(p)
                if edit.marker_start not in text:
                    missing_blocks.append(f"marker missing in {p}")
        if not missing_files and not missing_blocks:
            out.append(Check(f"{w.agent_slug} writes", True, f"{len(w.owned_files)} owned file(s), {len(w.block_edits)} shared block(s)"))
        else:
            detail = "; ".join(
                [f"missing: {p}" for p in missing_files] + missing_blocks
            )
            out.append(Check(f"{w.agent_slug} writes", False, detail))
    return out


def _safe_read(p: Path) -> str:
    try:
        return p.read_text()
    except Exception:  # noqa: BLE001
        return ""


def _jwks_url(b: Bundle) -> str | None:
    if b.eternitas is None:
        return None
    return str(b.eternitas.jwks_url)


def _probe(name: str, url: str | None) -> Check:
    """Network reachability probe.

    Surfaces failures as *warnings*, not check failures — a transient network
    blip should not make doctor exit non-zero. The state-file + writes checks
    are the real correctness validators.
    """
    if not url:
        return Check(name, True, "not in bundle")
    try:
        res = httpx.get(
            url,
            timeout=PROBE_TIMEOUT,
            follow_redirects=True,
            headers={"user-agent": f"windy-doctor/{os.environ.get('WINDY_DOCTOR_UA', '0.0.2')}"},
        )
        if res.status_code < 500:
            return Check(name, True, f"HTTP {res.status_code} from {url}")
        return Check(name, True, f"HTTP {res.status_code} from {url}", warning=True)
    except httpx.HTTPError as exc:
        return Check(name, True, f"unreachable: {exc}", warning=True)
