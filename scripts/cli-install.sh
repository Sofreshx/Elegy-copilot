#!/usr/bin/env bash
set -euo pipefail

DRY_RUN=false
FORCE=false
POINTER_MODE=true
OVERWRITE_MODE=""
INSTALL_PROFILE="minimal"

DO_CLI=false
DO_VSCODE=false
VSCODE_HOME=""

SKIP_NEXT_ARG=false
for arg in "$@"; do
  if $SKIP_NEXT_ARG; then
    SKIP_NEXT_ARG=false
    continue
  fi

  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --force) FORCE=true ;;
    --cli) DO_CLI=true ;;
    --vscode) DO_VSCODE=true ;;
    --all) DO_CLI=true; DO_VSCODE=true ;;
    --pointer) POINTER_MODE=true ;;
    --profile=*) INSTALL_PROFILE="${arg#--profile=}" ;;
    --profile|--vscode-home) SKIP_NEXT_ARG=true ;;
    --minimal|--public) INSTALL_PROFILE="minimal" ;;
    --full|--internal) INSTALL_PROFILE="full" ;;
    --vscode-home=*) VSCODE_HOME="${arg#--vscode-home=}" ;;
    *) echo "Unknown arg: $arg (supported: --dry-run, --force, --cli, --vscode, --all, --pointer, --profile=<minimal|full>, --minimal, --full, --public, --internal, --vscode-home=<path>)" >&2; exit 2 ;;
  esac
done

# Handle the space-separated forms: --profile <name>, --vscode-home <path>
for ((i=1; i<=$#; i++)); do
  if [[ "${!i}" == "--profile" ]]; then
    next=$((i+1))
    if [[ $next -le $# ]]; then
      INSTALL_PROFILE="${!next}"
    else
      echo "Missing value for --profile" >&2
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

normalize_install_profile() {
  case "${1,,}" in
    minimal|public) echo "minimal" ;;
    full|internal) echo "full" ;;
    *)
      echo "Unsupported install profile: $1 (supported: minimal, full, public, internal)" >&2
      exit 2
      ;;
  esac
}

INSTALL_PROFILE="$(normalize_install_profile "$INSTALL_PROFILE")"

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
LEGACY_MANAGED_SKILLS=(
  deployment-compose
  debug
  design
  feature-creator
  planning-refactor
  playwright-mcp
  quality-auditor
  semantic-kernel-agents
  system-drift
  system-editor
  system-health
  terraform
  tech-debt
)
LEGACY_MANAGED_AGENTS=(
  context-curator.agent.md
  elegy-orchestrator.agent.md
  executive.agent.md
  executive2.agent.md
  executive2-fast.agent.md
  executive2-planner.agent.md
  executive2p5.agent.md
  executive2p5-planner.agent.md
)
LEGACY_MANAGED_PROMPTS=()

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

array_contains() {
  local target="$1"
  shift || true
  local item
  for item in "$@"; do
    if [[ "$item" == "$target" ]]; then
      return 0
    fi
  done
  return 1
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
echo "Profile:      $INSTALL_PROFILE"

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

  if [[ -z "$OVERWRITE_MODE" ]]; then
    read -r -p "Overwrite mode for this run? [a]ll / [e]ach / [n]one (default: each): " mode_resp
    case "${mode_resp,,}" in
      a|all) OVERWRITE_MODE="all" ;;
      n|none) OVERWRITE_MODE="none" ;;
      ""|e|each) OVERWRITE_MODE="each" ;;
      *) OVERWRITE_MODE="each" ;;
    esac
  fi

  case "$OVERWRITE_MODE" in
    all) return 0 ;;
    none) return 1 ;;
  esac

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

install_state_path() {
  local root="$1"
  echo "$root/.instruction-engine-install-state.json"
}

remove_skill_artifact() {
  local artifact_path="$1"
  if [[ ! -e "$artifact_path" ]]; then
    return 0
  fi

  if $DRY_RUN; then
    echo "[DRY-RUN] PRUNE $artifact_path"
  else
    rm -rf "$artifact_path"
    echo "[PRUNE]  $artifact_path"
  fi
}

