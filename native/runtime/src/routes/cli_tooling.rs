use axum::{Router, routing::{get, post}, Json};
use crate::app::AppState;

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/tooling/cli/status", get(cli_status))
        .route("/api/tooling/cli/install", post(cli_install))
        .with_state(state)
}

async fn cli_status() -> Json<serde_json::Value> {
    Json(serde_json::json!({"status": "unavailable", "stub": true}))
}

async fn cli_install() -> Json<serde_json::Value> {
    Json(serde_json::json!({"ok": true, "stub": true}))
}
