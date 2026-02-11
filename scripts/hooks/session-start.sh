#!/bin/bash
set -e

python - <<'PY'
import json
import os
import subprocess
import sys

raw = sys.stdin.read()
if not raw.strip():
    sys.exit(0)

data = json.loads(raw)
cwd = data.get("cwd") or os.getcwd()
log_dir = os.path.join(cwd, ".instructions-output", "hooks")
os.makedirs(log_dir, exist_ok=True)

entry = {
    "event": "sessionStart",
    "timestamp": data.get("timestamp"),
    "source": data.get("source"),
    "cwd": cwd,
    "initialPrompt": data.get("initialPrompt"),
}
with open(os.path.join(log_dir, "session.jsonl"), "a", encoding="utf-8") as f:
    json.dump(entry, f, separators=(",", ":"))
    f.write("\n")

if os.environ.get("HOOK_START_INFRA") == "1":
    local_script = os.path.join(cwd, "scripts", "hooks", "session-start.local.sh")
    if os.path.isfile(local_script):
        result = subprocess.run(["bash", local_script], cwd=cwd)
        entry = {
            "event": "sessionStartLocal",
            "status": "success" if result.returncode == 0 else "error",
            "exitCode": result.returncode,
        }
        with open(os.path.join(log_dir, "session.jsonl"), "a", encoding="utf-8") as f:
            json.dump(entry, f, separators=(",", ":"))
            f.write("\n")
PY
