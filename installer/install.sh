#!/usr/bin/env bash
# Windy Connect installer.
#
# Usage:
#   curl -fsSL https://get.windyconnect.com | sh
#   curl -fsSL https://get.windyconnect.com | sh -s -- --version 0.3.1
#   curl -fsSL https://get.windyconnect.com | sh -s -- --ref main
#   curl -fsSL https://get.windyconnect.com | sh -s -- --dry-run
#   curl -fsSL https://get.windyconnect.com | sh -s -- --uninstall
#
# What it does:
#   1. Verifies Python 3.11+ is available.
#   2. Installs `windy-connect` into an isolated venv via pipx (preferred)
#      or `pip install --user` (fallback).
#   3. Tells you how to add ~/.local/bin to PATH if needed.

# ── Re-exec in bash if invoked via `sh` ───────────────────────────────────────
# On Debian/Ubuntu, /bin/sh → dash, which doesn't support `[[ ]]`, arrays,
# or `local`. Users pipe through `sh` (`curl ... | sh`) so the bash shebang
# above is ignored. Detect and re-exec under bash. Idempotent: BASH_VERSION
# is set when bash is already running.
if [ -z "${BASH_VERSION:-}" ]; then
  if command -v bash >/dev/null 2>&1; then
    # Pass through args so flags survive the re-exec.
    exec bash "$0" "$@"
  fi
  echo "bash is required (install bash, or run via \`bash install.sh\`)." >&2
  exit 1
fi

set -euo pipefail

# ── config ────────────────────────────────────────────────────────────────────

REPO="sneakyfree/windy-connect"
PKG_NAME="windy-connect"
GIT_REF=""
PIN_VERSION=""
ACTION="install"
DRY_RUN="false"

# ── args ──────────────────────────────────────────────────────────────────────

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ref)
      GIT_REF="$2"
      shift 2 ;;
    --version)
      PIN_VERSION="$2"
      shift 2 ;;
    --uninstall)
      ACTION="uninstall"
      shift ;;
    --dry-run)
      DRY_RUN="true"
      shift ;;
    -h|--help)
      sed -n '2,16p' "$0"
      exit 0 ;;
    *)
      echo "Unknown argument: $1" >&2
      echo "Run with --help for usage." >&2
      exit 2 ;;
  esac
done

# Mutually exclusive: --ref says "install from a git ref", --version says
# "install this PyPI version". Catch the conflict before doing anything
# destructive.
if [[ -n "$GIT_REF" && -n "$PIN_VERSION" ]]; then
  echo "Pass either --ref OR --version, not both." >&2
  exit 2
fi

# ── helpers ──────────────────────────────────────────────────────────────────

# `say` is informational; `ok` is success; `warn` goes to stderr; `die` exits
# with an error message. Colors gracefully degrade when stdout isn't a TTY
# (CI logs, redirects) so we never inject escape codes into log files.
if [[ -t 1 ]]; then
  COLOR_BLUE='\033[36m'; COLOR_GREEN='\033[32m'; COLOR_YELLOW='\033[33m'
  COLOR_RED='\033[31m'; COLOR_RESET='\033[0m'
else
  COLOR_BLUE=''; COLOR_GREEN=''; COLOR_YELLOW=''; COLOR_RED=''; COLOR_RESET=''
fi

say()  { printf '%b▸%b %s\n' "$COLOR_BLUE" "$COLOR_RESET" "$*"; }
ok()   { printf '%b✓%b %s\n' "$COLOR_GREEN" "$COLOR_RESET" "$*"; }
warn() { printf '%b!%b %s\n' "$COLOR_YELLOW" "$COLOR_RESET" "$*" >&2; }
die()  { printf '%b✗%b %s\n' "$COLOR_RED" "$COLOR_RESET" "$*" >&2; exit 1; }

have() { command -v "$1" >/dev/null 2>&1; }

# `do_or_print` runs the command, OR (in dry-run) prints it as a fenced
# bash block so the user can inspect the exact commands curl-piping
# would execute. Avoids the trust-curl-pipe paranoia.
do_or_print() {
  if [[ "$DRY_RUN" == "true" ]]; then
    printf '%b$%b %s\n' "$COLOR_BLUE" "$COLOR_RESET" "$*"
  else
    "$@"
  fi
}

# ── main ──────────────────────────────────────────────────────────────────────

cat <<'BANNER'
   ░█░█░▀█▀░█▀█░█▀▄░█░█░░░█▀▀░█▀█░█▀█░█▀█░█▀▀░█▀▀░▀█▀
   ░█▄█░░█░░█░█░█░█░░█░░░░█░░░█░█░█░█░█░█░█▀▀░█░░░░█░
   ░▀░▀░▀▀▀░▀░▀░▀▀░░░▀░░░░▀▀▀░▀▀▀░▀░▀░▀░▀░▀▀▀░▀▀▀░░▀░
BANNER

if [[ "$DRY_RUN" == "true" ]]; then
  warn "DRY RUN — printing commands without executing. Re-run without --dry-run to install."
fi

# ── uninstall path ───────────────────────────────────────────────────────────

