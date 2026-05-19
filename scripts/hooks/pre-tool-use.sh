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
import hashlib
from typing import Optional


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
    tool_args = json.loads(raw_args) if isinstance(raw_args, str) else (raw_args or {})
except Exception:
    tool_args = {}

# --- Hook Rule Configuration ---
enabled_rules: set[str] = set()
_hook_rules_path = os.environ.get("HOOK_RULES_FILE") or os.path.join(
    os.path.expanduser("~"), ".copilot", "hook-rules.json"
)
try:
    if os.path.isfile(_hook_rules_path):
        with open(_hook_rules_path, "r", encoding="utf-8") as _rf:
            _rules_config = json.load(_rf)
        if isinstance(_rules_config, dict) and _rules_config.get("schemaVersion") == 1:
            _overrides = _rules_config.get("overrides")
            if isinstance(_overrides, dict):
                for _rid, _val in _overrides.items():
                    if _val is True:
                        enabled_rules.add(_rid)
except Exception:
    enabled_rules = set()


def rule_enabled(rule_id: str) -> bool:
    return rule_id in enabled_rules


def is_env_path(path: str) -> bool:
    base = os.path.basename(path or "")
    return base.startswith(".env")


def is_placeholder(value: str) -> bool:
    low = (value or "").lower()
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


def is_terminal_tool(name: str) -> bool:
    low = (name or "").lower()
    return low in {"bash", "shell", "terminal", "execute", "execute/runinterminal"} or low.endswith("/runinterminal")


def summarize_tool_args() -> dict:
    if tool_name in {"edit", "create", "create_file", "edit_file"}:
        path = tool_args.get("path") or tool_args.get("filePath") or tool_args.get("file_path") or ""
        content = tool_args.get("content") or tool_args.get("newCode") or ""
        if isinstance(content, list):
            content = "\n".join(str(x) for x in content)
        return {"path": path, "contentLength": len(content)}

    if is_terminal_tool(tool_name):
        command = tool_args.get("command") or ""
        args = tool_args.get("args")
        if not command and args:
            command = " ".join(str(x) for x in args) if isinstance(args, list) else str(args)
        return {
            "command": redact_command(command),
            "timeout": tool_args.get("timeout"),
            "isBackground": tool_args.get("isBackground"),
        }

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


def is_watch_or_interactive_command(command: str) -> bool:
    if not command:
        return False
    low = command.lower()
    if "playwright" in low and (
        re.search(r"(?i)(^|\s)--ui(\s|$)", command)
        or re.search(r"(?i)(^|\s)--debug(\s|$)", command)
        or re.search(r"(?i)(^|\s)pwdebug=1(\s|$)", command)
    ):
        return True
    watch_markers = [
        "dotnet watch",
        "vitest --watch",
        "vitest -w",
        "jest --watch",
        "jest --watchall",
        "npm run watch",
        "pnpm run watch",
        "yarn watch",
    ]
    return any(m in low for m in watch_markers)


def is_dotnet_test_command(command: str) -> bool:
    if not command:
        return False
    return re.search(r"(?i)\bdotnet\s+test\b", command) is not None


def has_no_restore(command: str) -> bool:
    if not command:
        return False
    return re.search(r"(?i)(^|\s)--no-restore(\s|$)", command) is not None


def is_vitest_non_run(command: str) -> bool:
    if not command:
        return False
    if re.search(r"(?i)\bvitest\b", command) is None:
        return False
    has_run = re.search(r"(?i)\bvitest\s+run\b", command) is not None or re.search(r"(?i)(^|\s)--run(\s|$)", command) is not None
    return not has_run


