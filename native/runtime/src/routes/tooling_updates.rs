use axum::{Router, Json};
use crate::app::AppState;

/// Stub check for tooling updates.
/// Returns empty updates list to satisfy frontend startup check.
async fn check_updates() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "ok": true,
        "updates": [],
        "stub": true,
    }))
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/tooling-updates/check", axum::routing::post(check_updates))
        .route("/api/tooling-updates/status", axum::routing::get(check_updates))
        .with_state(state)
}
