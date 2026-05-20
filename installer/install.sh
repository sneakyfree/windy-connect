#!/usr/bin/env bash
# Windy Connect installer.
#
# Usage:
#   curl -fsSL https://get.windyconnect.com | sh
#   curl -fsSL https://get.windyconnect.com | sh -s -- --ref main         # install from a specific git ref
#   curl -fsSL https://get.windyconnect.com | sh -s -- --uninstall         # remove
#
# What it does:
#   1. Verifies Python 3.11+ is available.
#   2. Installs `windy-connect` into an isolated venv via pipx (preferred) or
#      `pip install --user` (fallback).
#   3. Tells you how to add ~/.local/bin to PATH if needed.

set -euo pipefail

# ---- config ---------------------------------------------------------------

REPO="sneakyfree/windy-connect"
PKG_NAME="windy-connect"
PYPI_PUBLISHED="false"  # flip to "true" once windy-connect is on PyPI
GIT_REF="main"
ACTION="install"

# ---- args -----------------------------------------------------------------

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ref) GIT_REF="$2"; shift 2 ;;
    --uninstall) ACTION="uninstall"; shift ;;
    -h|--help)
      sed -n '2,11p' "$0"
      exit 0 ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2 ;;
  esac
done

# ---- helpers --------------------------------------------------------------

say()   { printf '\033[36m▸\033[0m %s\n' "$*"; }
ok()    { printf '\033[32m✓\033[0m %s\n' "$*"; }
warn()  { printf '\033[33m!\033[0m %s\n' "$*" >&2; }
die()   { printf '\033[31m✗\033[0m %s\n' "$*" >&2; exit 1; }

have()  { command -v "$1" >/dev/null 2>&1; }

# ---- main -----------------------------------------------------------------

cat <<'BANNER'
   ░█░█░▀█▀░█▀█░█▀▄░█░█░░░█▀▀░█▀█░█▀█░█▀█░█▀▀░█▀▀░▀█▀
   ░█▄█░░█░░█░█░█░█░░█░░░░█░░░█░█░█░█░█░█░█▀▀░█░░░░█░
   ░▀░▀░▀▀▀░▀░▀░▀▀░░░▀░░░░▀▀▀░▀▀▀░▀░▀░▀░▀░▀▀▀░▀▀▀░░▀░
BANNER

if [[ "$ACTION" == "uninstall" ]]; then
  if have pipx && pipx list --short 2>/dev/null | grep -q "^${PKG_NAME} "; then
    say "Removing via pipx…"
    pipx uninstall "$PKG_NAME"
  else
    say "Removing via pip --user…"
    python3 -m pip uninstall -y "$PKG_NAME" 2>/dev/null || true
  fi
  ok "Done. Run \`windy connect\` to verify it's gone (should be 'command not found')."
  exit 0
fi

# 1. Detect OS
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
  die "Python 3.11+ required (found $PYV). Install a newer Python and rerun."
fi
ok "Python $PYV OK"

# 3. Choose installer
INSTALL_SOURCE="git+https://github.com/${REPO}.git@${GIT_REF}"
if [[ "$PYPI_PUBLISHED" == "true" ]]; then
  INSTALL_SOURCE="$PKG_NAME"
fi

if have pipx; then
  say "Installing via pipx (isolated venv at \$PIPX_HOME)…"
  # Use --force so re-running upgrades cleanly.
  pipx install --force "$INSTALL_SOURCE"
else
  warn "pipx not found — falling back to \`pip install --user\`."
  warn "  (pipx is recommended for CLI tools; see https://pipx.pypa.io)"
  python3 -m pip install --user --upgrade "$INSTALL_SOURCE"
fi

# 4. PATH check
USER_BIN="$HOME/.local/bin"
if ! echo ":$PATH:" | grep -q ":$USER_BIN:" && [[ -d "$USER_BIN" ]]; then
  warn "$USER_BIN is not in your PATH. Add this to your shell rc:"
  warn "    export PATH=\"\$HOME/.local/bin:\$PATH\""
fi

# 5. Verify
if have windy; then
  WINDY_VER=$(windy version 2>&1 | head -1)
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
