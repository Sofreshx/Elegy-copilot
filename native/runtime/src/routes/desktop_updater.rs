use axum::{Router, routing::{get, post}, Json};
use crate::app::AppState;

/// Stub for desktop-updater status endpoint.
/// Returns idle status with current version and no update available.
async fn updater_status() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "status": "idle",
        "currentVersion": env!("CARGO_PKG_VERSION"),
        "updateAvailable": false,
        "stub": true,
    }))
}

/// Stub for desktop-updater check endpoint.
async fn updater_check() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "ok": true, "stub": true }))
}

/// Stub for desktop-updater download endpoint.
async fn updater_download() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "ok": true, "stub": true }))
}

/// Stub for desktop-updater restart endpoint.
async fn updater_restart() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "ok": true, "stub": true }))
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/desktop-updater", get(updater_status))
        .route("/api/desktop-updater/check", post(updater_check))
        .route("/api/desktop-updater/download", post(updater_download))
        .route("/api/desktop-updater/restart", post(updater_restart))
        .with_state(state)
}