write_install_state() {
  local root="$1"
  local prompt_mode="${2:-replace}"
  if ! command -v node >/dev/null 2>&1; then
    return 0
  fi

  local state_file
  state_file="$(install_state_path "$root")"
  local managed_json always_json vault_json agent_json prompt_json
  managed_json="$(node -e "console.log(JSON.stringify(process.argv.slice(1).filter(Boolean).sort()))" "${CURRENT_MANAGED_SKILLS[@]}")"
  always_json="$(node -e "console.log(JSON.stringify(process.argv.slice(1).filter(Boolean).sort()))" "${CURRENT_ALWAYS_SKILLS[@]}")"
  vault_json="$(node -e "console.log(JSON.stringify(process.argv.slice(1).filter(Boolean).sort()))" "${CURRENT_VAULT_SKILLS[@]}")"
  agent_json="$(node -e "console.log(JSON.stringify(process.argv.slice(1).filter(Boolean).sort()))" "${CURRENT_MANAGED_AGENTS[@]}")"
  if [[ "$prompt_mode" == "preserve" && -f "$state_file" ]]; then
    prompt_json="$(node -e "try { const state = JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')); console.log(JSON.stringify((state.managedPrompts || []).map(String).filter(Boolean).sort())); } catch { console.log('[]'); }" "$state_file")"
  else
    prompt_json="$(node -e "console.log(JSON.stringify(process.argv.slice(1).filter(Boolean).sort()))" "${CURRENT_MANAGED_PROMPTS[@]}")"
  fi

  if $DRY_RUN; then
    echo "[DRY-RUN] WRITE-STATE $state_file"
    return 0
  fi

  mkdir_if_needed "$(dirname "$state_file")"
  printf '{\n  "schemaVersion": 3,\n  "installProfile": "%s",\n  "managedSkills": %s,\n  "alwaysLoadedSkills": %s,\n  "vaultSkills": %s,\n  "managedAgents": %s,\n  "managedPrompts": %s\n}\n' "$INSTALL_PROFILE" "$managed_json" "$always_json" "$vault_json" "$agent_json" "$prompt_json" > "$state_file"
  echo "[STATE]  $state_file"
}

prune_managed_file_install() {
  local root="$1"
  local relative_dir="$2"
  local state_property="$3"
  shift 3

  local state_file
  state_file="$(install_state_path "$root")"
  local -a current_items=("$@")
  local -a previous_items=()

  if command -v node >/dev/null 2>&1 && [[ -f "$state_file" ]]; then
    while IFS= read -r line; do
      [[ -n "$line" ]] && previous_items+=("$line")
    done < <(node -e "try { const state = JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')); for (const item of (state[process.argv[2]] || [])) console.log(String(item)); } catch {}" "$state_file" "$state_property")
  fi

  case "$state_property" in
    managedAgents) previous_items+=("${LEGACY_MANAGED_AGENTS[@]}") ;;
    managedPrompts) previous_items+=("${LEGACY_MANAGED_PROMPTS[@]}") ;;
  esac

  local -a prune_candidates=()
  prune_candidates+=("${current_items[@]}")
  prune_candidates+=("${previous_items[@]}")

  local -a unique_candidates=()
  while IFS= read -r line; do
    [[ -n "$line" ]] && unique_candidates+=("$line")
  done < <(printf '%s\n' "${prune_candidates[@]}" | awk 'NF && !seen[$0]++')

  local target_root="$root/$relative_dir"
  local file_name
  for file_name in "${unique_candidates[@]}"; do
    if array_contains "$file_name" "${current_items[@]}"; then
      continue
    fi

    remove_skill_artifact "$target_root/$file_name"
  done
}

