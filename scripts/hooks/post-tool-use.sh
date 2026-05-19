#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec 3<&0
trap 'exec 3<&-' EXIT
source "$SCRIPT_DIR/_python-hook.sh"

run_python_hook "$SCRIPT_DIR" <<'PY'
import json
import os
import re
import sys

raw = sys.stdin.read()
if not raw.strip():
    sys.exit(0)

data = json.loads(raw)
cwd = data.get("cwd") or os.getcwd()
log_dir = os.path.join(cwd, ".instructions-output", "hooks")
os.makedirs(log_dir, exist_ok=True)

SCHEMA_VERSION = "1.0.0"
SENSITIVE_PATTERNS = [
    re.compile(r"(?is)-----BEGIN [A-Z ]*PRIVATE KEY-----.*?-----END [A-Z ]*PRIVATE KEY-----"),
    re.compile(r"(?i)\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|passwd)\b\s*[:=]\s*\S+"),
    re.compile(r"(?i)\bauthorization\b\s*:\s*(?:bearer|basic)\s+\S+"),
    re.compile(r"(?i)\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b"),
    re.compile(r"(?i)\bsk-[A-Za-z0-9]{20,}\b"),
]


def opt_out_enabled() -> bool:
    value = os.environ.get("HOOK_TELEMETRY_OPTOUT", "")
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def is_sensitive(value) -> bool:
    if value is None:
        return False
    text = str(value)
    for pattern in SENSITIVE_PATTERNS:
        if pattern.search(text):
            return True
    return False


def allowlist(entry, allowed_keys):
    return {key: entry[key] for key in allowed_keys if key in entry and entry[key] is not None}


tool_result = data.get("toolResult") or {}
opt_out = opt_out_enabled()
tool_name = data.get("toolName")
result_type = tool_result.get("resultType")

entry = {
    "event": "postToolUse",
    "timestamp": data.get("timestamp"),
    "schemaVersion": SCHEMA_VERSION,
    "optOut": opt_out,
}

if tool_name is not None and not is_sensitive(tool_name):
    entry["toolName"] = tool_name
if not opt_out and result_type is not None and not is_sensitive(result_type):
    entry["resultType"] = result_type

entry = allowlist(entry, ["event", "timestamp", "schemaVersion", "optOut", "toolName", "resultType"])

with open(os.path.join(log_dir, "post-tool-use.jsonl"), "a", encoding="utf-8") as f:
    json.dump(entry, f, separators=(",", ":"))
    f.write("\n")
PY
