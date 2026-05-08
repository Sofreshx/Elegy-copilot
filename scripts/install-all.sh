#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENGINE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
COPILOT_INSTALLER="$ENGINE_ROOT/scripts/cli-install.sh"
CODEX_INSTALLER="$ENGINE_ROOT/scripts/codex-install.sh"
ANTIGRAVITY_INSTALLER="$ENGINE_ROOT/scripts/antigravity-install.sh"
OPENCODE_INSTALLER="$ENGINE_ROOT/scripts/opencode-install.sh"

shared_args=()
copilot_args=(--all)

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run|--force)
      shared_args+=("$1")
      copilot_args+=("$1")
      shift
      ;;
    --profile)
      if [[ $# -lt 2 ]]; then
        echo "Missing value for --profile" >&2
        exit 2
      fi
      copilot_args+=("$1" "$2")
      shift 2
      ;;
    --profile=*)
      copilot_args+=("$1")
      shift
      ;;
    --minimal|--full|--public|--internal)
      copilot_args+=("$1")
      shift
      ;;
    *)
      echo "Unknown arg: $1 (supported: --dry-run, --force, --profile <minimal|full>, --profile=<minimal|full>, --minimal, --full, --public, --internal)" >&2
      exit 2
      ;;
  esac
done

echo '==> Copilot'
bash "$COPILOT_INSTALLER" "${copilot_args[@]}"

echo '==> Codex'
bash "$CODEX_INSTALLER" "${shared_args[@]}"

echo '==> Antigravity'
bash "$ANTIGRAVITY_INSTALLER" "${shared_args[@]}"

echo '==> OpenCode'
bash "$OPENCODE_INSTALLER" "${shared_args[@]}"
