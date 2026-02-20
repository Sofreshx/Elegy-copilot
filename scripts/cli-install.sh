#!/usr/bin/env bash
set -euo pipefail

DRY_RUN=false
FORCE=false

DO_CLI=false
DO_VSCODE=false
VSCODE_SETTINGS=""

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --force) FORCE=true ;;
    --cli) DO_CLI=true ;;
    --vscode) DO_VSCODE=true ;;
    --all) DO_CLI=true; DO_VSCODE=true ;;
    --vscode-settings=*) VSCODE_SETTINGS="${arg#--vscode-settings=}" ;;
    *) echo "Unknown arg: $arg (supported: --dry-run, --force, --cli, --vscode, --all, --vscode-settings=<path>)" >&2; exit 2 ;;
  esac
done

# Handle the space-separated form: --vscode-settings <path>
for ((i=1; i<=$#; i++)); do
  if [[ "${!i}" == "--vscode-settings" ]]; then
    next=$((i+1))
    if [[ $next -le $# ]]; then
      VSCODE_SETTINGS="${!next}"
    else
      echo "Missing value for --vscode-settings" >&2
      exit 2
    fi
  fi
done

if ! $DO_CLI && ! $DO_VSCODE; then
  DO_CLI=true
  DO_VSCODE=true
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENGINE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CLI_ROOT="$ENGINE_ROOT/.cli"
SRC_AGENTS_ROOT="$ENGINE_ROOT/.github/agents"
SRC_SKILLS_ROOT="$ENGINE_ROOT/.github/skills"
SRC_PROMPTS_ROOT="$ENGINE_ROOT/.github/prompts"
SRC_INSTRUCTIONS="$CLI_ROOT/instructions/copilot-instructions.md"

if [[ ! -d "$CLI_ROOT" ]]; then
  echo "Missing folder: $CLI_ROOT" >&2
  exit 1
fi

if $DO_CLI; then
  [[ -d "$SRC_AGENTS_ROOT" ]] || { echo "Missing agents source: $SRC_AGENTS_ROOT" >&2; exit 1; }
  [[ -d "$SRC_SKILLS_ROOT" ]] || { echo "Missing skills source: $SRC_SKILLS_ROOT" >&2; exit 1; }
  [[ -f "$SRC_INSTRUCTIONS" ]] || { echo "Missing instructions source: $SRC_INSTRUCTIONS" >&2; exit 1; }
fi

if [[ -n "${XDG_CONFIG_HOME:-}" ]]; then
  # Copilot CLI treats XDG_CONFIG_HOME as an override for the entire config dir
  # (default is already $HOME/.copilot), so do not append extra path segments.
  COPILOT_HOME="$XDG_CONFIG_HOME"
else
  COPILOT_HOME="$HOME/.copilot"
fi

echo "Copilot home: $COPILOT_HOME"
echo "Engine root:  $ENGINE_ROOT"
echo "Modes:        cli=$DO_CLI vscode=$DO_VSCODE"

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

sha256_file() {
  local p="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$p" | awk '{print $1}'
    return 0
  fi
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$p" | awk '{print $1}'
    return 0
  fi
  echo "" 
  return 1
}

dir_hash() {
  local dir="$1"
  if [[ ! -d "$dir" ]]; then
    echo ""
    return 1
  fi

  local tmp
  tmp="$(mktemp 2>/dev/null || echo "")"
  if [[ -z "$tmp" ]]; then
    echo ""
    return 1
  fi

  (
    cd "$dir"
    find . -type f -print | LC_ALL=C sort | while IFS= read -r f; do
      local abs="$dir/${f#./}"
      local fh
      fh="$(sha256_file "$abs")"
      printf '%s\0%s\n' "${f#./}" "$fh"
    done
  ) >"$tmp"

  local out
  out="$(sha256_file "$tmp")"
  rm -f "$tmp" >/dev/null 2>&1 || true
  echo "$out"
}

sync_dir() {
  local src_dir="$1"
  local dst_dir="$2"

  if [[ ! -d "$src_dir" ]]; then
    echo "Source directory not found: $src_dir" >&2
    exit 1
  fi

  mkdir_if_needed "$(dirname "$dst_dir")"

  if [[ ! -d "$dst_dir" ]]; then
    if $DRY_RUN; then
      echo "[DRY-RUN] CREATE-DIR $dst_dir"
    else
      cp -a "$src_dir" "$dst_dir"
      echo "[CREATE] $dst_dir"
    fi
    return 0
  fi

  local src_h dst_h
  src_h="$(dir_hash "$src_dir" || echo "")"
  dst_h="$(dir_hash "$dst_dir" || echo "")"
  if [[ -n "$src_h" && -n "$dst_h" && "$src_h" == "$dst_h" ]]; then
    echo "[SKIP]   $dst_dir (up-to-date)"
    return 0
  fi

  if $DRY_RUN && ! $FORCE; then
    echo "[DRY-RUN] WOULD-UPDATE-DIR $dst_dir (differs; re-run with --force to overwrite)"
    return 0
  fi

  if ! confirm_overwrite "$dst_dir"; then
    echo "[SKIP]   $dst_dir (differs; re-run with --force to overwrite)"
    return 0
  fi

  if $DRY_RUN; then
    echo "[DRY-RUN] UPDATE-DIR $dst_dir"
  else
    rm -rf "$dst_dir"
    cp -a "$src_dir" "$dst_dir"
    echo "[UPDATE] $dst_dir"
  fi
}

mkdir_if_needed "$COPILOT_HOME"

if $DO_CLI; then
  # .github/agents/*.agent.md -> <copilotHome>/agents/ (flatten)
  mkdir_if_needed "$COPILOT_HOME/agents"
  shopt -s nullglob
  for src in "$SRC_AGENTS_ROOT/"*.agent.md; do
    sync_file "$src" "$COPILOT_HOME/agents/$(basename "$src")"
  done

  # .github/skills/<skill>/** -> <copilotHome>/skills/<skill>/**
  mkdir_if_needed "$COPILOT_HOME/skills"
  for src_dir in "$SRC_SKILLS_ROOT"/*; do
    [[ -d "$src_dir" ]] || continue
    skill_name="$(basename "$src_dir")"
    sync_dir "$src_dir" "$COPILOT_HOME/skills/$skill_name"
  done

  # .cli/instructions/copilot-instructions.md -> <copilotHome>/copilot-instructions.md
  sync_file "$SRC_INSTRUCTIONS" "$COPILOT_HOME/copilot-instructions.md"
fi

if $DO_VSCODE; then
  # Prompt files (VS Code-only): install under ~/.copilot/prompts and point VS Code at that folder.
  if [[ -d "$SRC_PROMPTS_ROOT" ]]; then
    mkdir_if_needed "$COPILOT_HOME/prompts"
    shopt -s nullglob
    for src in "$SRC_PROMPTS_ROOT/"*.prompt.md; do
      sync_file "$src" "$COPILOT_HOME/prompts/$(basename "$src")"
    done
  else
    echo "[WARN] No prompt sources found at $SRC_PROMPTS_ROOT (skipping prompt install)"
  fi

  if ! command -v node >/dev/null 2>&1; then
    echo "VS Code setup requires Node.js on PATH (node). Install Node.js, or rerun with --cli to skip VS Code setup." >&2
    exit 1
  fi

  PATCHER="$ENGINE_ROOT/scripts/vscode-settings-patch.mjs"
  if [[ ! -f "$PATCHER" ]]; then
    echo "Missing settings patcher script: $PATCHER" >&2
    exit 1
  fi

  NODE_ARGS=("$PATCHER" --copilot-home "$COPILOT_HOME")
  if $DRY_RUN; then NODE_ARGS+=(--dry-run); fi
  if [[ -n "$VSCODE_SETTINGS" ]]; then NODE_ARGS+=(--settings "$VSCODE_SETTINGS"); fi

  echo "Patching VS Code settings via node: $PATCHER"
  node "${NODE_ARGS[@]}"
fi

echo "Done."
