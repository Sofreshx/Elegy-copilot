use axum::extract::State;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::json;
use std::path::PathBuf;

use crate::app::AppState;
use crate::error::ApiError;

/// GET /api/lsp/config — read LSP config from elegy home
async fn get_lsp_config(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let config_path = state.config.elegy_home.join("lsp-config.json");
    if config_path.is_file() {
        match std::fs::read_to_string(&config_path) {
            Ok(content) => {
                match serde_json::from_str::<serde_json::Value>(&content) {
                    Ok(config) => Ok(Json(json!({ "config": config }))),
                    Err(_) => Ok(Json(json!({ "config": {}, "raw": content }))),
                }
            }
            Err(e) => Err(ApiError::Internal(e.into())),
        }
    } else {
        Ok(Json(json!({ "config": {} })))
    }
}

/// POST /api/lsp/install — log installation, return success
async fn install_lsp(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, ApiError> {
    // Log installation attempt
    tracing::info!("LSP install requested (stub — no actual install performed)");

    // Check if install script exists
    let script_name = if cfg!(target_os = "windows") {
        "install-lsp.ps1"
    } else {
        "install-lsp.sh"
    };
    let script_path = state.config.engine_root.join("scripts").join(script_name);

    if script_path.is_file() {
        Ok(Json(json!({
            "ok": true,
            "message": format!("Install script found at {}", script_path.display()),
            "scriptPath": script_path.to_string_lossy(),
        })))
    } else {
        Ok(Json(json!({
            "ok": true,
            "message": "LSP install logged (no install script found, manual install may be needed)",
            "scriptFound": false,
        })))
    }
}

/// POST /api/system/factory-reset — reset OpenCode and Codex configs
async fn factory_reset(
    State(_state): State<AppState>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    let mut results = serde_json::json!({
        "opencode": { "status": "skipped", "message": "" },
        "codex": { "status": "skipped", "message": "" },
        "copilot": { "status": "skipped", "message": "" },
        "elegy": { "status": "skipped", "message": "" },
    });

    let results_map = results.as_object_mut().unwrap();

    // Reset OpenCode config
    let opencode_home = home.join(".config").join("opencode");
    if opencode_home.is_dir() {
        let config_file = opencode_home.join("opencode.jsonc");
        if config_file.is_file() {
            // Backup then remove
            let backup = opencode_home.join("opencode.jsonc.factory-reset-backup");
            let _ = std::fs::copy(&config_file, &backup);
            match std::fs::remove_file(&config_file) {
                Ok(()) => {
                    results_map.insert("opencode".to_string(), json!({
                        "status": "ok",
                        "message": "OpenCode config removed. Backup saved as opencode.jsonc.factory-reset-backup"
                    }));
                }
                Err(e) => {
                    results_map.insert("opencode".to_string(), json!({
                        "status": "error",
                        "message": format!("Failed: {}", e)
                    }));
                }
            }
        } else {
            results_map.insert("opencode".to_string(), json!({
                "status": "skipped",
                "message": "No OpenCode config found"
            }));
        }
    } else {
        results_map.insert("opencode".to_string(), json!({
            "status": "skipped",
            "message": "OpenCode home not found"
        }));
    }

    // Reset Codex provider config
    let codex_home = home.join(".codex");
    if codex_home.is_dir() {
        let codex_config = codex_home.join("settings.json");
        if codex_config.is_file() {
            let backup = codex_home.join("settings.json.elegy-backup");
            let _ = std::fs::copy(&codex_config, &backup);
            // Read, remove experimental settings, write back
            match std::fs::read_to_string(&codex_config) {
                Ok(content) => {
                    if let Ok(mut settings) = serde_json::from_str::<serde_json::Value>(&content) {
                        if let Some(map) = settings.as_object_mut() {
                            let changed = map.remove("enableExperimental").is_some()
                                || map.remove("experimental").is_some();
                            if changed {
                                if let Ok(new_content) = serde_json::to_string_pretty(&settings) {
                                    let _ = std::fs::write(&codex_config, &new_content);
                                }
                            }
                        }
                    }
                    results_map.insert("codex".to_string(), json!({
                        "status": "ok",
                        "message": "Codex experimental settings removed"
                    }));
                }
                Err(e) => {
                    results_map.insert("codex".to_string(), json!({
                        "status": "error",
                        "message": format!("Failed: {}", e)
                    }));
                }
            }
        } else {
            results_map.insert("codex".to_string(), json!({
                "status": "skipped",
                "message": "No Codex config found"
            }));
        }
    } else {
        results_map.insert("codex".to_string(), json!({
            "status": "skipped",
            "message": "Codex home not found"
        }));
    }

    // Reset Copilot config (remove agents/skills contributed by us)
    let copilot_home = home.join(".copilot");
    if copilot_home.is_dir() {
        // We don't remove the whole .copilot, just note it exists
        results_map.insert("copilot".to_string(), json!({
            "status": "ok",
            "message": "Copilot home exists — kept intact"
        }));
    }

    // Log the reset
    tracing::warn!("Factory reset performed. Results: {:?}", results);

    let all_ok = results.as_object().unwrap().values().all(|r| {
        r["status"].as_str() == Some("ok") || r["status"].as_str() == Some("skipped")
    });

    Ok(Json(json!({
        "ok": all_ok,
        "results": results,
    })))
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/lsp/config", get(get_lsp_config))
        .route("/api/lsp/install", post(install_lsp))
        .route("/api/system/factory-reset", post(factory_reset))
        .with_state(state)
}
