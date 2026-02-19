#!/usr/bin/env bash
set -euo pipefail

DRY_RUN=false
FORCE=false

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --force) FORCE=true ;;
    *) echo "Unknown arg: $arg (supported: --dry-run, --force)" >&2; exit 2 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENGINE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SOURCE_ROOT="$ENGINE_ROOT/.cli"

if [[ ! -d "$SOURCE_ROOT" ]]; then
  echo "Missing source folder: $SOURCE_ROOT" >&2
  exit 1
fi

if [[ -n "${XDG_CONFIG_HOME:-}" ]]; then
  # Copilot CLI treats XDG_CONFIG_HOME as an override for the entire config dir
  # (default is already $HOME/.copilot), so do not append extra path segments.
  COPILOT_HOME="$XDG_CONFIG_HOME"
else
  COPILOT_HOME="$HOME/.copilot"
fi

echo "Copilot home: $COPILOT_HOME"
echo "Source:       $SOURCE_ROOT"

mkdir_if_needed() {
  local dir="$1"
  if [[ -d "$dir" ]]; then
    return 0
  fi

  if $DRY_RUN; then
    echo "[DRY-RUN] mkdir $dir"
  else
    mkdir -p "$dir"
  fi
}

confirm_overwrite() {
  local path="$1"
  if $FORCE; then
    return 0
  fi

  if $DRY_RUN; then
    return 1
  fi

  if [[ ! -t 0 ]]; then
    return 1
  fi

  read -r -p "Overwrite $path ? [y/N] " resp
  [[ "$resp" =~ ^([yY]|[yY][eE][sS])$ ]]
}

sync_file() {
  local src="$1"
  local dst="$2"

  if [[ ! -f "$src" ]]; then
    echo "Source file not found: $src" >&2
    exit 1
  fi

  mkdir_if_needed "$(dirname "$dst")"

  if [[ ! -f "$dst" ]]; then
    if $DRY_RUN; then
      echo "[DRY-RUN] CREATE $dst"
    else
      cp -f "$src" "$dst"
      echo "[CREATE] $dst"
    fi
    return 0
  fi

  if cmp -s "$src" "$dst"; then
    echo "[SKIP]   $dst (up-to-date)"
    return 0
  fi

  if $DRY_RUN && ! $FORCE; then
    echo "[DRY-RUN] WOULD-UPDATE $dst (differs; re-run with --force to overwrite)"
    return 0
  fi

  if ! confirm_overwrite "$dst"; then
    echo "[SKIP]   $dst (differs; re-run with --force to overwrite)"
    return 0
  fi

  if $DRY_RUN; then
    echo "[DRY-RUN] UPDATE $dst"
  else
    cp -f "$src" "$dst"
    echo "[UPDATE] $dst"
  fi
}

mkdir_if_needed "$COPILOT_HOME"

# .cli/agents/*.agent.md -> <copilotHome>/agents/ (flatten)
mkdir_if_needed "$COPILOT_HOME/agents"
shopt -s nullglob
for src in "$SOURCE_ROOT/agents/"*.agent.md; do
  sync_file "$src" "$COPILOT_HOME/agents/$(basename "$src")"
done

# .cli/skills/**/SKILL.md -> <copilotHome>/skills/... (preserve folder)
SOURCE_SKILLS="$SOURCE_ROOT/skills"
TARGET_SKILLS="$COPILOT_HOME/skills"
mkdir_if_needed "$TARGET_SKILLS"

while IFS= read -r -d '' skill_file; do
  skill_dir="$(dirname "$skill_file")"
  rel_dir="${skill_dir#"$SOURCE_SKILLS"/}"
  if [[ "$rel_dir" == "$skill_dir" ]]; then
    rel_dir=""
  fi
  if [[ -n "$rel_dir" ]]; then
    sync_file "$skill_file" "$TARGET_SKILLS/$rel_dir/SKILL.md"
  else
    sync_file "$skill_file" "$TARGET_SKILLS/SKILL.md"
  fi
done < <(find "$SOURCE_SKILLS" -type f -name 'SKILL.md' -print0)

# .cli/instructions/copilot-instructions.md -> <copilotHome>/copilot-instructions.md
sync_file "$SOURCE_ROOT/instructions/copilot-instructions.md" "$COPILOT_HOME/copilot-instructions.md"

echo "Done."
