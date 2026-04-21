#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENGINE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
INSTALLER="$ENGINE_ROOT/scripts/antigravity-install.mjs"

if ! command -v node >/dev/null 2>&1; then
  echo "Antigravity install requires Node.js on PATH (node)." >&2
  exit 1
fi

node "$INSTALLER" "$@"
