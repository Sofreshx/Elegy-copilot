use axum::{Router, routing::get, extract::State, Json};
use crate::app::AppState;
use crate::config_service::ConfigService;

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/config/remote-sessions", get(get_remote_sessions).put(set_remote_sessions))
        .with_state(state)
}

async fn get_remote_sessions(State(state): State<AppState>) -> Json<serde_json::Value> {
    let svc = ConfigService::new(&state.config.elegy_home);
    Json(serde_json::json!({"enabled": svc.get_remote_sessions()}))
}

async fn set_remote_sessions(
    State(state): State<AppState>,
    Json(body): Json<serde_json::Value>,
) -> Json<serde_json::Value> {
    let svc = ConfigService::new(&state.config.elegy_home);
    let enabled = body["enabled"].as_bool().unwrap_or(false);
    match svc.set_remote_sessions(enabled) {
        Ok(()) => Json(serde_json::json!({"ok": true})),
        Err(e) => Json(serde_json::json!({"ok": false, "error": e})),
    }
}
