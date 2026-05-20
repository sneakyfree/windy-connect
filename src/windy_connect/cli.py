"""windy CLI entry point.

Subcommands:
    windy connect      — interactive pairing: provision bundle, write agent configs
    windy status       — show current connection state (TODO: implement against ~/.windy/state.json)
    windy disconnect   — remove credentials (TODO)
    windy version

Currently the OAuth orchestrator backend is stubbed. Pass ``--mock`` to
``windy connect`` to exercise the full local flow against an in-memory bundle.
"""

from __future__ import annotations

import typer
from rich.console import Console
from rich.panel import Panel
from rich.prompt import Confirm, Prompt
from rich.table import Table

from . import __version__
from ._mock_bundle import make_mock_bundle
from .bundle import Bundle
from .detect import AgentInfo, detect_all
from .writers import REGISTRY, WriteResult

app = typer.Typer(
    name="windy",
    help="Wire any AI agent into the Windy ecosystem.",
    no_args_is_help=True,
    add_completion=False,
)
console = Console()


# --- ADR-052 marketing copy (canonical phrasing — keep in sync with the ADR) ---
ETERNITAS_PITCH = """\
[bold]Eternitas[/bold] is the State Department + credit bureau for AI agents.
With Eternitas credentials your agent can:
  [green]✓[/] talk to OTHER agents on Windy Chat (not just humans)
  [green]✓[/] send mail to credentialed agents without spam filtering
  [green]✓[/] get higher rate limits on Windy Mind
  [green]✓[/] build a portable integrity score that compounds across the agent web

Without Eternitas your agent still gets Mail, Chat, and Mind — but only the
human-facing surfaces (Tier 1). Eternitas unlocks agent-to-agent (Tier 2).
"""


@app.command()
def connect(
    mock: bool = typer.Option(
        False,
        "--mock",
        help="Skip the real OAuth/orchestrator call; use an in-memory mock bundle.",
    ),
    no_eternitas: bool = typer.Option(
        False,
        "--no-eternitas",
        help="Skip the Eternitas prompt and provision a Tier 1 (free) bundle.",
    ),
    with_eternitas: bool = typer.Option(
        False,
        "--with-eternitas",
        help="Skip the Eternitas prompt and provision a Tier 2 (credentialed) bundle.",
    ),
    dry_run: bool = typer.Option(
        False,
        "--dry-run",
        help="Run detection + prompts + writers, but do not actually write files.",
    ),
) -> None:
    """Pair this machine's AI agent(s) with the Windy ecosystem."""
    if with_eternitas and no_eternitas:
        console.print("[red]--with-eternitas and --no-eternitas are mutually exclusive.[/]")
        raise typer.Exit(2)

    console.print(
        Panel.fit(
            "[bold cyan]Windy Connect[/]\n"
            "One sign-in. Email + chat + LLM access for your AI agent.",
            border_style="cyan",
        )
    )

    # 1. Detect installed agents
    detected = detect_all()
    _print_detection_table(detected)

    # 2. Pick which agents to wire up
    selected = _prompt_agent_selection(detected)
    if not selected:
        console.print("[yellow]No agents selected. Exiting.[/]")
        raise typer.Exit(0)

    # 3. Eternitas opt-in (per ADR-052 — first prompt, marketing copy embedded)
    if with_eternitas:
        tier = "credentialed"
    elif no_eternitas:
        tier = "free"
    else:
        tier = _prompt_eternitas()

    # 4. Sign-in method (stubbed — placeholder for OAuth flow)
    if not mock:
        console.print(
            "[red]The OAuth orchestrator backend isn't deployed yet.[/] "
            "Re-run with [bold]--mock[/] to exercise the full local flow."
        )
        raise typer.Exit(1)

    # 5. Fetch / synthesize bundle
    bundle = make_mock_bundle(tier=tier)
    console.print(
        f"[green]✓[/] Bundle received (mock): "
        f"tier=[bold]{bundle.tier}[/], "
        f"passport=[bold]{bundle.eternitas.passport if bundle.eternitas else 'N/A'}[/], "
        f"mail=[bold]{bundle.windy_mail.address if bundle.windy_mail else 'N/A'}[/]"
    )

    # 6. Write configs for each selected agent
    results = _apply_bundle(bundle, selected, dry_run=dry_run)

    # 7. Summary
    _print_write_summary(results, dry_run=dry_run)
    console.print(
        "[bold green]🎉 Done.[/] Try asking your agent: "
        '"Send me a test email from my new Windy address."'
    )


