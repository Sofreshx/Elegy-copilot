use std::path::Path;

use serde_json::json;

pub fn build_runtime_health(engine_root: &Path, sandboxes_home: &Path) -> serde_json::Value {
    json!({
        "contractVersion": "1.0.0",
        "mode": detect_runtime_mode(engine_root),
        "engineRoot": engine_root.display().to_string(),
        "provider": {
            "contractVersion": "1",
            "selectedProvider": "non-docker",
            "defaultProvider": "non-docker",
            "selectionSource": "default"
        },
        "capabilities": {
            "docker": detect_docker_capability(),
            "wsl2": detect_wsl2_capability(),
            "sandbox": detect_sandbox_capability(sandboxes_home),
        },
        "finishCompatibilityHook": {
            "contractVersion": "1",
            "deterministic": true,
            "status": "unavailable",
        }
    })
}

fn detect_runtime_mode(engine_root: &Path) -> &'static str {
    let lowered = engine_root.display().to_string().to_lowercase();
    if lowered.contains("app.asar") {
        "packaged"
    } else {
        "repo"
    }
}

fn detect_docker_capability() -> &'static str {
    std::process::Command::new("docker")
        .args(["version", "--format", "{{.Server.Version}}"])
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|_| "available")
        .unwrap_or("unavailable")
}

fn detect_wsl2_capability() -> &'static str {
    if cfg!(windows) {
        std::process::Command::new("wsl.exe")
            .arg("--status")
            .output()
            .ok()
            .filter(|output| output.status.success())
            .map(|_| "available")
            .unwrap_or("unavailable")
    } else {
        "unknown"
    }
}

fn detect_sandbox_capability(sandboxes_home: &Path) -> &'static str {
    match std::fs::create_dir_all(sandboxes_home).and_then(|_| std::fs::metadata(sandboxes_home)) {
        Ok(metadata) if metadata.is_dir() => "available",
        _ => "unavailable",
    }
}
