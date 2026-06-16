use axum::{Router, extract::{State, Query}, Json};
use axum::routing::{get, post};
use serde::Deserialize;
use crate::app::AppState;
use crate::error::ApiError;

#[derive(Deserialize)]
#[allow(dead_code)]
struct ChecksQuery {
    #[serde(rename = "repoPath")]
    repo_path: Option<String>,
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/git/checks/discover", get(checks_discover))
        .route("/api/git/checks/run", post(checks_run))
        .route("/api/git/checks/state", get(checks_state))
        .route("/api/git/checks/ci-sync", get(checks_ci_sync))
        .with_state(state)
}

// ── Stubs (GET routes with query params) ─────────────────────────────────────

/// GET /api/git/checks/discover?repoPath=...
async fn checks_discover(
    State(_state): State<AppState>,
    Query(_query): Query<ChecksQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    Ok(Json(serde_json::json!({"checks": [], "stub": true})))
}

/// GET /api/git/checks/state?repoPath=...
async fn checks_state(
    State(_state): State<AppState>,
    Query(_query): Query<ChecksQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    Ok(Json(serde_json::json!({"state": "unknown", "stub": true})))
}

/// GET /api/git/checks/ci-sync?repoPath=...
async fn checks_ci_sync(
    State(_state): State<AppState>,
    Query(_query): Query<ChecksQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    Ok(Json(serde_json::json!({"ciSync": {}, "stub": true})))
}

// ── Stub (POST route) ────────────────────────────────────────────────────────

/// POST /api/git/checks/run
async fn checks_run() -> Json<serde_json::Value> {
    Json(serde_json::json!({"ok": true, "stub": true}))
}
