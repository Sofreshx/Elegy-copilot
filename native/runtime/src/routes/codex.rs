use axum::extract::State;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::json;

use crate::app::AppState;

/// GET /api/codex/cli/status — check if Codex CLI is installed
async fn get_codex_cli_status(
    State(_state): State<AppState>,
) -> Json<serde_json::Value> {
    Json(json!({
        "installed": false,
        "stub": true
    }))
}

/// POST /api/codex/cli/install — install or update Codex CLI
async fn install_codex_cli(
    State(_state): State<AppState>,
) -> Json<serde_json::Value> {
    Json(json!({
        "ok": true,
        "stub": true
    }))
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/codex/cli/status", get(get_codex_cli_status))
        .route("/api/codex/cli/install", post(install_codex_cli))
        .with_state(state)
}
