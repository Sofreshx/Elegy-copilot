#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENGINE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
INSTALLER="$ENGINE_ROOT/scripts/opencode-install.mjs"

if ! command -v node &> /dev/null; then
  echo "OpenCode install requires Node.js on PATH (node)." >&2
  exit 1
fi

node "$INSTALLER" "$@"
