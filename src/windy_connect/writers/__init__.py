"""Bundle writers — one per detected agent type.

Each writer takes a parsed ``Bundle`` and writes the relevant credentials into
whatever location the target agent reads from. Writers are responsible for
idempotency (re-running should be safe) and for never overwriting non-Windy
credentials in shared config files (use marker-bounded BlockEdits instead).
"""

from .base import BlockEdit, RemoveResult, WriteResult, Writer
from .claude_code import ClaudeCodeWriter
from .generic import GenericWriter
from .hermes import HermesWriter
from .openclaw import OpenClawWriter

__all__ = [
    "BlockEdit",
    "ClaudeCodeWriter",
    "GenericWriter",
    "HermesWriter",
    "OpenClawWriter",
    "RemoveResult",
    "Writer",
    "WriteResult",
    "REGISTRY",
]

REGISTRY: dict[str, type[Writer]] = {
    "openclaw": OpenClawWriter,
    "hermes": HermesWriter,
    "claude_code": ClaudeCodeWriter,
    "generic": GenericWriter,
}
