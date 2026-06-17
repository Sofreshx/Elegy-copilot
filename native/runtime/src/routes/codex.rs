use axum::extract::State;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::json;
use std::process::Command;

use crate::app::AppState;
use crate::routes::cli_detection;

/// GET /api/codex/cli/status — check if Codex CLI is installed
async fn get_codex_cli_status(
    State(_state): State<AppState>,
) -> Json<serde_json::Value> {
    let (installed, version) = cli_detection::check_cli("codex");
    let _npm = cli_detection::check_npm();

    Json(json!({
        "codexHome": null,
        "cli": {
            "id": "codex-cli",
            "label": "Codex CLI",
            "command": "codex",
            "packageName": "@openai/codex",
            "installed": installed,
            "version": version,
            "installCommand": "npm install -g @openai/codex",
            "lastError": null
        }
    }))
}

/// POST /api/codex/cli/install — install or update Codex CLI via npm
async fn install_codex_cli(
    State(_state): State<AppState>,
) -> Json<serde_json::Value> {
    if !cli_detection::check_npm() {
        return Json(json!({
            "ok": false,
            "installed": false,
            "message": "npm is not available. Please install Node.js and npm first."
        }));
    }

    // Already installed – skip the install step.
    let (already_installed, version) = cli_detection::check_cli("codex");
    if already_installed {
        return Json(json!({
            "ok": true,
            "installed": true,
            "message": format!(
                "Codex CLI is already installed ({}).",
                version.unwrap_or_default()
            )
        }));
    }

    let output = Command::new("npm")
        .args(["install", "-g", "@openai/codex"])
        .output();

    match output {
        Ok(output) => {
            if output.status.success() {
                let (_, new_ver) = cli_detection::check_cli("codex");
                Json(json!({
                    "ok": true,
                    "installed": true,
                    "message": format!(
                        "Codex CLI installed successfully ({}).",
                        new_ver.unwrap_or_default()
                    )
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
        .route("/api/codex/cli/status", get(get_codex_cli_status))
        .route("/api/codex/cli/install", post(install_codex_cli))
        .with_state(state)
}
