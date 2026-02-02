#!/bin/bash
# Start agent session in Codespace
# This script is run automatically when the Codespace starts (postStartCommand)

set -e

echo "================================================"
echo "Starting Instruction Engine Agent Session"
echo "================================================"

# Check required environment variables
if [ -z "$SESSION_ID" ]; then
  echo "Warning: SESSION_ID not set - running in manual mode"
  exit 0
fi

echo "Session ID: $SESSION_ID"
echo "Agent: ${AGENT_NAME:-executive2-planner}"
echo "Relay URL: ${RELAY_WEBHOOK_URL:-not-set}"

# Report session started
if [ -n "$RELAY_WEBHOOK_URL" ]; then
  echo "Reporting session start to relay..."
  curl -X POST "$RELAY_WEBHOOK_URL" \
    -H "Content-Type: application/json" \
    -d "{
      \"session_id\": \"$SESSION_ID\",
      \"user_id\": \"${USER_ID:-unknown}\",
      \"status\": \"codespace_ready\",
      \"codespace_name\": \"$CODESPACE_NAME\",
      \"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"
    }" 2>/dev/null || echo "Warning: Could not report to relay"
fi

# Wait for VS Code and extensions to be ready
echo "Waiting for VS Code extensions to activate..."
sleep 10

# Check if Copilot is available
if command -v code &> /dev/null; then
  echo "VS Code CLI available"
  
  # Install instruction-engine extension if present locally
  if [ -d "/workspaces/instruction-engine/vscode-skill-installer" ]; then
    echo "Building and installing local extension..."
    cd /workspaces/instruction-engine/vscode-skill-installer
    npm run compile 2>/dev/null || true
  fi
fi

# If prompt is provided, execute agent session
if [ -n "$PROMPT" ]; then
  echo "================================================"
  echo "Agent Prompt:"
  echo "$PROMPT"
  echo "================================================"
  
  # In a full implementation, this would:
  # 1. Use VS Code extension API to invoke chat participant
  # 2. Execute: @${AGENT_NAME} ${PROMPT}
  # 3. Stream results back to relay
  #
  # For now, log the intent and report to relay
  
  echo "Agent session would execute: @${AGENT_NAME:-executive2-planner} <prompt>"
  
  # Report prompt received
  if [ -n "$RELAY_WEBHOOK_URL" ]; then
    curl -X POST "$RELAY_WEBHOOK_URL" \
      -H "Content-Type: application/json" \
      -d "{
        \"session_id\": \"$SESSION_ID\",
        \"user_id\": \"${USER_ID:-unknown}\",
        \"status\": \"executing\",
        \"agent\": \"${AGENT_NAME:-executive2-planner}\",
        \"prompt_length\": ${#PROMPT},
        \"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"
      }" 2>/dev/null || echo "Warning: Could not report to relay"
  fi
fi

echo "================================================"
echo "Codespace agent session ready"
echo "Auto-stop after 30 minutes of idle time"
echo "================================================"

# Keep session alive (Codespace will auto-stop on idle)
# In production, this would be replaced by extension event handling
