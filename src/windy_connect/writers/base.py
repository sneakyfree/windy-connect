"""Abstract writer interface + the records that persist what each writer did.

Two kinds of files are tracked separately so ``windy disconnect`` can reverse
them correctly:

- ``owned_files``: files windy-connect created (and is free to delete).
- ``block_edits``: marker-delimited blocks inserted into files owned by some
  other tool (Himalaya's ``config.toml``, a user's shell rc, etc.). Reversing
  means removing only the marked block, not the whole file.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field

from ..bundle import Bundle


class BlockEdit(BaseModel):
    """A marker-delimited block windy-connect inserted into a shared config file."""

    model_config = ConfigDict(extra="ignore")

    file_path: Path
    marker_start: str
    marker_end: str


class WriteResult(BaseModel):
    """What a writer did. Surfaced to the user and persisted to state.json."""

    model_config = ConfigDict(extra="ignore")

    agent_slug: str
    owned_files: list[Path] = Field(default_factory=list)
    block_edits: list[BlockEdit] = Field(default_factory=list)
    skipped: list[str] = Field(default_factory=list)
    error: str | None = None

    @property
    def files_touched(self) -> list[Path]:
        """Every path this writer modified — owned + shared."""
        return list(self.owned_files) + [e.file_path for e in self.block_edits]


class RemoveResult(BaseModel):
    """What a writer undid during ``windy disconnect``."""

    model_config = ConfigDict(extra="ignore")

    agent_slug: str
    files_deleted: list[Path] = Field(default_factory=list)
    blocks_stripped: list[BlockEdit] = Field(default_factory=list)
    skipped: list[str] = Field(default_factory=list)
    error: str | None = None


class Writer(ABC):
    """Subclass per agent target. Override ``write``; ``remove`` default works for most."""

    slug: str
    display_name: str

    def __init__(self, *, dry_run: bool = False) -> None:
        self.dry_run = dry_run

    @abstractmethod
    def write(self, bundle: Bundle) -> WriteResult:
        """Apply the bundle to the target agent. MUST be idempotent."""
        ...

    def remove(self, record: WriteResult) -> RemoveResult:
        """Reverse a previous write. Default: delete owned files + strip marker blocks."""
        result = RemoveResult(agent_slug=record.agent_slug)
        for path in record.owned_files:
            if path.exists():
                if not self.dry_run:
                    path.unlink()
                result.files_deleted.append(path)
            else:
                result.skipped.append(f"{path} already gone")
        for edit in record.block_edits:
            if not edit.file_path.exists():
                result.skipped.append(f"{edit.file_path} already gone")
                continue
            if not self.dry_run:
                _strip_block(edit.file_path, edit.marker_start, edit.marker_end)
            result.blocks_stripped.append(edit)
        return result


def _strip_block(path: Path, marker_start: str, marker_end: str) -> None:
    """Remove the substring from marker_start through marker_end (inclusive) in path.

    Leaves the file otherwise untouched. If the markers are absent, no-op.
    """
    text = path.read_text()
    if marker_start not in text or marker_end not in text:
        return
    pre, _, rest = text.partition(marker_start)
    _, _, post = rest.partition(marker_end)
    new = pre.rstrip() + "\n" + post.lstrip("\n")
    new = new.strip() + ("\n" if new.endswith("\n") or text.endswith("\n") else "")
    if new.strip():
        path.write_text(new)
    else:
        # File contained only our block — leave an empty file rather than deleting
        # someone else's file by surprise.
        path.write_text("")