def high_risk_command_reason(command: str) -> Optional[str]:
    if not command:
        return None
    cmd = command.strip()
    if not cmd:
        return None

    if rule_enabled("safety-git-push") and re.match(r"(?i)^\s*(?:sudo\s+)?(?:\w+=\S+\s+)*git\s+push(\s|$)", cmd):
        has_force_flag = re.search(r"(?i)(^|\s)(--force|--force-with-lease|--force-if-includes|-f)(\s|$)", cmd) is not None
        has_refspec = ":" in cmd
        has_shell_chain = bool(re.search(r"[;&|]", cmd))
        is_safe_branch = (
            os.environ.get("ALLOW_CI_PUSH") == "1"
            and re.fullmatch(r"(?i)git\s+push\s+\S+\s+(ci-fix/|revert/|autofix/)\S+\s*", cmd) is not None
            and not has_force_flag and not has_refspec and not has_shell_chain
        )
        if not is_safe_branch:
            return "High-risk git command blocked by baseline policy: git push (use a PR workflow instead). Set ALLOW_CI_PUSH=1 for ci-fix/revert/autofix branches."
    if rule_enabled("safety-git-reset-hard") and re.match(r"(?i)^\s*(?:sudo\s+)?(?:\w+=\S+\s+)*git\s+reset\b", cmd) and re.search(r"(?i)(^|\s)--hard(\s|$)", cmd):
        return "High-risk git command blocked by baseline policy: git reset --hard (can destroy local changes)."
    if rule_enabled("safety-git-clean") and re.match(r"(?i)^\s*(?:sudo\s+)?(?:\w+=\S+\s+)*git\s+clean\b", cmd):
        has_force = re.search(r"(?i)(^|\s)--force(\s|$)|(^|\s)-[a-z]*f[a-z]*(\s|$)", cmd) is not None
        has_dirs = re.search(r"(?i)(^|\s)--directories(\s|$)|(^|\s)-[a-z]*d[a-z]*(\s|$)", cmd) is not None
        has_ignored = re.search(r"(?i)(^|\s)--ignored(\s|$)|(^|\s)-[a-z]*x[a-z]*(\s|$)", cmd) is not None
        if has_force and has_dirs and has_ignored:
            return "High-risk git command blocked by baseline policy: git clean -fdx (or equivalent) (can delete untracked/ignored files)."
    if rule_enabled("safety-git-force-checkout") and re.match(r"(?i)^\s*(?:sudo\s+)?(?:\w+=\S+\s+)*git\s+(?:checkout|switch)\b", cmd) and re.search(r"(?i)(^|\s)(-f|--force)(\s|$)", cmd):
        return "High-risk git command blocked by baseline policy: git checkout/switch -f/--force (can discard work)."
    if rule_enabled("safety-git-rebase-interactive") and re.match(r"(?i)^\s*(?:sudo\s+)?(?:\w+=\S+\s+)*git\s+rebase\b", cmd) and re.search(r"(?i)(^|\s)(--onto|--interactive|-i)(\s|$)", cmd):
        return "High-risk git command blocked by baseline policy: git rebase --onto/-i (history rewriting and often interactive)."
    if rule_enabled("safety-gh-repo-delete") and re.match(r"(?i)^\s*gh\s+repo\s+delete(\s|$)", cmd):
        return "High-risk GitHub CLI command blocked by baseline policy: gh repo delete."

    if rule_enabled("safety-rm-rf") and re.match(r"(?i)^\s*(?:sudo\s+)?rm\s+", cmd) and re.search(r"(?i)(^|\s)-[^\s]*r[^\s]*f[^\s]*(\s|$)", cmd) and re.search(r"(?i)(\s|^)(/|/\*|~|~\/\*)(\s|$)", cmd):
        return "Destructive OS command blocked by baseline policy: rm -rf targeting / or ~."
    if rule_enabled("safety-os-shutdown") and re.match(r"(?i)^\s*(shutdown|reboot|poweroff|halt)(\s|$)", cmd):
        return "Destructive OS command blocked by baseline policy: shutdown/reboot/poweroff."
    if rule_enabled("safety-disk-ops") and re.match(r"(?i)^\s*(?:sudo\s+)?dd(\s|$)", cmd):
        return "Destructive OS command blocked by baseline policy: dd (raw disk write risk)."
    if rule_enabled("safety-disk-ops") and re.match(r"(?i)^\s*(?:sudo\s+)?mkfs(\.|(\s|$))", cmd):
        return "Destructive OS command blocked by baseline policy: mkfs* (filesystem format risk)."
    if rule_enabled("safety-disk-ops") and re.match(r"(?i)^\s*(format|diskpart)(\s|$)", cmd):
        return "Destructive OS command blocked by baseline policy: format/diskpart."
    if rule_enabled("safety-remove-item") and re.match(r"(?i)^\s*(remove-item|rm|ri)\b", cmd) and re.search(r"(?i)(^|\s)-recurse(\s|$)", cmd) and re.search(r"(?i)(^|\s)-force(\s|$)", cmd) and re.search(r"(?i)(\s|^)(c:\\\\|c:/)(\s|$)", cmd):
        return "Destructive OS command blocked by baseline policy: Remove-Item -Recurse -Force targeting C:\\."
    if rule_enabled("safety-remove-item") and re.match(r"(?i)^\s*(rmdir|rd)\b", cmd) and re.search(r"(?i)(^|\s)/s(\s|$)", cmd) and re.search(r"(?i)(^|\s)/q(\s|$)", cmd) and re.search(r"(?i)(\s|^)(c:\\\\|c:/)(\s|$)", cmd):
        return "Destructive OS command blocked by baseline policy: rmdir/rd /s /q targeting C:\\."
    if rule_enabled("safety-remove-item") and re.match(r"(?i)^\s*(del|erase)\b", cmd) and re.search(r"(?i)(^|\s)/s(\s|$)", cmd) and re.search(r"(?i)(^|\s)/q(\s|$)", cmd) and re.search(r"(?i)(\s|^)(c:\\\\|c:/)(\s|$)", cmd):
        return "Destructive OS command blocked by baseline policy: del/erase /s /q targeting C:\\."

    return None


