use axum::{Router, routing::post, Json};
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

/// Stub for updating elegy-planning tooling.
async fn update_elegy_planning() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "ok": true, "stub": true }))
}

/// Stub for updating elegy-skills tooling.
async fn update_elegy_skills() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "ok": true, "stub": true }))
}

/// Stub for updating elegy-skills-codex tooling.
async fn update_elegy_skills_codex() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "ok": true, "stub": true }))
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/tooling-updates/check", post(check_updates))
        .route("/api/tooling-updates/status", axum::routing::get(check_updates))
        .route("/api/tooling-updates/update/elegy-planning", post(update_elegy_planning))
        .route("/api/tooling-updates/update/elegy-skills", post(update_elegy_skills))
        .route("/api/tooling-updates/update/elegy-skills-codex", post(update_elegy_skills_codex))
        .with_state(state)
}
