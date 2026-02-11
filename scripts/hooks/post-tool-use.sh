#!/bin/bash
set -e

python - <<'PY'
import json
import os
import sys

raw = sys.stdin.read()
if not raw.strip():
    sys.exit(0)

data = json.loads(raw)
cwd = data.get("cwd") or os.getcwd()
log_dir = os.path.join(cwd, ".instructions-output", "hooks")
os.makedirs(log_dir, exist_ok=True)

tool_result = data.get("toolResult") or {}
entry = {
    "event": "postToolUse",
    "timestamp": data.get("timestamp"),
    "toolName": data.get("toolName"),
    "resultType": tool_result.get("resultType"),
}
with open(os.path.join(log_dir, "post-tool-use.jsonl"), "a", encoding="utf-8") as f:
    json.dump(entry, f, separators=(",", ":"))
    f.write("\n")
PY
