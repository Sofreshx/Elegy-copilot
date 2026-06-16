use axum::{Router, routing::get, extract::State, Json};
use crate::app::AppState;
use crate::error::ApiError;

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/lifecycle/status", get(lifecycle_status))
        .route("/api/sandboxes", get(list_sandboxes))
        .with_state(state)
}

/// GET /api/lifecycle/status — runtime health overview
async fn lifecycle_status(
    State(state): State<AppState>,
) -> Json<serde_json::Value> {
    let sandboxes = list_sandbox_dirs(&state);
    
    Json(serde_json::json!({
        "ok": true,
        "engineRoot": state.config.engine_root.to_string_lossy(),
        "elegyHome": state.config.elegy_home.to_string_lossy(),
        "sandboxesHome": state.config.sandboxes_home.to_string_lossy(),
        "sandboxCount": sandboxes.len(),
        "sandboxes": sandboxes,
        "host": state.config.host,
        "port": state.config.port,
    }))
}

/// GET /api/sandboxes — list sandbox directories
async fn list_sandboxes(
    State(state): State<AppState>,
) -> Json<serde_json::Value> {
    let sandboxes = list_sandbox_dirs(&state);
    Json(serde_json::json!({ "sandboxes": sandboxes, "count": sandboxes.len() }))
}

fn list_sandbox_dirs(state: &AppState) -> Vec<serde_json::Value> {
    let mut result = Vec::new();
    let home = &state.config.sandboxes_home;
    if let Ok(entries) = std::fs::read_dir(home) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                let name = path.file_name().unwrap_or_default().to_string_lossy();
                let session_dir = path.join("session-state");
                let session_count = if session_dir.exists() {
                    std::fs::read_dir(&session_dir).map(|d| d.count()).unwrap_or(0)
                } else { 0 };
                result.push(serde_json::json!({
                    "id": name,
                    "path": path.to_string_lossy(),
                    "sessionCount": session_count,
                }));
            }
        }
    }
    result
}
