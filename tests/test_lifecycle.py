"""End-to-end CLI lifecycle: connect → status → disconnect."""

from __future__ import annotations

from pathlib import Path

from typer.testing import CliRunner

from windy_connect.cli import app

runner = CliRunner()


def test_status_when_not_connected(sandbox: Path) -> None:
    result = runner.invoke(app, ["status"])
    assert result.exit_code == 1
    assert "Not connected" in result.stdout


def test_full_lifecycle(sandbox: Path) -> None:
    # 1. connect (mock, credentialed, all agents)
    result = runner.invoke(
        app,
        ["connect", "--mock", "--with-eternitas"],
        input="all\n",
    )
    assert result.exit_code == 0, result.stdout
    assert "Bundle received (mock)" in result.stdout
    assert "Done" in result.stdout

    # 2. status should now show the connection
    result = runner.invoke(app, ["status"])
    assert result.exit_code == 0, result.stdout
    assert "credentialed" in result.stdout
    assert "ET26-MOCK-0001" in result.stdout

    # 3. disconnect dry-run keeps state
    result = runner.invoke(app, ["disconnect", "--yes", "--dry-run"])
    assert result.exit_code == 0
    assert "Disconnect summary" in result.stdout
    # state still present
    result = runner.invoke(app, ["status"])
    assert result.exit_code == 0
    assert "credentialed" in result.stdout

    # 4. real disconnect
    result = runner.invoke(app, ["disconnect", "--yes"])
    assert result.exit_code == 0
    assert "Disconnected" in result.stdout

    # 5. status back to not-connected
    result = runner.invoke(app, ["status"])
    assert result.exit_code == 1
    assert "Not connected" in result.stdout


def test_connect_refuses_reconnect_without_force(sandbox: Path) -> None:
    runner.invoke(app, ["connect", "--mock", "--with-eternitas"], input="all\n")
    # Second invocation without --force: answer "n" to the overwrite prompt.
    result = runner.invoke(app, ["connect", "--mock", "--with-eternitas"], input="n\n")
    assert result.exit_code == 0
    assert "Aborted" in result.stdout


def test_connect_with_force_overwrites(sandbox: Path) -> None:
    runner.invoke(app, ["connect", "--mock", "--no-eternitas"], input="all\n")
    result = runner.invoke(
        app, ["connect", "--mock", "--with-eternitas", "--force"], input="all\n"
    )
    assert result.exit_code == 0
    # Re-read state — tier should have flipped to credentialed
    result = runner.invoke(app, ["status"])
    assert "credentialed" in result.stdout


def test_mutually_exclusive_eternitas_flags(sandbox: Path) -> None:
    result = runner.invoke(
        app, ["connect", "--mock", "--with-eternitas", "--no-eternitas"]
    )
    assert result.exit_code == 2
    assert "mutually exclusive" in result.stdout


def test_connect_without_mock_exits_with_message(sandbox: Path) -> None:
    result = runner.invoke(
        app, ["connect", "--with-eternitas"], input="all\n"
    )
    assert result.exit_code == 1
    assert "orchestrator backend isn't deployed" in result.stdout


def test_version() -> None:
    result = runner.invoke(app, ["version"])
    assert result.exit_code == 0
    assert "windy" in result.stdout
