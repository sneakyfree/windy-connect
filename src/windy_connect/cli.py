"""windy CLI entry point.

Subcommands:
    windy connect      — interactive pairing: provision bundle, write agent configs
    windy status       — show current connection state (reads ~/.windy/state.json)
    windy disconnect   — reverse what connect wrote and delete state
    windy version

Currently the OAuth orchestrator backend is stubbed. Pass ``--mock`` to
``windy connect`` to exercise the full local flow against an in-memory bundle.
"""

from __future__ import annotations

from datetime import UTC, datetime

import typer
from rich.console import Console
from rich.panel import Panel
from rich.prompt import Confirm, Prompt
from rich.table import Table

from . import __version__, state as state_mod
from ._mock_bundle import make_mock_bundle
from .bundle import Bundle
from .detect import AgentInfo, detect_all
from .state import State
from .writers import REGISTRY, RemoveResult, WriteResult

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
    force: bool = typer.Option(
        False,
        "--force",
        help="Overwrite an existing connection without prompting.",
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

    # 0. Detect prior state — refuse to silently overwrite
    existing = state_mod.load()
    if existing is not None and not force and not dry_run:
        _print_existing_state_summary(existing)
        if not Confirm.ask(
            "[yellow]Reconnect and overwrite the current connection?[/]", default=False
        ):
            console.print("Aborted. Run [bold]windy disconnect[/] first if you want a clean slate.")
            raise typer.Exit(0)

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

    # 7. Persist state (skip in dry-run)
    if not dry_run:
        successful = [r for r in results if r.error is None]
        state_mod.save(
            State(
                connected_at=datetime.now(UTC),
                bundle=bundle,
                writes=successful,
            )
        )

    # 8. Summary
    _print_write_summary(results, dry_run=dry_run)
    console.print(
        "[bold green]🎉 Done.[/] Try asking your agent: "
        '"Send me a test email from my new Windy address."'
    )


@app.command()
def status() -> None:
    """Show current Windy connection state for detected agents."""
    state = state_mod.load()
    if state is None:
        console.print(
            "[yellow]Not connected.[/] Run [bold]windy connect[/] to pair this machine."
        )
        raise typer.Exit(1)

    b = state.bundle
    expiry_color = "red" if b.is_expired else "green"

    header = Table.grid(padding=(0, 2))
    header.add_column(style="bold")
    header.add_column()
    header.add_row("Tier:", f"[bold]{b.tier}[/]")
    header.add_row("Issuer:", str(b.issuer.url))
    header.add_row("Connected:", state.connected_at.isoformat(timespec="seconds"))
    header.add_row("Issued:", b.issued_at.isoformat(timespec="seconds"))
    header.add_row(
        "Expires:",
        f"[{expiry_color}]{b.expires_at.isoformat(timespec='seconds')}"
        f"{' (EXPIRED)' if b.is_expired else ''}[/]",
    )
    if b.eternitas:
        header.add_row("Passport:", f"[bold]{b.eternitas.passport}[/]")
        header.add_row(
            "Clearance / Integrity:",
            f"{b.eternitas.clearance_level} / {b.eternitas.integrity_band}",
        )
    if b.windy_mail:
        header.add_row("Mail:", b.windy_mail.address)
    if b.windy_chat:
        header.add_row("Matrix:", b.windy_chat.matrix_user_id)
    if b.windy_mind:
        header.add_row("Mind:", str(b.windy_mind.base_url))

    console.print(Panel(header, title="Windy connection", border_style="cyan"))

    table = Table(title="Per-agent writes")
    table.add_column("Agent", style="bold")
    table.add_column("Owned files")
    table.add_column("Shared-file blocks")
    table.add_column("Status")

    for w in state.writes:
        owned = "\n".join(str(p) for p in w.owned_files) or "—"
        blocks = "\n".join(str(e.file_path) for e in w.block_edits) or "—"
        missing: list[str] = []
        for p in w.owned_files:
            if not p.exists():
                missing.append(f"missing: {p}")
        for e in w.block_edits:
            if not e.file_path.exists():
                missing.append(f"missing: {e.file_path}")
        status_cell = "[green]✓ ok[/]" if not missing else f"[red]{'; '.join(missing)}[/]"
        table.add_row(w.agent_slug, owned, blocks, status_cell)

    console.print(table)


@app.command()
def disconnect(
    yes: bool = typer.Option(False, "--yes", "-y", help="Skip confirmation prompt."),
    dry_run: bool = typer.Option(False, "--dry-run", help="Show what would be removed."),
) -> None:
    """Remove Windy credentials from detected agents and delete state."""
    state = state_mod.load()
    if state is None:
        console.print("[yellow]Not connected — nothing to disconnect.[/]")
        raise typer.Exit(0)

    _print_existing_state_summary(state)
    if not yes and not dry_run:
        if not Confirm.ask(
            "[red]Remove all Windy credentials from this machine?[/]", default=False
        ):
            console.print("Aborted.")
            raise typer.Exit(0)

    results: list[RemoveResult] = []
    for write in state.writes:
        writer_cls = REGISTRY.get(write.agent_slug)
        if writer_cls is None:
            results.append(
                RemoveResult(
                    agent_slug=write.agent_slug,
                    error=f"No writer registered for slug={write.agent_slug!r}",
                )
            )
            continue
        writer = writer_cls(dry_run=dry_run)
        try:
            results.append(writer.remove(write))
        except Exception as exc:  # noqa: BLE001
            results.append(RemoveResult(agent_slug=write.agent_slug, error=str(exc)))

    if not dry_run:
        state_mod.delete()

    table = Table(title="Disconnect summary" + (" (--dry-run)" if dry_run else ""))
    table.add_column("Agent", style="bold")
    table.add_column("Files deleted")
    table.add_column("Blocks stripped")
    table.add_column("Notes")
    for r in results:
        files = "\n".join(str(p) for p in r.files_deleted) or "—"
        blocks = "\n".join(str(e.file_path) for e in r.blocks_stripped) or "—"
        if r.error:
            notes = f"[red]ERROR: {r.error}[/]"
        else:
            notes = "\n".join(r.skipped) or "—"
        table.add_row(r.agent_slug, files, blocks, notes)
    console.print(table)

    if not dry_run:
        console.print("[bold green]Disconnected.[/]")


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
        status_cell = "[green]✓ found[/]" if a.detected else "[dim]not found[/]"
        table.add_row(
            a.display_name,
            status_cell,
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
        except Exception as exc:  # noqa: BLE001
            results.append(WriteResult(agent_slug=agent.slug, error=str(exc)))
    return results


def _print_write_summary(results: list[WriteResult], *, dry_run: bool) -> None:
    title = "What I wrote" if not dry_run else "What I would have written (--dry-run)"
    table = Table(title=title)
    table.add_column("Agent", style="bold")
    table.add_column("Files")
    table.add_column("Skipped")
    for r in results:
        files = "\n".join(str(p) for p in r.files_touched) if r.files_touched else "—"
        if r.error:
            skipped = f"[red]ERROR: {r.error}[/]"
        else:
            skipped = "\n".join(r.skipped) if r.skipped else "—"
        table.add_row(r.agent_slug, files, skipped)
    console.print(table)


def _print_existing_state_summary(state: State) -> None:
    b = state.bundle
    console.print(
        Panel(
            f"Currently connected as [bold]{b.eternitas.passport if b.eternitas else b.tier}[/] "
            f"since {state.connected_at.isoformat(timespec='seconds')}\n"
            f"Mail: {b.windy_mail.address if b.windy_mail else 'N/A'}",
            title="Existing connection",
            border_style="yellow",
        )
    )


if __name__ == "__main__":
    app()
