use axum::{Router, Json};
use axum::routing::{get, post};
use crate::app::AppState;

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/ui-runtime-overlay/sessions", get(list_overlay_sessions).post(create_overlay_session))
        .route("/api/ui-runtime-overlay/sessions/{id}/close", post(close_overlay_session))
        .route("/api/ui-runtime-overlay/sessions/{id}/observations", post(add_observation))
        .route("/api/ui-runtime-overlay/sessions/{id}/annotations", post(add_annotation))
        .route("/api/ui-runtime-overlay/sessions/{id}/change-requests", post(add_change_request))
        .route("/api/ui-runtime-overlay/sessions/{id}/change-requests/{cr_id}/queue", post(queue_change_request))
        .route("/api/ui-runtime-overlay/sessions/{id}/change-requests/{cr_id}/release", post(release_change_request))
        .with_state(state)
}

// ── Stubs ────────────────────────────────────────────────────────────────────

/// GET /api/ui-runtime-overlay/sessions
async fn list_overlay_sessions() -> Json<serde_json::Value> {
    Json(serde_json::json!({"sessions": [], "stub": true}))
}

/// POST /api/ui-runtime-overlay/sessions
async fn create_overlay_session() -> Json<serde_json::Value> {
    Json(serde_json::json!({"ok": true, "stub": true}))
}

/// POST /api/ui-runtime-overlay/sessions/{id}/close
async fn close_overlay_session() -> Json<serde_json::Value> {
    Json(serde_json::json!({"ok": true, "stub": true}))
}

/// POST /api/ui-runtime-overlay/sessions/{id}/observations
async fn add_observation() -> Json<serde_json::Value> {
    Json(serde_json::json!({"ok": true, "stub": true}))
}

/// POST /api/ui-runtime-overlay/sessions/{id}/annotations
async fn add_annotation() -> Json<serde_json::Value> {
    Json(serde_json::json!({"ok": true, "stub": true}))
}

/// POST /api/ui-runtime-overlay/sessions/{id}/change-requests
async fn add_change_request() -> Json<serde_json::Value> {
    Json(serde_json::json!({"ok": true, "stub": true}))
}

/// POST /api/ui-runtime-overlay/sessions/{id}/change-requests/{cr_id}/queue
async fn queue_change_request() -> Json<serde_json::Value> {
    Json(serde_json::json!({"ok": true, "stub": true}))
}

/// POST /api/ui-runtime-overlay/sessions/{id}/change-requests/{cr_id}/release
async fn release_change_request() -> Json<serde_json::Value> {
    Json(serde_json::json!({"ok": true, "stub": true}))
}
