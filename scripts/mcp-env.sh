#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEFAULT_ENV_FILE="${HOME}/.config/elegy-copilot/mcp.env"
ENV_FILE="${MCP_ENV_FILE:-$DEFAULT_ENV_FILE}"
LOCAL_ENV_FILE="${ENV_FILE}.local"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE. Store MCP secrets outside the repo (for example, $DEFAULT_ENV_FILE) or set MCP_ENV_FILE."
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
