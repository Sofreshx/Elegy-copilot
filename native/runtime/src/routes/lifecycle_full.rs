use axum::extract::State;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::json;

use crate::app::AppState;

/// GET /api/lsp/config — read LSP config from elegy home
async fn get_lsp_config(
    State(_state): State<AppState>,
) -> Json<serde_json::Value> {
    Json(json!({
        "config": {},
        "stub": true
    }))
}

/// POST /api/lsp/install — run LSP install script from engine root
async fn install_lsp(
    State(_state): State<AppState>,
) -> Json<serde_json::Value> {
    Json(json!({
        "ok": true,
        "stub": true
    }))
}

/// POST /api/system/factory-reset — reset OpenCode and Codex configs
async fn factory_reset(
    State(_state): State<AppState>,
) -> Json<serde_json::Value> {
    Json(json!({
        "ok": true,
        "stub": true
    }))
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/lsp/config", get(get_lsp_config))
        .route("/api/lsp/install", post(install_lsp))
        .route("/api/system/factory-reset", post(factory_reset))
        .with_state(state)
}
