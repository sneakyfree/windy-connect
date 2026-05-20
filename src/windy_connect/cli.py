"""windy CLI entry point.

Subcommands (planned):
    windy connect      — interactive pairing: provision bundle, write agent configs
    windy status       — show current connection state
    windy disconnect   — remove credentials and unpair
    windy upgrade      — upgrade a Tier 1 (free) connection to Tier 2 (Eternitas)
    windy doctor       — diagnose connection / config issues

This is a scaffold. None of the subcommands are wired up yet.
"""

from __future__ import annotations

import typer
from rich.console import Console

from . import __version__

app = typer.Typer(
    name="windy",
    help="Wire any AI agent into the Windy ecosystem.",
    no_args_is_help=True,
    add_completion=False,
)
console = Console()


@app.command()
def connect(
    with_eternitas: bool = typer.Option(
        None,
        "--with-eternitas/--no-eternitas",
        help="Skip the Eternitas prompt and force the choice. Default: ask interactively.",
    ),
    non_interactive: bool = typer.Option(
        False,
        "--non-interactive",
        help="Fail instead of prompting. Requires all flags pre-set.",
    ),
) -> None:
    """Pair this machine's AI agent(s) with the Windy ecosystem."""
    console.print("[bold cyan]windy connect[/] — not yet implemented")
    console.print("Scaffold only. See docs/bundle-spec-v1.md for the design.")
    raise typer.Exit(code=1)


@app.command()
def status() -> None:
    """Show current Windy connection state for detected agents."""
    console.print("[bold cyan]windy status[/] — not yet implemented")
    raise typer.Exit(code=1)


@app.command()
def disconnect() -> None:
    """Remove Windy credentials from detected agents."""
    console.print("[bold cyan]windy disconnect[/] — not yet implemented")
    raise typer.Exit(code=1)


@app.command()
def version() -> None:
    """Print the windy CLI version."""
    console.print(f"windy {__version__}")


if __name__ == "__main__":
    app()
