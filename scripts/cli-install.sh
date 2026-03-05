#!/usr/bin/env bash
set -euo pipefail

DRY_RUN=false
FORCE=false
POINTER_MODE=true

DO_CLI=false
DO_VSCODE=false
VSCODE_SETTINGS=""
VSCODE_HOME=""

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --force) FORCE=true ;;
    --cli) DO_CLI=true ;;
    --vscode) DO_VSCODE=true ;;
    --all) DO_CLI=true; DO_VSCODE=true ;;
    --pointer) POINTER_MODE=true ;;
    --vscode-settings=*) VSCODE_SETTINGS="${arg#--vscode-settings=}" ;;
    --vscode-home=*) VSCODE_HOME="${arg#--vscode-home=}" ;;
    *) echo "Unknown arg: $arg (supported: --dry-run, --force, --cli, --vscode, --all, --pointer, --vscode-settings=<path>, --vscode-home=<path>)" >&2; exit 2 ;;
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

  if [[ "${!i}" == "--vscode-home" ]]; then
    next=$((i+1))
    if [[ $next -le $# ]]; then
      VSCODE_HOME="${!next}"
    else
      echo "Missing value for --vscode-home" >&2
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
SRC_ASSETS_ROOT="$ENGINE_ROOT/engine-assets"
SRC_AGENTS_ROOT="$SRC_ASSETS_ROOT/agents"
SRC_SKILLS_ROOT="$SRC_ASSETS_ROOT/skills"
SRC_PROMPTS_ROOT="$SRC_ASSETS_ROOT/prompts"
SRC_INSTRUCTIONS="$SRC_ASSETS_ROOT/copilot-instructions.md"
SRC_VSCODE_INSTRUCTIONS="$ENGINE_ROOT/.github/copilot-instructions.md"

default_vscode_home() {
  echo "$HOME/.copilot"
}

resolve_vscode_home() {
  if [[ -n "$VSCODE_HOME" ]]; then
    echo "$VSCODE_HOME"
    return 0
  fi
  if [[ -n "${INSTRUCTION_ENGINE_VSCODE_HOME:-}" ]]; then
    echo "$INSTRUCTION_ENGINE_VSCODE_HOME"
    return 0
  fi
  echo "$(default_vscode_home)"
}

if $DO_CLI; then
  [[ -d "$SRC_AGENTS_ROOT" ]] || { echo "Missing agents source: $SRC_AGENTS_ROOT" >&2; exit 1; }
  [[ -d "$SRC_SKILLS_ROOT" ]] || { echo "Missing skills source: $SRC_SKILLS_ROOT" >&2; exit 1; }
  [[ -f "$SRC_INSTRUCTIONS" ]] || { echo "Missing instructions source: $SRC_INSTRUCTIONS" >&2; exit 1; }
fi

if $DO_VSCODE; then
  [[ -d "$SRC_AGENTS_ROOT" ]] || { echo "Missing agents source: $SRC_AGENTS_ROOT" >&2; exit 1; }
  [[ -d "$SRC_SKILLS_ROOT" ]] || { echo "Missing skills source: $SRC_SKILLS_ROOT" >&2; exit 1; }
  [[ -d "$SRC_PROMPTS_ROOT" ]] || { echo "Missing prompts source: $SRC_PROMPTS_ROOT" >&2; exit 1; }
  [[ -f "$SRC_VSCODE_INSTRUCTIONS" ]] || { echo "Missing VS Code instructions source: $SRC_VSCODE_INSTRUCTIONS" >&2; exit 1; }
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

VSCODE_HOME_RESOLVED="$(resolve_vscode_home)"
echo "VS Code home: $VSCODE_HOME_RESOLVED"

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

if $DO_CLI; then
  mkdir_if_needed "$COPILOT_HOME"
fi

if $DO_VSCODE; then
  mkdir_if_needed "$VSCODE_HOME_RESOLVED"
fi

# Load manifest to determine loadMode for skills in pointer mode.
# Skills with loadMode "always" go to skills/ (full); others go vault-only.
MANIFEST_FILE="$SRC_ASSETS_ROOT/manifest.json"
get_skill_load_mode() {
  local skill_name="$1"
  if [[ ! -f "$MANIFEST_FILE" ]]; then
    echo "on-demand"
    return 0
  fi
  # Extract loadMode for the matching skill asset from manifest
  local mode
  mode="$(node -e "
    const m = JSON.parse(require('fs').readFileSync('$MANIFEST_FILE','utf8'));
    const a = (m.assets||[]).find(a => a.type==='skill' && a.source.endsWith('/$skill_name'));
    console.log((a && a.loadMode) || 'on-demand');
  " 2>/dev/null || echo "on-demand")"
  echo "$mode"
}

if $DO_CLI; then
  # engine-assets/agents/*.agent.md -> <copilotHome>/agents/ (flatten)
  mkdir_if_needed "$COPILOT_HOME/agents"
  shopt -s nullglob
  for src in "$SRC_AGENTS_ROOT/"*.agent.md; do
    sync_file "$src" "$COPILOT_HOME/agents/$(basename "$src")"
  done

  # engine-assets/skills/<skill>/** -> <copilotHome>/skills/<skill>/**
  mkdir_if_needed "$COPILOT_HOME/skills"
  if $POINTER_MODE; then
    mkdir_if_needed "$COPILOT_HOME/skills-vault"
    for src_dir in "$SRC_SKILLS_ROOT"/*; do
      [[ -d "$src_dir" ]] || continue
      skill_name="$(basename "$src_dir")"
      load_mode="$(get_skill_load_mode "$skill_name")"
      if [[ "$load_mode" == "always" ]]; then
        # Always-loaded: install full skill to skills/ (scanned by VS Code)
        sync_dir "$src_dir" "$COPILOT_HOME/skills/$skill_name"
        # Also copy to vault for search index consistency
        sync_dir "$src_dir" "$COPILOT_HOME/skills-vault/$skill_name"
      else
        # On-demand: vault only — NOT in skills/ scan path
        sync_dir "$src_dir" "$COPILOT_HOME/skills-vault/$skill_name"
      fi
    done
  else
    for src_dir in "$SRC_SKILLS_ROOT"/*; do
      [[ -d "$src_dir" ]] || continue
      skill_name="$(basename "$src_dir")"
      sync_dir "$src_dir" "$COPILOT_HOME/skills/$skill_name"
    done
  fi

  # engine-assets/copilot-instructions.md -> <copilotHome>/copilot-instructions.md
  sync_file "$SRC_INSTRUCTIONS" "$COPILOT_HOME/copilot-instructions.md"
fi

if $DO_VSCODE; then
  # Install VS Code discoverable assets into the VS Code user asset home (NOT ~/.copilot).
  mkdir_if_needed "$VSCODE_HOME_RESOLVED/agents"
  shopt -s nullglob
  for src in "$SRC_AGENTS_ROOT/"*.agent.md; do
    sync_file "$src" "$VSCODE_HOME_RESOLVED/agents/$(basename "$src")"
  done

  mkdir_if_needed "$VSCODE_HOME_RESOLVED/skills"
  if $POINTER_MODE; then
    mkdir_if_needed "$VSCODE_HOME_RESOLVED/skills-vault"
    for src_dir in "$SRC_SKILLS_ROOT"/*; do
      [[ -d "$src_dir" ]] || continue
      skill_name="$(basename "$src_dir")"
      load_mode="$(get_skill_load_mode "$skill_name")"
      if [[ "$load_mode" == "always" ]]; then
        # Always-loaded: install full skill to skills/ (scanned by VS Code)
        sync_dir "$src_dir" "$VSCODE_HOME_RESOLVED/skills/$skill_name"
        # Also copy to vault for search index consistency
        sync_dir "$src_dir" "$VSCODE_HOME_RESOLVED/skills-vault/$skill_name"
      else
        # On-demand: vault only — NOT in skills/ scan path
        sync_dir "$src_dir" "$VSCODE_HOME_RESOLVED/skills-vault/$skill_name"
      fi
    done
  else
    for src_dir in "$SRC_SKILLS_ROOT"/*; do
      [[ -d "$src_dir" ]] || continue
      skill_name="$(basename "$src_dir")"
      sync_dir "$src_dir" "$VSCODE_HOME_RESOLVED/skills/$skill_name"
    done
  fi

  mkdir_if_needed "$VSCODE_HOME_RESOLVED/prompts"
  for src in "$SRC_PROMPTS_ROOT/"*.prompt.md; do
    sync_file "$src" "$VSCODE_HOME_RESOLVED/prompts/$(basename "$src")"
  done

  sync_file "$SRC_VSCODE_INSTRUCTIONS" "$VSCODE_HOME_RESOLVED/copilot-instructions.md"

  if ! command -v node >/dev/null 2>&1; then
    echo "VS Code setup requires Node.js on PATH (node). Install Node.js, or rerun with --cli to skip VS Code setup." >&2
    exit 1
  fi

  PATCHER="$ENGINE_ROOT/scripts/vscode-settings-patch.mjs"
  if [[ ! -f "$PATCHER" ]]; then
    echo "Missing settings patcher script: $PATCHER" >&2
    exit 1
  fi

  NODE_ARGS=("$PATCHER" --vscode-home "$VSCODE_HOME_RESOLVED")
  if $DRY_RUN; then NODE_ARGS+=(--dry-run); fi
  if [[ -n "$VSCODE_SETTINGS" ]]; then NODE_ARGS+=(--settings "$VSCODE_SETTINGS"); fi

  echo "Patching VS Code settings via node: $PATCHER"
  node "${NODE_ARGS[@]}"
fi

echo "Done."
