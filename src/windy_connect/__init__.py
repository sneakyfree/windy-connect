"""Windy Connect — the one command that wires any AI agent into the Windy ecosystem."""

from importlib.metadata import PackageNotFoundError, version as _pkg_version

try:
    __version__ = _pkg_version("windy-connect")
except PackageNotFoundError:
    __version__ = "0.0.0.dev"