prune_managed_skill_install() {
  local root="$1"
  local state_file
  state_file="$(install_state_path "$root")"

  local -a previous_managed=()
  local -a previous_vault=()
  if command -v node >/dev/null 2>&1 && [[ -f "$state_file" ]]; then
    while IFS= read -r line; do
      [[ -n "$line" ]] && previous_managed+=("$line")
    done < <(node -e "try { const state = JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')); for (const item of (state.managedSkills || [])) console.log(String(item)); } catch {}" "$state_file")

    while IFS= read -r line; do
      [[ -n "$line" ]] && previous_vault+=("$line")
    done < <(node -e "try { const state = JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')); const skills = Array.isArray(state.vaultSkills) ? state.vaultSkills : (state.managedSkills || []); for (const item of skills) console.log(String(item)); } catch {}" "$state_file")
  fi

  local -a prune_candidates=()
  prune_candidates+=("${CURRENT_MANAGED_SKILLS[@]}")
  prune_candidates+=("${CURRENT_VAULT_SKILLS[@]}")
  prune_candidates+=("${LEGACY_MANAGED_SKILLS[@]}")
  prune_candidates+=("${previous_managed[@]}")
  prune_candidates+=("${previous_vault[@]}")

  local -a unique_candidates=()
  while IFS= read -r line; do
    [[ -n "$line" ]] && unique_candidates+=("$line")
  done < <(printf '%s\n' "${prune_candidates[@]}" | awk 'NF && !seen[$0]++')

  for skill_name in "${unique_candidates[@]}"; do
    if array_contains "$skill_name" "${CURRENT_ALWAYS_SKILLS[@]}"; then
      continue
    fi

    remove_skill_artifact "$root/skills/$skill_name"
    remove_skill_artifact "$root/skills/$skill_name.md"
  done

  for skill_name in "${unique_candidates[@]}"; do
    if array_contains "$skill_name" "${CURRENT_VAULT_SKILLS[@]}"; then
      continue
    fi

    remove_skill_artifact "$root/skills-vault/$skill_name"
    remove_skill_artifact "$root/skills-vault/$skill_name.md"
  done
}

if $DO_CLI; then
  mkdir_if_needed "$COPILOT_HOME"
fi

if $DO_VSCODE; then
  mkdir_if_needed "$VSCODE_HOME_RESOLVED"
fi

# Load manifest to determine loadMode for skills in pointer mode.
# Skills with loadMode "always" go to skills/; vault materialization is profile-dependent.
MANIFEST_FILE="$SRC_ASSETS_ROOT/manifest.json"
SKILL_LOAD_MODE_CACHE=""
SKILL_MANIFEST_WARNING_EMITTED=0

cleanup_skill_load_mode_cache() {
  if [[ -n "$SKILL_LOAD_MODE_CACHE" && -f "$SKILL_LOAD_MODE_CACHE" ]]; then
    rm -f "$SKILL_LOAD_MODE_CACHE" >/dev/null 2>&1 || true
  fi
}

trap cleanup_skill_load_mode_cache EXIT

warn_skill_manifest_fallback_once() {
  local reason="$1"
  if [[ "$SKILL_MANIFEST_WARNING_EMITTED" -eq 1 ]]; then
    return 0
  fi

  echo "Warning: unable to resolve skill load modes from $MANIFEST_FILE ($reason). Defaulting all skills to on-demand." >&2
  SKILL_MANIFEST_WARNING_EMITTED=1
}

