use axum::routing::{get, post, put};
use axum::{Json, Router};
use serde_json::Value;

use crate::app::AppState;

// ---------------------------------------------------------------------------
// ClaudeCode route stubs
//
// These are stubs for the Claude Code integration endpoints. Real
// implementations will interact with the ~/.claude directory, CLI install
// tooling, and provider configuration logic.
// ---------------------------------------------------------------------------

async fn status() -> Json<Value> {
    Json(serde_json::json!({"status": "unavailable", "stub": true}))
}

async fn cli_install() -> Json<Value> {
    Json(serde_json::json!({"ok": true, "stub": true}))
}

async fn provider_get() -> Json<Value> {
    Json(serde_json::json!({"provider": null, "stub": true}))
}

async fn provider_set() -> Json<Value> {
    Json(serde_json::json!({"ok": true, "stub": true}))
}

async fn provider_reset() -> Json<Value> {
    Json(serde_json::json!({"ok": true, "stub": true}))
}

async fn deepseek_key_set() -> Json<Value> {
    Json(serde_json::json!({"ok": true, "stub": true}))
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/claude-code/status", get(status))
        .route("/api/claude-code/cli/install", post(cli_install))
        .route(
            "/api/claude-code/provider",
            get(provider_get).put(provider_set),
        )
        .route("/api/claude-code/provider/reset", post(provider_reset))
        .route(
            "/api/claude-code/provider/deepseek-key",
            put(deepseek_key_set),
        )
        .with_state(state)
}
