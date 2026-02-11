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

entry = {
    "event": "userPromptSubmitted",
    "timestamp": data.get("timestamp"),
    "prompt": data.get("prompt"),
}
with open(os.path.join(log_dir, "prompts.jsonl"), "a", encoding="utf-8") as f:
    json.dump(entry, f, separators=(",", ":"))
    f.write("\n")
PY