build_skill_load_mode_cache() {
  if [[ -n "$SKILL_LOAD_MODE_CACHE" && -f "$SKILL_LOAD_MODE_CACHE" ]]; then
    return 0
  fi

  if [[ ! -f "$MANIFEST_FILE" ]]; then
    warn_skill_manifest_fallback_once "manifest not found"
    return 0
  fi

  local parser=""
  if command -v node >/dev/null 2>&1; then
    parser="node"
  elif command -v python3 >/dev/null 2>&1; then
    parser="python3"
  elif command -v python >/dev/null 2>&1; then
    parser="python"
  else
    warn_skill_manifest_fallback_once "no supported parser found (tried: node, python3, python)"
    return 0
  fi

  local tmp
  tmp="$(mktemp 2>/dev/null || echo "")"
  if [[ -z "$tmp" ]]; then
    warn_skill_manifest_fallback_once "could not create temporary cache file"
    return 0
  fi

  if [[ "$parser" == "node" ]]; then
    if ! node - "$MANIFEST_FILE" >"$tmp" <<'EOF'
const fs = require('fs');
const path = require('path');

const manifestPath = process.argv[2];
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
for (const asset of (manifest.assets || [])) {
  if (asset.type !== 'skill' || !asset.source) continue;
  console.log(`${path.posix.basename(String(asset.source))}\t${asset.loadMode || 'on-demand'}`);
}
EOF
    then
      rm -f "$tmp" >/dev/null 2>&1 || true
      warn_skill_manifest_fallback_once "manifest parsing failed via node"
      return 0
    fi
  else
    if ! "$parser" - "$MANIFEST_FILE" >"$tmp" <<'EOF'
import json
import os
import sys

manifest_path = sys.argv[1]
with open(manifest_path, "r", encoding="utf-8") as handle:
    manifest = json.load(handle)

for asset in manifest.get("assets", []):
    if asset.get("type") != "skill" or not asset.get("source"):
        continue
    print(f"{os.path.basename(str(asset['source']))}\t{asset.get('loadMode', 'on-demand')}")
EOF
    then
      rm -f "$tmp" >/dev/null 2>&1 || true
      warn_skill_manifest_fallback_once "manifest parsing failed via $parser"
      return 0
    fi
  fi

  SKILL_LOAD_MODE_CACHE="$tmp"
}

get_skill_load_mode() {
  local skill_name="$1"
  build_skill_load_mode_cache

  if [[ -n "$SKILL_LOAD_MODE_CACHE" && -f "$SKILL_LOAD_MODE_CACHE" ]]; then
    local mode
    mode="$(awk -F '	' -v target="$skill_name" '$1 == target { print $2; exit }' "$SKILL_LOAD_MODE_CACHE")"
    if [[ -n "$mode" ]]; then
      echo "$mode"
      return 0
    fi
  fi

  echo "on-demand"
}

