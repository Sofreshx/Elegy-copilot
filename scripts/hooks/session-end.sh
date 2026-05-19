#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec 3<&0
trap 'exec 3<&-' EXIT
source "$SCRIPT_DIR/_python-hook.sh"

run_python_hook "$SCRIPT_DIR" <<'PY'
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
    "event": "sessionEnd",
    "timestamp": data.get("timestamp"),
    "reason": data.get("reason"),
    "cwd": cwd,
}
with open(os.path.join(log_dir, "session.jsonl"), "a", encoding="utf-8") as f:
    json.dump(entry, f, separators=(",", ":"))
    f.write("\n")

if os.environ.get("HOOK_STOP_INFRA") == "1":
    local_script = os.path.join(cwd, "scripts", "hooks", "session-end.local.sh")
    if os.path.isfile(local_script):
        result = subprocess.run(["bash", local_script], cwd=cwd)
        entry = {
            "event": "sessionEndLocal",
            "status": "success" if result.returncode == 0 else "error",
            "exitCode": result.returncode,
        }
        with open(os.path.join(log_dir, "session.jsonl"), "a", encoding="utf-8") as f:
            json.dump(entry, f, separators=(",", ":"))
            f.write("\n")
PY
