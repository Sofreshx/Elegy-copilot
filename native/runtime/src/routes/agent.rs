use axum::{Router, routing::get, extract::State, Json};
use crate::app::AppState;

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/agent/definitions", get(list_definitions))
        .route("/api/agent/status", get(agent_status))
        .with_state(state)
}

/// GET /api/agent/definitions — list agent definition files
async fn list_definitions(
    State(state): State<AppState>,
) -> Json<serde_json::Value> {
    let mut agents = Vec::new();

    // Scan engine-assets/ agents
    for dir in &["engine-assets/agents", "opencode-assets/agents", "codex-assets/agents", "antigravity-assets/agents"] {
        let path = state.config.engine_root.join(dir);
        if let Ok(entries) = std::fs::read_dir(&path) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.extension().map_or(false, |e| e == "md") || p.extension().map_or(false, |e| e == "toml") {
                    let name = p.file_stem().unwrap_or_default().to_string_lossy().to_string();
                    let content = std::fs::read_to_string(&p).unwrap_or_default();
                    agents.push(serde_json::json!({
                        "name": name,
                        "path": p.to_string_lossy(),
                        "size": content.len(),
                    }));
                }
            }
        }
    }

    Json(serde_json::json!({ "agents": agents, "count": agents.len() }))
}

/// GET /api/agent/status — runtime agent health
async fn agent_status(
    State(state): State<AppState>,
) -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "ok": true,
        "engineRoot": state.config.engine_root.to_string_lossy(),
        "message": "Agent runtime active",
    }))
}
