use axum::{Router, routing::{get, post}, Json};
use crate::app::AppState;

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/repo-assets/discover", get(discover))
        .route("/api/repo-assets/install", post(install))
        .with_state(state)
}

async fn discover() -> Json<serde_json::Value> {
    Json(serde_json::json!({"assets": [], "stub": true}))
}

async fn install() -> Json<serde_json::Value> {
    Json(serde_json::json!({"ok": true, "stub": true}))
}
