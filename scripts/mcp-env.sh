#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${MCP_ENV_FILE:-$ROOT_DIR/.env.mcp}"
LOCAL_ENV_FILE="$ROOT_DIR/.env.mcp.local"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE. Copy .env.mcp.example to .env.mcp and fill values."
  exit 1
fi

set -a
. "$ENV_FILE"
if [[ -f "$LOCAL_ENV_FILE" ]]; then
  . "$LOCAL_ENV_FILE"
fi
set +a

if [[ $# -gt 0 ]]; then
  exec "$@"
fi

if command -v code >/dev/null 2>&1; then
  exec code "$ROOT_DIR"
fi

echo "VS Code CLI 'code' not found. Open VS Code from this shell to inherit MCP env vars."
