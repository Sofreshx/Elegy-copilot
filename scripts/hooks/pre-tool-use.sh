#!/bin/bash
set -e

python - <<'PY'
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

tool_name = data.get("toolName") or ""
raw_args = data.get("toolArgs") or ""
try:
    tool_args = json.loads(raw_args) if isinstance(raw_args, str) else raw_args
except Exception:
    tool_args = {}


def is_env_path(path: str) -> bool:
    base = os.path.basename(path or "")
    return base.startswith(".env")


def is_placeholder(value: str) -> bool:
    low = value.lower()
    return any(token in low for token in ["changeme", "example", "your", "placeholder", "xxxx", "todo", "sample"])


def contains_secret(content: str) -> bool:
    if not content:
        return False
    if "-----BEGIN" in content and "PRIVATE KEY" in content:
        return True
    for line in content.splitlines():
        match = re.search(r"(?i)\b(api_?key|secret|token|password|access_key|private_key)\b\s*[:=]\s*([^\s#]+)", line)
        if match:
            value = match.group(2).strip().strip('"').strip("'")
            if len(value) >= 8 and not is_placeholder(value):
                return True
    return False


def redact_command(value: str) -> str:
    if not value:
        return ""
    value = re.sub(r"(?i)(authorization:\s*bearer\s+)[^\s]+", r"\1***", value)
    value = re.sub(r"(?i)(token|secret|password|api_?key)\s*[:=]\s*[^\s]+", r"\1=***", value)
    return value


def summarize_tool_args() -> dict:
    if tool_name in {"edit", "create", "create_file", "edit_file"}:
        path = tool_args.get("path") or tool_args.get("filePath") or tool_args.get("file_path") or ""
        content = tool_args.get("content") or tool_args.get("newCode") or ""
        if isinstance(content, list):
            content = "\n".join(str(x) for x in content)
        return {"path": path, "contentLength": len(content)}
    if tool_name in {"bash", "shell", "terminal", "execute"}:
        command = tool_args.get("command") or ""
        args = tool_args.get("args")
        if not command and args:
            command = " ".join(str(x) for x in args) if isinstance(args, list) else str(args)
        return {"command": redact_command(command)}
    return {"keys": list(tool_args.keys())}


def is_prod_command(command: str) -> bool:
    if not command:
        return False
    low = command.lower()
    prod_markers = ["prod", "production", "live", "mainnet"]
    tools = ["ssh", "scp", "kubectl", "terraform", "supabase", "psql", "mysql", "az ", "aws ", "gcloud "]
    return any(m in low for m in prod_markers) and any(t in low for t in tools)


def is_write_command(command: str) -> bool:
    if not command:
        return False
    low = command.lower()
    write_markers = [
        "apply",
        "destroy",
        "delete",
        "drop",
        "truncate",
        "update",
        "insert",
        "create",
        "replace",
        "push",
        "deploy",
        "migrate",
        "alter",
    ]
    return any(m in low for m in write_markers)


decision = None
reason = None

if tool_name in {"edit", "create", "create_file", "edit_file"}:
    path = tool_args.get("path") or tool_args.get("filePath") or tool_args.get("file_path") or ""
    content = tool_args.get("content") or tool_args.get("newCode") or ""
    if isinstance(content, list):
        content = "\n".join(str(x) for x in content)
    if path and is_env_path(path) and contains_secret(content):
        decision = "deny"
        reason = "Secrets are not allowed in .env files. Use GitHub Secrets or local secret storage."

if not decision and tool_name in {"bash", "shell", "terminal", "execute"}:
    command = tool_args.get("command") or ""
    args = tool_args.get("args")
    if not command and args:
        command = " ".join(str(x) for x in args) if isinstance(args, list) else str(args)
    if is_prod_command(command):
        allow_readonly = os.environ.get("ALLOW_PROD_READONLY") == "1"
        approved = os.environ.get("PROD_APPROVED") == "1"
        if not (allow_readonly and approved):
            decision = "deny"
            reason = "Production access requires explicit approval and read-only mode."
        elif is_write_command(command):
            decision = "deny"
            reason = "Production access is read-only. Write operations require explicit approval."

log_entry = {
    "event": "preToolUse",
    "timestamp": data.get("timestamp"),
    "toolName": tool_name,
    "toolArgsSummary": summarize_tool_args(),
    "decision": decision,
    "reason": reason,
}
with open(os.path.join(log_dir, "pre-tool-use.jsonl"), "a", encoding="utf-8") as f:
    json.dump(log_entry, f, separators=(",", ":"))
    f.write("\n")

if decision == "deny":
    output = {"permissionDecision": "deny", "permissionDecisionReason": reason}
    sys.stdout.write(json.dumps(output, separators=(",", ":")))
PY
