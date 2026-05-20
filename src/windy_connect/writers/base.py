"""Abstract writer interface."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path

from ..bundle import Bundle


@dataclass
class WriteResult:
    """What a writer did and where. Surfaced to the user at the end of ``windy connect``."""

    agent_slug: str
    files_written: list[Path] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)
    """Reasons why a write was skipped (e.g., 'no MAIL block in bundle')."""
    error: str | None = None


class Writer(ABC):
    """Subclass per agent target."""

    slug: str
    display_name: str

    def __init__(self, *, dry_run: bool = False) -> None:
        self.dry_run = dry_run

    @abstractmethod
    def write(self, bundle: Bundle) -> WriteResult:
        """Apply the bundle to the target agent. MUST be idempotent."""
        ...
