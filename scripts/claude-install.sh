#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALLER="$SCRIPT_DIR/claude-install.mjs"

if ! command -v node &>/dev/null; then
  echo "ERROR: node is not installed or not on PATH" >&2
  exit 1
fi

node "$INSTALLER" "$@"
