use axum::{Router, routing::get, Json};
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

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/desktop-updater", get(updater_status))
        .with_state(state)
}