def get_required_early_controls() -> list[str]:
    raw = (os.environ.get("HOOK_EARLY_CONTROLS_REQUIRED") or "").strip()
    if not raw:
        return ["safetyTokenParity", "hookEnforcement", "telemetrySchemaValidation"]
    controls = [part.strip() for part in raw.split(",") if part.strip()]
    return controls or ["safetyTokenParity", "hookEnforcement", "telemetrySchemaValidation"]


def get_privileged_tool_names() -> list[str]:
    raw = (os.environ.get("HOOK_PRIVILEGED_TOOLS") or "").strip()
    if not raw:
        return ["execute/runinterminal", "run_in_terminal", "edit", "create", "create_file", "edit_file", "apply_patch"]
    values = [part.strip().lower() for part in raw.split(",") if part.strip()]
    return values or ["execute/runinterminal", "run_in_terminal", "edit", "create", "create_file", "edit_file", "apply_patch"]


def is_privileged_tool(name: str) -> bool:
    low = (name or "").lower()
    if not low:
        return False
    if low in set(get_privileged_tool_names()):
        return True
    return "runinterminal" in low


def resolve_early_control_state_path(cwd: str) -> str:
    configured = (os.environ.get("HOOK_EARLY_CONTROLS_STATE_FILE") or "").strip()
    if not configured:
        return os.path.join(cwd, ".instructions-output", "hooks", "early-controls.json")
    if os.path.isabs(configured):
        return configured
    return os.path.join(cwd, configured)


def verify_safety_token_parity(state: dict) -> tuple[bool, str]:
    control_data = state.get("controlData") if isinstance(state, dict) else None
    if not isinstance(control_data, dict):
        return False, "control_data_missing"

    safety_token = str(control_data.get("safetyToken") or "").strip()
    safety_parity = str(control_data.get("safetyTokenParity") or "").strip().lower()
    if not safety_token or not safety_parity:
        return False, "token_or_parity_missing"

    expected = hashlib.sha256(safety_token.encode("utf-8")).hexdigest().lower()
    if expected != safety_parity:
        return False, "token_parity_mismatch"

    return True, "token_parity_valid"


