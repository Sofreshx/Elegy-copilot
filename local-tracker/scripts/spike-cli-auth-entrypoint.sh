#!/usr/bin/env bash
set -euo pipefail

ACP_HOST="127.0.0.1"
ACP_PORT="${ACP_PORT:-3000}"

# Where Copilot CLI stores config + state by default (unless XDG_* overrides are set)
ELEGY_HOME="${ELEGY_HOME:-$HOME/.elegy}"

echo "[spike] copilot version: $(copilot --version 2>/dev/null || true)"
echo "[spike] ELEGY_HOME=$ELEGY_HOME"
echo "[spike] ACP=$ACP_HOST:$ACP_PORT"

mkdir -p "$ELEGY_HOME" "$ELEGY_HOME/logs" "$ELEGY_HOME/session-state"

# Seed custom agents/skills/instructions into ELEGY_HOME (best-effort; safe if already present)
ASSETS_ROOT="/opt/instruction-engine/engine-assets"
if [[ -d "$ASSETS_ROOT" ]]; then
  mkdir -p "$ELEGY_HOME/agents" "$ELEGY_HOME/skills" "$ELEGY_HOME/prompts"

  # Copy without overwriting if possible (cp -n is supported on GNU coreutils; fallback to overwrite in worst case)
  cp -Rn "$ASSETS_ROOT/agents/." "$ELEGY_HOME/agents/" 2>/dev/null || cp -R "$ASSETS_ROOT/agents/." "$ELEGY_HOME/agents/" || true
  if [[ "${SKILL_POINTER_MODE:-}" == "true" ]]; then
    mkdir -p "$ELEGY_HOME/skills-vault"
    cp -Rn "$ASSETS_ROOT/skills/." "$ELEGY_HOME/skills-vault/" 2>/dev/null || cp -R "$ASSETS_ROOT/skills/." "$ELEGY_HOME/skills-vault/" || true
    # Always-loaded skills go to skills/ (scanned by VS Code); on-demand stay vault-only
    ALWAYS_LOADED_SKILLS="core-guardrails skill-discovery implementation-friction stack-detector"
    for skill_dir in "$ELEGY_HOME/skills-vault"/*/; do
      [[ -d "$skill_dir" ]] || continue
      skill_name="$(basename "$skill_dir")"
      case " $ALWAYS_LOADED_SKILLS " in
        *" $skill_name "*)
          mkdir -p "$ELEGY_HOME/skills/$skill_name"
          cp -R "$skill_dir/." "$ELEGY_HOME/skills/$skill_name/" || true
          ;;
      esac
    done
  else
    cp -Rn "$ASSETS_ROOT/skills/." "$ELEGY_HOME/skills/" 2>/dev/null || cp -R "$ASSETS_ROOT/skills/." "$ELEGY_HOME/skills/" || true
  fi
  cp -Rn "$ASSETS_ROOT/prompts/." "$ELEGY_HOME/prompts/" 2>/dev/null || cp -R "$ASSETS_ROOT/prompts/." "$ELEGY_HOME/prompts/" || true
  cp -n "$ASSETS_ROOT/copilot-instructions.md" "$ELEGY_HOME/copilot-instructions.md" 2>/dev/null || true
fi

# Auth:
# - Preferred for containers: env token (COPILOT_GITHUB_TOKEN / GH_TOKEN / GITHUB_TOKEN)
# - Fallback: already-present stored credentials under ELEGY_HOME (device flow on host then bind-mount)
if [[ -n "${COPILOT_GITHUB_TOKEN:-}" ]]; then
  echo "[spike] auth: using COPILOT_GITHUB_TOKEN env"
elif [[ -n "${GH_TOKEN:-}" ]]; then
  echo "[spike] auth: using GH_TOKEN env"
elif [[ -n "${GITHUB_TOKEN:-}" ]]; then
  echo "[spike] auth: using GITHUB_TOKEN env"
else
  echo "[spike] auth: no token env detected; relying on stored credentials in ELEGY_HOME"
fi

# Start ACP server (runs until killed).
# Note: --allow-all-tools is required for non-interactive execution.
ACP_LOG="$ELEGY_HOME/logs/spike-acp-server.log"

set +e
copilot --acp --port "$ACP_PORT" --allow-all-tools >"$ACP_LOG" 2>&1 &
ACP_PID=$!
set -e

cleanup() {
  if kill -0 "$ACP_PID" 2>/dev/null; then
    kill "$ACP_PID" 2>/dev/null || true
    sleep 0.5
    kill -9 "$ACP_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# Wait for port to open
for i in $(seq 1 50); do
  if nc -z "$ACP_HOST" "$ACP_PORT" >/dev/null 2>&1; then
    echo "[spike] ACP port open"
    break
  fi
  sleep 0.2
  if ! kill -0 "$ACP_PID" 2>/dev/null; then
    echo "[spike] ACP server exited early; last 120 lines of log:" >&2
    tail -n 120 "$ACP_LOG" 2>/dev/null || true
    exit 2
  fi
  if [[ $i -eq 50 ]]; then
    echo "[spike] timeout waiting for ACP port; last 120 lines of log:" >&2
    tail -n 120 "$ACP_LOG" 2>/dev/null || true
    exit 3
  fi
done

# Invoke a single ACP session/prompt; this is the "agent invocation" proof.
node /opt/instruction-engine/spike-acp-invoke.mjs \
  --host "$ACP_HOST" \
  --port "$ACP_PORT" \
  --prompt "Reply with a single short sentence. Do not use any tools." \
  --timeout-ms 180000

# Snapshot what got written (for human verification). Do not print file contents.
echo "[spike] session-state directories:" 
ls -1 "$ELEGY_HOME/session-state" 2>/dev/null | tail -n 50 || true

echo "[spike] done"
