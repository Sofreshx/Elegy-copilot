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

error = data.get("error") or {}
entry = {
    "event": "errorOccurred",
    "timestamp": data.get("timestamp"),
    "name": error.get("name"),
    "message": error.get("message"),
}
with open(os.path.join(log_dir, "errors.jsonl"), "a", encoding="utf-8") as f:
    json.dump(entry, f, separators=(",", ":"))
    f.write("\n")
PY