def get_early_control_gate_result(cwd: str, required_controls: list[str]) -> dict:
    state_path = resolve_early_control_state_path(cwd)
    if not os.path.isfile(state_path):
        return {
            "allowed": False,
            "statePath": state_path,
            "failedControls": list(required_controls),
            "reason": "Privileged action blocked: early controls unavailable (state file missing).",
        }

    try:
        with open(state_path, "r", encoding="utf-8") as f:
            state = json.load(f)
    except Exception:
        return {
            "allowed": False,
            "statePath": state_path,
            "failedControls": list(required_controls),
            "reason": "Privileged action blocked: early controls unavailable (state file unreadable).",
        }

    if not isinstance(state, dict):
        return {
            "allowed": False,
            "statePath": state_path,
            "failedControls": list(required_controls),
            "reason": "Privileged action blocked: early controls unavailable (state invalid).",
        }

    controls = state.get("controls") or {}
    failed_details: list[str] = []
    for control_id in required_controls:
        control_state = controls.get(control_id) if isinstance(controls, dict) else None
        status = ""
        detail = "missing"
        if isinstance(control_state, dict):
            status = str(control_state.get("status") or "")
            detail_value = str(control_state.get("detail") or "").strip()
            if detail_value:
                detail = detail_value

        if control_id == "safetyTokenParity":
            parity_ok, parity_detail = verify_safety_token_parity(state)
            if not parity_ok:
                failed_details.append(f"{control_id}:{parity_detail}")
                continue

        if status != "pass":
            failed_details.append(f"{control_id}:{detail}")

    if failed_details:
        return {
            "allowed": False,
            "statePath": state_path,
            "failedControls": failed_details,
            "reason": f"Privileged action blocked: early controls not satisfied ({', '.join(failed_details)}).",
        }

    return {
        "allowed": True,
        "statePath": state_path,
        "failedControls": [],
        "reason": None,
    }


decision = None
reason = None
is_privileged = is_privileged_tool(tool_name)
required_early_controls = get_required_early_controls()
early_control_gate = None

if rule_enabled("safety-early-control-gate") and is_privileged:
    early_control_gate = get_early_control_gate_result(cwd, required_early_controls)
    if not early_control_gate.get("allowed"):
        decision = "deny"
        reason = early_control_gate.get("reason")

# Secrets gate (.env*)
if rule_enabled("safety-secrets-env") and tool_name in {"edit", "create", "create_file", "edit_file"}:
    path = tool_args.get("path") or tool_args.get("filePath") or tool_args.get("file_path") or ""
    content = tool_args.get("content") or tool_args.get("newCode") or ""
    if isinstance(content, list):
        content = "\n".join(str(x) for x in content)
    if path and is_env_path(path) and contains_secret(content):
        decision = "deny"
        reason = "Secrets are not allowed in .env files. Use GitHub Secrets or local secret storage."

# Terminal anti-hang enforcement
if not decision and is_terminal_tool(tool_name):
    command = tool_args.get("command") or ""
    args = tool_args.get("args")
    if not command and args:
        command = " ".join(str(x) for x in args) if isinstance(args, list) else str(args)

    timeout = tool_args.get("timeout")
    is_background = tool_args.get("isBackground")

    is_background_bool = is_background is True or str(is_background).lower() in {"true", "1", "yes"}

    try:
        timeout_int = int(timeout) if timeout is not None else None
    except Exception:
        timeout_int = None

    if rule_enabled("anti-hang-timeout") and (timeout_int is None or timeout_int <= 0):
        decision = "deny"
        reason = "Terminal commands must set a non-zero timeout (ms). Infinite waits are not allowed."
    elif rule_enabled("anti-hang-background") and is_background_bool:
        decision = "deny"
        reason = "Terminal commands must not run in the background (isBackground=true). Use foreground execution only."
    elif rule_enabled("anti-hang-watch-interactive") and is_watch_or_interactive_command(command):
        decision = "deny"
        reason = "Watch/interactive commands are not allowed in agent runs (they can hang). Use non-interactive equivalents."
    elif rule_enabled("anti-hang-vitest-run") and is_vitest_non_run(command):
        decision = "deny"
        reason = "Vitest must be run in non-interactive mode (use vitest run or add --run)."
    elif rule_enabled("anti-hang-dotnet-restore") and is_dotnet_test_command(command) and not has_no_restore(command):
        decision = "deny"
        reason = "dotnet test must include --no-restore to avoid restore prompts/hangs. Build/restore separately if needed."
    else:
        risk_reason = high_risk_command_reason(command)
        if risk_reason:
            decision = "deny"
            reason = risk_reason

    # Prod policy (applies to terminal tools only)
    if not decision and rule_enabled("safety-production-access") and is_prod_command(command):
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
    "hookRulesStatus": f"loaded:{len(enabled_rules)}" if enabled_rules else "default-off",
    "toolName": tool_name,
    "isPrivilegedTool": is_privileged,
    "earlyControlsRequired": required_early_controls,
    "earlyControlsStatePath": (early_control_gate or {}).get("statePath"),
    "earlyControlsFailed": (early_control_gate or {}).get("failedControls", []),
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