@app.command()
def status() -> None:
    """Show current Windy connection state for detected agents."""
    console.print("[bold cyan]windy status[/] — not yet implemented")
    raise typer.Exit(1)


@app.command()
def disconnect() -> None:
    """Remove Windy credentials from detected agents."""
    console.print("[bold cyan]windy disconnect[/] — not yet implemented")
    raise typer.Exit(1)


@app.command()
def version() -> None:
    """Print the windy CLI version."""
    console.print(f"windy {__version__}")


# ---------------------------------------------------------------------------
# Interactive helpers
# ---------------------------------------------------------------------------


def _print_detection_table(detected: list[AgentInfo]) -> None:
    table = Table(title="Detected on this system", show_lines=False)
    table.add_column("Agent", style="bold")
    table.add_column("Status")
    table.add_column("Location")
    for a in detected:
        if a.detected:
            status = "[green]✓ found[/]"
        else:
            status = "[dim]not found[/]"
        table.add_row(
            a.display_name,
            status,
            str(a.install_path or a.binary_path or "—"),
        )
    console.print(table)


def _prompt_agent_selection(detected: list[AgentInfo]) -> list[AgentInfo]:
    """Pick which agents to wire up. Defaults to all detected ones; generic is always offered."""
    found = [a for a in detected if a.detected and a.slug != "generic"]
    generic = next(a for a in detected if a.slug == "generic")

    if not found:
        console.print(
            "[yellow]No known agent installations detected — "
            "I'll write a generic bundle to ~/.windy/bundle.json.[/]"
        )
        return [generic]

    default_choice = ",".join(a.slug for a in found) + ",generic"
    raw = Prompt.ask(
        "Which agents should I connect? (comma-separated slugs, or 'all')",
        default=default_choice,
        show_default=True,
    )
    if raw.strip().lower() == "all":
        chosen_slugs = {a.slug for a in detected if a.detected or a.slug == "generic"}
    else:
        chosen_slugs = {s.strip() for s in raw.split(",") if s.strip()}

    return [a for a in detected if a.slug in chosen_slugs]


def _prompt_eternitas() -> str:
    """Show the Eternitas pitch and capture the user's tier choice."""
    console.print(Panel(ETERNITAS_PITCH, title="About Eternitas", border_style="magenta"))
    yes = Confirm.ask(
        "[bold]Get Eternitas credentials? (recommended)[/]",
        default=True,
    )
    return "credentialed" if yes else "free"


def _apply_bundle(
    bundle: Bundle, selected: list[AgentInfo], *, dry_run: bool
) -> list[WriteResult]:
    """Invoke the appropriate Writer for each selected agent."""
    results: list[WriteResult] = []
    for agent in selected:
        writer_cls = REGISTRY.get(agent.slug)
        if writer_cls is None:
            results.append(
                WriteResult(
                    agent_slug=agent.slug,
                    error=f"No writer registered for slug={agent.slug!r}",
                )
            )
            continue
        writer = writer_cls(dry_run=dry_run)
        try:
            results.append(writer.write(bundle))
        except Exception as exc:  # noqa: BLE001 — surface the error verbatim
            results.append(WriteResult(agent_slug=agent.slug, error=str(exc)))
    return results


def _print_write_summary(results: list[WriteResult], *, dry_run: bool) -> None:
    title = "What I wrote" if not dry_run else "What I would have written (--dry-run)"
    table = Table(title=title)
    table.add_column("Agent", style="bold")
    table.add_column("Files")
    table.add_column("Skipped")
    for r in results:
        files = "\n".join(str(p) for p in r.files_written) if r.files_written else "—"
        if r.error:
            skipped = f"[red]ERROR: {r.error}[/]"
        else:
            skipped = "\n".join(r.skipped) if r.skipped else "—"
        table.add_row(r.agent_slug, files, skipped)
    console.print(table)


if __name__ == "__main__":
    app()