if [[ "$ACTION" == "uninstall" ]]; then
  if have pipx && pipx list --short 2>/dev/null | grep -q "^${PKG_NAME} "; then
    say "Removing via pipx…"
    do_or_print pipx uninstall "$PKG_NAME"
  else
    say "Removing via pip --user…"
    do_or_print python3 -m pip uninstall -y "$PKG_NAME" 2>/dev/null || true
  fi
  # Local config — preserve by default (the user may have a bundle in
  # ~/.windy-connect they care about). Print the path so they know
  # what's still on disk if they want a clean slate.
  if [[ -d "$HOME/.windy-connect" ]]; then
    warn "Config preserved at ~/.windy-connect (delete manually for a clean slate)."
  fi
  ok "Done. Run \`windy connect\` to verify it's gone (should be 'command not found')."
  exit 0
fi

# ── install path ─────────────────────────────────────────────────────────────

# 1. Detect OS — informational only; the script runs the same code path
#    on Darwin and Linux. Windows under MSYS/Cygwin warns and continues.
OS=$(uname -s 2>/dev/null || echo unknown)
case "$OS" in
  Darwin|Linux) ;;
  MINGW*|MSYS*|CYGWIN*)
    warn "Windows detected. For best results use WSL2 or install windy-connect inside a Python venv directly:"
    warn "  python -m pip install --user $PKG_NAME" ;;
  *)
    warn "Unrecognized OS ($OS). Proceeding anyway." ;;
esac

# 2. Python ≥ 3.11
if ! have python3; then
  die "python3 not found. Install Python 3.11+ first: https://www.python.org/downloads/"
fi
PYV=$(python3 -c 'import sys;print(f"{sys.version_info.major}.{sys.version_info.minor}")')
PYV_MAJOR=${PYV%.*}
PYV_MINOR=${PYV#*.}
if [[ "$PYV_MAJOR" -lt 3 ]] || { [[ "$PYV_MAJOR" -eq 3 ]] && [[ "$PYV_MINOR" -lt 11 ]]; }; then
  # Common case on Debian/Ubuntu LTS: system python3 is 3.10 or older.
  # Point them to the specific fix rather than "install a newer Python".
  die "Python 3.11+ required (found $PYV).
   On macOS:        brew install python@3.12
   On Ubuntu 22.04: sudo add-apt-repository ppa:deadsnakes/ppa && sudo apt install python3.12
   Or use uv / pyenv to manage Python versions."
fi
ok "Python $PYV OK"

# 3. Already installed?
if have windy; then
  CURRENT_VER=$(windy version 2>/dev/null | head -1 | awk '{print $NF}' || echo unknown)
  if [[ -n "$PIN_VERSION" && "$CURRENT_VER" == "$PIN_VERSION" ]]; then
    ok "windy-connect $CURRENT_VER already installed — nothing to do."
    exit 0
  fi
  if [[ -z "$PIN_VERSION" && -z "$GIT_REF" ]]; then
    say "Found windy-connect $CURRENT_VER — upgrading to latest…"
  fi
fi

# 4. Choose install source — flag-driven, no hardcoded "always PyPI" lie.
#    Priority: --version > --ref > latest from PyPI.
if [[ -n "$PIN_VERSION" ]]; then
  INSTALL_SOURCE="${PKG_NAME}==${PIN_VERSION}"
  say "Pinning to version: $PIN_VERSION"
elif [[ -n "$GIT_REF" ]]; then
  INSTALL_SOURCE="git+https://github.com/${REPO}.git@${GIT_REF}"
  say "Installing from git ref: $GIT_REF"
else
  INSTALL_SOURCE="$PKG_NAME"
fi

# 5. Install via pipx (preferred) or pip --user (fallback).
if have pipx; then
  say "Installing via pipx (isolated venv at \$PIPX_HOME)…"
  # --force lets re-runs upgrade cleanly without manual `pipx uninstall`.
  do_or_print pipx install --force "$INSTALL_SOURCE"
else
  warn "pipx not found — falling back to \`pip install --user\`."
  warn "  (pipx is recommended for CLI tools; see https://pipx.pypa.io)"
  do_or_print python3 -m pip install --user --upgrade "$INSTALL_SOURCE"
fi

if [[ "$DRY_RUN" == "true" ]]; then
  ok "Dry-run complete. Re-run without --dry-run to install."
  exit 0
fi

# 6. PATH check
USER_BIN="$HOME/.local/bin"
if ! echo ":$PATH:" | grep -q ":$USER_BIN:" && [[ -d "$USER_BIN" ]]; then
  warn "$USER_BIN is not in your PATH. Add this to your shell rc:"
  warn "    export PATH=\"\$HOME/.local/bin:\$PATH\""
  warn "  Then open a new terminal (or run \`source ~/.zshrc\` / \`source ~/.bashrc\`)."
fi

# 7. Verify
if have windy; then
  WINDY_VER=$(windy version 2>/dev/null | head -1 || echo "(version unknown)")
  ok "Installed: $WINDY_VER"
else
  warn "Installed but \`windy\` is not on PATH yet."
  warn "Open a new shell or update PATH (see above), then run: windy connect"
  exit 0
fi

cat <<'NEXT'

──────────────────────────────────────────────────────────
Get started:
    windy connect           # pair your agent (interactive)
    windy connect --mock    # try the flow without a backend
    windy status            # see what's wired
    windy disconnect        # reverse everything

Docs:    https://github.com/sneakyfree/windy-connect
Support: hello@windyconnect.com
──────────────────────────────────────────────────────────
NEXT
