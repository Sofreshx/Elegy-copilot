use axum::extract::State;
use axum::{Json, Router};
use axum::routing::{get, post};
use chrono::Utc;
use serde_json::json;
use std::path::PathBuf;
use std::process::Command;

use crate::app::AppState;
use crate::routes::cli_detection;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn resolve_opencode_path() -> Option<PathBuf> {
    let which = if cfg!(windows) { "where" } else { "which" };
    if Command::new(which)
        .arg("opencode")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
    {
        Some(PathBuf::from("opencode"))
    } else {
        None
    }
}

fn resolve_elegy_planning_path(state: &AppState) -> Option<PathBuf> {
    if let Ok(env_path) = std::env::var("INSTRUCTION_ENGINE_ELEGY_PLANNING_CLI_PATH") {
        let p = PathBuf::from(&env_path);
        if p.is_file() {
            return Some(p);
        }
    }

    let exe = if cfg!(windows) {
        "elegy-planning.exe"
    } else {
        "elegy-planning"
    };
    let elegy = &state.config.elegy_home;
    let engine = &state.config.engine_root;

    let candidates = vec![
        elegy.join("managed-cli").join("planning").join(exe),
        elegy.join("managed-cli").join("planning").join("bin").join(exe),
        elegy.join("bin").join(exe),
        elegy.join("elegy-planning").join(exe),
        engine.join("elegy-planning").join(exe),
        engine.join("elegy-planning").join("bin").join(exe),
    ];

    for c in &candidates {
        if c.is_file() {
            return Some(c.clone());
        }
    }

    // Fall back to PATH
    let which = if cfg!(windows) { "where" } else { "which" };
    if Command::new(which)
        .arg(exe)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
    {
        return Some(PathBuf::from(exe));
    }

    None
}

fn get_version(path: &PathBuf) -> Option<String> {
    Command::new(path)
        .arg("--version")
        .output()
        .ok()
        .and_then(|o| {
            if o.status.success() {
                Some(String::from_utf8_lossy(&o.stdout).trim().to_string())
            } else {
                None
            }
        })
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/// GET /api/tooling/cli/status — check CLI tools availability
async fn cli_status(State(state): State<AppState>) -> Json<serde_json::Value> {
    let npm = cli_detection::check_npm();

    let opencode_path = resolve_opencode_path();
    let opencode_ver = opencode_path.as_ref().and_then(get_version);

    let elegy_path = resolve_elegy_planning_path(&state);
    let elegy_ver = elegy_path.as_ref().and_then(get_version);

    Json(json!({
        "ok": true,
        "npmAvailable": npm,
        "tools": [
            {
                "id": "opencode-cli",
                "title": "OpenCode CLI",
                "installed": opencode_path.is_some(),
                "path": opencode_path.map(|p| p.to_string_lossy().to_string()),
                "version": opencode_ver,
                "lastError": null
            },
            {
                "id": "elegy-planning",
                "title": "Elegy Planning",
                "installed": elegy_path.is_some(),
                "path": elegy_path.map(|p| p.to_string_lossy().to_string()),
                "version": elegy_ver,
                "lastError": null
            }
        ],
        "checkedAt": Utc::now().to_rfc3339()
    }))
}

/// POST /api/tooling/cli/install — install opencode-ai npm package
async fn cli_install() -> Json<serde_json::Value> {
    if !cli_detection::check_npm() {
        return Json(json!({
            "ok": false,
            "installed": false,
            "message": "npm is not available. Please install Node.js and npm first."
        }));
    }

    let output = std::process::Command::new("npm")
        .args(["install", "-g", "opencode-ai"])
        .output();

    match output {
        Ok(output) => {
            if output.status.success() {
                Json(json!({
                    "ok": true,
                    "installed": true,
                    "message": "opencode-ai installed successfully."
                }))
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr).to_string();
                Json(json!({
                    "ok": false,
                    "installed": false,
                    "message": format!("Installation failed: {}", stderr)
                }))
            }
        }
        Err(e) => Json(json!({
            "ok": false,
            "installed": false,
            "message": format!("npm install failed: {}", e)
        })),
    }
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/tooling/cli/status", get(cli_status))
        .route("/api/tooling/cli/install", post(cli_install))
        .with_state(state)
}
