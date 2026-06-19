use axum::{Router, routing::get, extract::State, Json};
use crate::app::AppState;

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/lifecycle/status", get(lifecycle_status))
        .with_state(state)
}

/// GET /api/lifecycle/status — runtime health overview
async fn lifecycle_status(
    State(state): State<AppState>,
) -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "ok": true,
        "engineRoot": state.config.engine_root.to_string_lossy(),
        "elegyHome": state.config.elegy_home.to_string_lossy(),
        "host": state.config.host,
        "port": state.config.port,
    }))
}
