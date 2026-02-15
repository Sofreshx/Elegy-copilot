#!/usr/bin/env bash
set -euo pipefail

TARGET_REPO="${1:-$PWD}"
TEMPLATE="${2:-bash}" # bash|powershell
HOOK_NAME="${3:-exec-automation}"

ENGINE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ "$TEMPLATE" == "powershell" ]]; then
  TEMPLATE_PATH="$ENGINE_ROOT/.github/templates/hooks.powershell.json"
  OUT_NAME="$HOOK_NAME.powershell.json"
else
  TEMPLATE_PATH="$ENGINE_ROOT/.github/templates/hooks.bash.json"
  OUT_NAME="$HOOK_NAME.bash.json"
fi

if [[ ! -f "$TEMPLATE_PATH" ]]; then
  echo "Hook template not found: $TEMPLATE_PATH" >&2
  exit 1
fi

mkdir -p "$TARGET_REPO/.github/hooks"
mkdir -p "$TARGET_REPO/scripts"

cp -f "$TEMPLATE_PATH" "$TARGET_REPO/.github/hooks/$OUT_NAME"

# Copy hook scripts folder (idempotent overwrite)
rm -rf "$TARGET_REPO/scripts/hooks"
cp -R "$ENGINE_ROOT/scripts/hooks" "$TARGET_REPO/scripts/hooks"

echo "Enabled Copilot agent hooks in: $TARGET_REPO"
echo "- Hook config: $TARGET_REPO/.github/hooks/$OUT_NAME"
echo "- Scripts: $TARGET_REPO/scripts/hooks"
echo "NOTE: Copilot coding agent loads hooks from the repo DEFAULT branch. Commit these files on that branch for enforcement."