CURRENT_MANAGED_SKILLS=()
for src_dir in "$SRC_SKILLS_ROOT"/*; do
  [[ -d "$src_dir" ]] || continue
  CURRENT_MANAGED_SKILLS+=("$(basename "$src_dir")")
done

CURRENT_MANAGED_AGENTS=()
CURRENT_MANAGED_PROMPTS=()
shopt -s nullglob
for src in "$SRC_AGENTS_ROOT/"*.agent.md; do
  CURRENT_MANAGED_AGENTS+=("$(basename "$src")")
done
for src in "$SRC_PROMPTS_ROOT/"*.prompt.md; do
  CURRENT_MANAGED_PROMPTS+=("$(basename "$src")")
done

CURRENT_ALWAYS_SKILLS=()
CURRENT_ON_DEMAND_SKILLS=()
for skill_name in "${CURRENT_MANAGED_SKILLS[@]}"; do
  load_mode="$(get_skill_load_mode "$skill_name")"
  if [[ "$load_mode" == "always" ]]; then
    CURRENT_ALWAYS_SKILLS+=("$skill_name")
  else
    CURRENT_ON_DEMAND_SKILLS+=("$skill_name")
  fi
done

CURRENT_VAULT_SKILLS=()
case "$INSTALL_PROFILE" in
  full) CURRENT_VAULT_SKILLS=("${CURRENT_MANAGED_SKILLS[@]}") ;;
  minimal) CURRENT_VAULT_SKILLS=("${CURRENT_ALWAYS_SKILLS[@]}") ;;
esac

echo "Skills:       managed=${#CURRENT_MANAGED_SKILLS[@]} always=${#CURRENT_ALWAYS_SKILLS[@]} on-demand=${#CURRENT_ON_DEMAND_SKILLS[@]} vault=${#CURRENT_VAULT_SKILLS[@]} pointer=$POINTER_MODE"

if $DO_CLI; then
  # engine-assets/agents/*.agent.md -> <copilotHome>/agents/ (flatten)
  mkdir_if_needed "$COPILOT_HOME/agents"
  shopt -s nullglob
  for src in "$SRC_AGENTS_ROOT/"*.agent.md; do
    sync_file "$src" "$COPILOT_HOME/agents/$(basename "$src")"
  done
  prune_managed_file_install "$COPILOT_HOME" "agents" "managedAgents" "${CURRENT_MANAGED_AGENTS[@]}"

  # engine-assets/skills/<skill>/** -> <copilotHome>/skills/<skill>/**
  mkdir_if_needed "$COPILOT_HOME/skills"
  echo "CLI skills:   installing managed=${#CURRENT_MANAGED_SKILLS[@]} always=${#CURRENT_ALWAYS_SKILLS[@]} on-demand=${#CURRENT_ON_DEMAND_SKILLS[@]} vault=${#CURRENT_VAULT_SKILLS[@]}"
  if $POINTER_MODE; then
    mkdir_if_needed "$COPILOT_HOME/skills-vault"
    for src_dir in "$SRC_SKILLS_ROOT"/*; do
      [[ -d "$src_dir" ]] || continue
      skill_name="$(basename "$src_dir")"
      load_mode="$(get_skill_load_mode "$skill_name")"
      if [[ "$load_mode" == "always" ]]; then
        # Always-loaded: install full skill to skills/ (scanned by VS Code)
        sync_dir "$src_dir" "$COPILOT_HOME/skills/$skill_name"
      fi

      if array_contains "$skill_name" "${CURRENT_VAULT_SKILLS[@]}"; then
        # Vault installs are profile-dependent. Full installs all managed skills;
        # minimal installs the always-loaded subset only.
        sync_dir "$src_dir" "$COPILOT_HOME/skills-vault/$skill_name"
      fi
    done

    prune_managed_skill_install "$COPILOT_HOME"
  else
    for src_dir in "$SRC_SKILLS_ROOT"/*; do
      [[ -d "$src_dir" ]] || continue
      skill_name="$(basename "$src_dir")"
      sync_dir "$src_dir" "$COPILOT_HOME/skills/$skill_name"
    done
  fi

  write_install_state "$COPILOT_HOME" "preserve"

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
  prune_managed_file_install "$VSCODE_HOME_RESOLVED" "agents" "managedAgents" "${CURRENT_MANAGED_AGENTS[@]}"

  mkdir_if_needed "$VSCODE_HOME_RESOLVED/skills"
  echo "VS Code skills: installing managed=${#CURRENT_MANAGED_SKILLS[@]} always=${#CURRENT_ALWAYS_SKILLS[@]} on-demand=${#CURRENT_ON_DEMAND_SKILLS[@]} vault=${#CURRENT_VAULT_SKILLS[@]}"
  if $POINTER_MODE; then
    mkdir_if_needed "$VSCODE_HOME_RESOLVED/skills-vault"
    for src_dir in "$SRC_SKILLS_ROOT"/*; do
      [[ -d "$src_dir" ]] || continue
      skill_name="$(basename "$src_dir")"
      load_mode="$(get_skill_load_mode "$skill_name")"
      if [[ "$load_mode" == "always" ]]; then
        # Always-loaded: install full skill to skills/ (scanned by VS Code)
        sync_dir "$src_dir" "$VSCODE_HOME_RESOLVED/skills/$skill_name"
      fi

      if array_contains "$skill_name" "${CURRENT_VAULT_SKILLS[@]}"; then
        # Vault installs are profile-dependent. Full installs all managed skills;
        # minimal installs the always-loaded subset only.
        sync_dir "$src_dir" "$VSCODE_HOME_RESOLVED/skills-vault/$skill_name"
      fi
    done

    prune_managed_skill_install "$VSCODE_HOME_RESOLVED"
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
  prune_managed_file_install "$VSCODE_HOME_RESOLVED" "prompts" "managedPrompts" "${CURRENT_MANAGED_PROMPTS[@]}"

  write_install_state "$VSCODE_HOME_RESOLVED" "replace"

  sync_file "$SRC_VSCODE_INSTRUCTIONS" "$VSCODE_HOME_RESOLVED/copilot-instructions.md"

fi

echo "Done."
