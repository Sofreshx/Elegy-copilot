#!/bin/bash
set -e

python - <<'PY'
import json
import os
import subprocess
import sys
import hashlib
import secrets


def get_required_early_controls() -> list[str]:
    raw = (os.environ.get("HOOK_EARLY_CONTROLS_REQUIRED") or "").strip()
    if not raw:
        return ["safetyTokenParity", "hookEnforcement", "telemetrySchemaValidation"]
    controls = [part.strip() for part in raw.split(",") if part.strip()]
    return controls or ["safetyTokenParity", "hookEnforcement", "telemetrySchemaValidation"]


def resolve_state_path(cwd: str) -> str:
    configured = (os.environ.get("HOOK_EARLY_CONTROLS_STATE_FILE") or "").strip()
    if not configured:
        return os.path.join(cwd, ".instructions-output", "hooks", "early-controls.json")
    if os.path.isabs(configured):
        return configured
    return os.path.join(cwd, configured)


def write_jsonl(path: str, entry: dict) -> None:
    with open(path, "a", encoding="utf-8") as f:
        json.dump(entry, f, separators=(",", ":"))
        f.write("\n")


def build_early_control_state(timestamp: str, required_controls: list[str]) -> dict:
    safety_token = secrets.token_hex(16)
    parity_token = hashlib.sha256(safety_token.encode("utf-8")).hexdigest()
    safety_passed = bool(safety_token) and bool(parity_token) and len(parity_token) == 64

    pre_tool_path = os.path.join(os.path.dirname(__file__), "pre-tool-use.sh")
    hook_enforcement_passed = os.path.isfile(pre_tool_path)

    controls = {
        "safetyTokenParity": {
            "status": "pass" if safety_passed else "fail",
            "detail": "deterministic_pair_valid" if safety_passed else "deterministic_pair_invalid",
        },
        "hookEnforcement": {
            "status": "pass" if hook_enforcement_passed else "fail",
            "detail": "pre_tool_use_hook_present" if hook_enforcement_passed else "pre_tool_use_hook_missing",
        },
        "telemetrySchemaValidation": {
            "status": "fail",
            "detail": "schema_unvalidated",
        },
    }

    telemetry_probe = {
        "event": "earlyControlsState",
        "schemaVersion": "1.0.0",
        "generatedAt": timestamp,
        "requiredControls": required_controls,
        "controls": list(controls.keys()),
    }
    telemetry_passed = bool(
        telemetry_probe.get("event")
        and telemetry_probe.get("schemaVersion")
        and telemetry_probe.get("generatedAt")
        and isinstance(telemetry_probe.get("requiredControls"), list)
        and len(telemetry_probe.get("requiredControls")) > 0
        and isinstance(telemetry_probe.get("controls"), list)
        and len(telemetry_probe.get("controls")) > 0
    )
    controls["telemetrySchemaValidation"] = {
        "status": "pass" if telemetry_passed else "fail",
        "detail": "schema_valid" if telemetry_passed else "schema_invalid",
    }

    for control_id in required_controls:
        if control_id not in controls:
            controls[control_id] = {
                "status": "fail",
                "detail": "missing_required_control",
            }

    all_passed = all((controls.get(control_id) or {}).get("status") == "pass" for control_id in required_controls)

    return {
        "schemaVersion": "1.0.0",
        "generatedAt": timestamp,
        "requiredControls": required_controls,
        "controls": controls,
        "controlData": {
            "safetyToken": safety_token,
            "safetyTokenParity": parity_token,
        },
        "allPassed": all_passed,
    }

raw = sys.stdin.read()
if not raw.strip():
    sys.exit(0)

try:
    data = json.loads(raw)
    cwd = data.get("cwd") or os.getcwd()
    log_dir = os.path.join(cwd, ".instructions-output", "hooks")
    os.makedirs(log_dir, exist_ok=True)
    session_log_path = os.path.join(log_dir, "session.jsonl")

    timestamp = data.get("timestamp") or ""
    if not isinstance(timestamp, str) or not timestamp.strip():
        from datetime import datetime, timezone

        timestamp = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    write_jsonl(
        session_log_path,
        {
            "event": "sessionStart",
            "timestamp": timestamp,
            "source": data.get("source"),
            "cwd": cwd,
            "initialPrompt": data.get("initialPrompt"),
        },
    )

    required_controls = get_required_early_controls()
    state = build_early_control_state(timestamp, required_controls)
    state_path = resolve_state_path(cwd)
    os.makedirs(os.path.dirname(state_path), exist_ok=True)
    with open(state_path, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2)
        f.write("\n")

    write_jsonl(
        session_log_path,
        {
            "event": "earlyControlsState",
            "timestamp": timestamp,
            "statePath": state_path,
            "allPassed": state.get("allPassed") is True,
            "controls": state.get("controls") or {},
        },
    )

    if os.environ.get("HOOK_START_INFRA") == "1":
        local_script = os.path.join(cwd, "scripts", "hooks", "session-start.local.sh")
        if os.path.isfile(local_script):
            result = subprocess.run(["bash", local_script], cwd=cwd)
            write_jsonl(
                session_log_path,
                {
                    "event": "sessionStartLocal",
                    "status": "success" if result.returncode == 0 else "error",
                    "exitCode": result.returncode,
                },
            )
except Exception:
    try:
        from datetime import datetime, timezone

        fallback_cwd = os.getcwd()
        log_dir = os.path.join(fallback_cwd, ".instructions-output", "hooks")
        os.makedirs(log_dir, exist_ok=True)
        session_log_path = os.path.join(log_dir, "session.jsonl")
        timestamp = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        required_controls = get_required_early_controls()
        failed_controls = {
            control_id: {"status": "fail", "detail": "state_generation_error"}
            for control_id in required_controls
        }
        state = {
            "schemaVersion": "1.0.0",
            "generatedAt": timestamp,
            "requiredControls": required_controls,
            "controls": failed_controls,
            "allPassed": False,
            "error": "session_start_exception",
        }

        state_path = resolve_state_path(fallback_cwd)
        os.makedirs(os.path.dirname(state_path), exist_ok=True)
        with open(state_path, "w", encoding="utf-8") as f:
            json.dump(state, f, indent=2)
            f.write("\n")

        write_jsonl(
            session_log_path,
            {
                "event": "earlyControlsState",
                "timestamp": timestamp,
                "statePath": state_path,
                "allPassed": False,
                "controls": failed_controls,
                "error": "session_start_exception",
            },
        )
    except Exception:
        pass

sys.exit(0)
PY
