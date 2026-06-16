use axum::extract::{Path, State};
use axum::routing::post;
use axum::{Json, Router};
use serde_json::json;

use crate::app::AppState;

/// POST /api/sandboxes/lifecycle/{action} — perform lifecycle action on sandboxes
async fn sandbox_lifecycle_action(
    State(_state): State<AppState>,
    Path(action): Path<String>,
) -> Json<serde_json::Value> {
    Json(json!({
        "ok": true,
        "action": action,
        "stub": true
    }))
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/sandboxes/lifecycle/{action}", post(sandbox_lifecycle_action))
        .with_state(state)
}
