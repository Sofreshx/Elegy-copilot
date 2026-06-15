use axum::extract::State;
use axum::routing::get;
use axum::{Json, Router};
use elegy_native_contracts::VersionResponse;

use crate::app::AppState;

async fn get_version(State(state): State<AppState>) -> Json<VersionResponse> {
    let version = state
        .version_state
        .lock()
        .map(|value| value.clone())
        .unwrap_or(VersionResponse {
            version: 0,
            last_changed_ms: None,
        });
    Json(version)
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/version", get(get_version))
        .with_state(state)
}
