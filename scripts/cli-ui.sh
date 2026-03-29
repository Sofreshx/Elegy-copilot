#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENGINE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SERVER_JS="$ENGINE_ROOT/copilot-ui/server.js"

if [[ ! -f "$SERVER_JS" ]]; then
  echo "Missing server entrypoint: $SERVER_JS" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Missing 'node' on PATH." >&2
  exit 1
fi

forwarded_args=()

for arg in "$@"; do
  if [[ "$arg" == "--sdk" ]]; then
    export COPILOT_SDK_BRIDGE='1'
    continue
  fi

  forwarded_args+=("$arg")
done

exec node "$SERVER_JS" "${forwarded_args[@]}"
