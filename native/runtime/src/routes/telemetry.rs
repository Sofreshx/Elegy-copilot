use axum::{Router, routing::get, Json};
use crate::app::AppState;

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/telemetry/harnesses", get(harnesses))
        .with_state(state)
}

async fn harnesses() -> Json<serde_json::Value> {
    Json(serde_json::json!({"harnesses": [], "stub": true}))
}
