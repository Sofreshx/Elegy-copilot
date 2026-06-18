use axum::extract::State;
use axum::routing::{get, post, put};
use axum::{Json, Router};
use serde_json::{json, Value};
use std::path::Path;

use crate::app::AppState;
use crate::routes::cli_detection;

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

fn provider_config_path(elegy_home: &Path) -> std::path::PathBuf {
    elegy_home.join("config").join("claude-code-provider.json")
}

fn deepseek_key_config_path(elegy_home: &Path) -> std::path::PathBuf {
    elegy_home.join("config").join("claude-code-deepseek-key.json")
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/// GET /api/claude-code/status
async fn status(State(state): State<AppState>) -> Json<Value> {
    let (installed, version) = cli_detection::check_cli("claude");

    let claude_home = dirs::home_dir()
        .map(|h| h.join(".claude").to_string_lossy().to_string());
    let claude_config = dirs::home_dir()
        .map(|h| h.join(".claude").join("claude_config.json").to_string_lossy().to_string());

    // Read the provider config to check if it exists
    let provider_path = provider_config_path(&state.config.elegy_home);

    let overall_status = if installed {
        if provider_path.exists() {
            "ready"
        } else {
            "degraded"
        }
    } else {
        "blocked"
    };

    Json(json!({
        "overallStatus": overall_status,
        "claudeHome": claude_home,
        "claudeConfigPath": claude_config,
        "cli": {
            "installed": installed,
            "version": version,
            "installCommand": "npm install -g @anthropic-ai/claude-code",
            "lastError": null
        }
    }))
}

/// POST /api/claude-code/cli/install
async fn cli_install() -> Json<Value> {
    if !cli_detection::check_npm() {
        return Json(json!({
            "ok": false,
            "installed": false,
            "message": "npm is not available. Please install Node.js and npm first."
        }));
    }

    let (already_installed, _) = cli_detection::check_cli("claude");
    if already_installed {
        return Json(json!({
            "ok": true,
            "installed": true,
            "message": "Claude Code CLI is already installed."
        }));
    }

    let output = std::process::Command::new("npm")
        .args(["install", "-g", "@anthropic-ai/claude-code"])
        .output();

    match output {
        Ok(output) => {
            if output.status.success() {
                Json(json!({
                    "ok": true,
                    "installed": true,
                    "message": "Claude Code CLI installed successfully."
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

/// GET /api/claude-code/provider — read provider configuration from disk
async fn provider_get(State(state): State<AppState>) -> Json<Value> {
    let path = provider_config_path(&state.config.elegy_home);
    if path.exists() {
        match std::fs::read_to_string(&path) {
            Ok(content) => {
                if let Ok(parsed) = serde_json::from_str::<Value>(&content) {
                    return Json(parsed);
                }
            }
            Err(_) => {}
        }
    }
    Json(json!({"provider": null, "stub": false}))
}

/// PUT /api/claude-code/provider — persist provider configuration
async fn provider_set(
    State(state): State<AppState>,
    Json(body): Json<Value>,
) -> Json<Value> {
    let path = provider_config_path(&state.config.elegy_home);
    if let Some(parent) = path.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            return Json(json!({"ok": false, "error": e.to_string()}));
        }
    }
    match serde_json::to_string_pretty(&body) {
        Ok(content) => match std::fs::write(&path, content) {
            Ok(()) => Json(json!({"ok": true})),
            Err(e) => Json(json!({"ok": false, "error": e.to_string()})),
        },
        Err(e) => Json(json!({"ok": false, "error": e.to_string()})),
    }
}

/// POST /api/claude-code/provider/reset — delete provider configuration file
async fn provider_reset(State(state): State<AppState>) -> Json<Value> {
    let path = provider_config_path(&state.config.elegy_home);
    if path.exists() {
        match std::fs::remove_file(&path) {
            Ok(()) => Json(json!({"ok": true})),
            Err(e) => Json(json!({"ok": false, "error": e.to_string()})),
        }
    } else {
        Json(json!({"ok": true}))
    }
}

/// PUT /api/claude-code/provider/deepseek-key — persist DeepSeek API key
async fn deepseek_key_set(
    State(state): State<AppState>,
    Json(body): Json<Value>,
) -> Json<Value> {
    let key = body.get("key").and_then(|k| k.as_str()).unwrap_or("");
    let path = deepseek_key_config_path(&state.config.elegy_home);
    if let Some(parent) = path.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            return Json(json!({"ok": false, "error": e.to_string()}));
        }
    }
    let payload = json!({"key": key});
    match serde_json::to_string_pretty(&payload) {
        Ok(content) => match std::fs::write(&path, content) {
            Ok(()) => Json(json!({"ok": true})),
            Err(e) => Json(json!({"ok": false, "error": e.to_string()})),
        },
        Err(e) => Json(json!({"ok": false, "error": e.to_string()})),
    }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/claude-code/status", get(status))
        .route("/api/claude-code/cli/install", post(cli_install))
        .route(
            "/api/claude-code/provider",
            get(provider_get).put(provider_set),
        )
        .route("/api/claude-code/provider/reset", post(provider_reset))
        .route(
            "/api/claude-code/provider/deepseek-key",
            put(deepseek_key_set),
        )
        .with_state(state)
}
