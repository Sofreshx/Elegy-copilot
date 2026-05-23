#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENGINE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SERVER_JS="$ENGINE_ROOT/copilot-ui/server.js"

if [[ ! -f "$SERVER_JS" ]]; then
  echo "Missing server entrypoint: $SERVER_JS" >&2
  exit 1
fi

NODE_BIN=''
if command -v node >/dev/null 2>&1; then
  NODE_BIN='node'
elif command -v node.exe >/dev/null 2>&1; then
  NODE_BIN='node.exe'
fi

if [[ -z "$NODE_BIN" ]]; then
  echo "Missing 'node' on PATH." >&2
  exit 1
fi

if [[ "$NODE_BIN" == 'node.exe' ]]; then
  if command -v wslpath >/dev/null 2>&1; then
    SERVER_JS="$(wslpath -aw "$SERVER_JS")"
  elif command -v cygpath >/dev/null 2>&1; then
    SERVER_JS="$(cygpath -aw "$SERVER_JS")"
  fi
fi

forwarded_args=()

for arg in "$@"; do
  if [[ "$arg" == "--sdk" ]]; then
    export COPILOT_SDK_BRIDGE='1'
    continue
  fi

  forwarded_args+=("$arg")
done

exec "$NODE_BIN" "$SERVER_JS" "${forwarded_args[@]}"
