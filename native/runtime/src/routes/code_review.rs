use axum::{Router, routing::{get, post}, Json};
use crate::app::AppState;

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/code-review/prepare", get(prepare))
        .route("/api/code-review/launch", post(launch))
        .with_state(state)
}

async fn prepare() -> Json<serde_json::Value> {
    Json(serde_json::json!({"reviews": [], "stub": true}))
}

async fn launch() -> Json<serde_json::Value> {
    Json(serde_json::json!({"ok": true, "stub": true}))
}
