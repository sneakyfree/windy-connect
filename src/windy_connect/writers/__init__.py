"""Bundle writers — one per detected agent type.

Each writer takes a parsed ``Bundle`` and writes the relevant credentials into
whatever location the target agent reads from. Writers are responsible for
idempotency (re-running should be safe) and for never overwriting non-Windy
credentials in shared config files.
"""

from .base import WriteResult, Writer
from .claude_code import ClaudeCodeWriter
from .generic import GenericWriter
from .openclaw import OpenClawWriter

__all__ = [
    "ClaudeCodeWriter",
    "GenericWriter",
    "OpenClawWriter",
    "WriteResult",
    "Writer",
    "REGISTRY",
]

REGISTRY: dict[str, type[Writer]] = {
    "openclaw": OpenClawWriter,
    "claude_code": ClaudeCodeWriter,
    "generic": GenericWriter,
}
