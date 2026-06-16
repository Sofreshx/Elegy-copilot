use axum::extract::{Path, State};
use axum::routing::{get, post, put};
use axum::{Json, Router};
use serde_json::{json, Value};

use crate::app::AppState;

// ── OpenCode Status & Config (5 routes) ───────────────────────────────────────

/// GET /api/opencode/status
async fn opencode_status(
    State(_state): State<AppState>,
) -> Json<Value> {
    Json(json!({
        "status": "idle",
        "stub": true
    }))
}

/// POST /api/opencode/config
async fn opencode_config(
    State(_state): State<AppState>,
) -> Json<Value> {
    Json(json!({
        "ok": true,
        "stub": true
    }))
}

/// POST /api/opencode/prompts
async fn opencode_prompts(
    State(_state): State<AppState>,
) -> Json<Value> {
    Json(json!({
        "ok": true,
        "stub": true
    }))
}

/// GET /api/opencode/prompts/effective
async fn opencode_prompts_effective(
    State(_state): State<AppState>,
) -> Json<Value> {
    Json(json!({
        "prompts": [],
        "stub": true
    }))
}

/// POST /api/opencode/config/key
async fn opencode_config_key(
    State(_state): State<AppState>,
) -> Json<Value> {
    Json(json!({
        "ok": true,
        "stub": true
    }))
}

// ── OpenCode Config Reset & Assets (3 routes) ─────────────────────────────────

/// POST /api/opencode/config/reset
async fn opencode_config_reset(
    State(_state): State<AppState>,
) -> Json<Value> {
    Json(json!({
        "ok": true,
        "stub": true
    }))
}

/// POST /api/opencode/assets/install
async fn opencode_assets_install(
    State(_state): State<AppState>,
) -> Json<Value> {
    Json(json!({
        "ok": true,
        "stub": true
    }))
}

/// POST /api/opencode/tooling/install
async fn opencode_tooling_install(
    State(_state): State<AppState>,
) -> Json<Value> {
    Json(json!({
        "ok": true,
        "stub": true
    }))
}

// ── CLI, Logs, Permissions (4 routes) ─────────────────────────────────────────

/// POST /api/opencode/cli/install
async fn opencode_cli_install(
    State(_state): State<AppState>,
) -> Json<Value> {
    Json(json!({
        "ok": true,
        "stub": true
    }))
}

/// GET /api/opencode/logs/requests
async fn opencode_logs_requests(
    State(_state): State<AppState>,
) -> Json<Value> {
    Json(json!({
        "requests": [],
        "stub": true
    }))
}

/// GET /api/opencode/permissions
async fn opencode_permissions_get(
    State(_state): State<AppState>,
) -> Json<Value> {
    Json(json!({
        "permissions": [],
        "stub": true
    }))
}

/// POST /api/opencode/permissions
async fn opencode_permissions_set(
    State(_state): State<AppState>,
) -> Json<Value> {
    Json(json!({
        "ok": true,
        "stub": true
    }))
}

// ── Go Workspaces (8 routes) ──────────────────────────────────────────────────

/// GET /api/opencode/go-workspaces
async fn opencode_go_workspaces_list(
    State(_state): State<AppState>,
) -> Json<Value> {
    Json(json!({
        "workspaces": [],
        "stub": true
    }))
}

/// POST /api/opencode/go-workspaces
async fn opencode_go_workspaces_create(
    State(_state): State<AppState>,
) -> Json<Value> {
    Json(json!({
        "ok": true,
        "stub": true
    }))
}

/// POST /api/opencode/go-workspaces/create-flow
async fn opencode_go_workspaces_create_flow(
    State(_state): State<AppState>,
) -> Json<Value> {
    Json(json!({
        "ok": true,
        "stub": true
    }))
}

/// POST /api/opencode/go-workspaces/{id}/activate
async fn opencode_go_workspaces_activate(
    State(_state): State<AppState>,
    Path(_id): Path<String>,
) -> Json<Value> {
    Json(json!({
        "ok": true,
        "stub": true
    }))
}

/// POST /api/opencode/go-workspaces/{id}/validate
async fn opencode_go_workspaces_validate(
    State(_state): State<AppState>,
    Path(_id): Path<String>,
) -> Json<Value> {
    Json(json!({
        "ok": true,
        "stub": true
    }))
}

/// PUT /api/opencode/go-workspaces/{id}
async fn opencode_go_workspaces_update(
    State(_state): State<AppState>,
    Path(_id): Path<String>,
) -> Json<Value> {
    Json(json!({
        "ok": true,
        "stub": true
    }))
}

/// DELETE /api/opencode/go-workspaces/{id}
async fn opencode_go_workspaces_delete(
    State(_state): State<AppState>,
    Path(_id): Path<String>,
) -> Json<Value> {
    Json(json!({
        "ok": true,
        "stub": true
    }))
}

// ── Cross-cutting (2 routes) ──────────────────────────────────────────────────

/// GET /api/codex-planning-status
async fn codex_planning_status(
    State(_state): State<AppState>,
) -> Json<Value> {
    Json(json!({
        "status": "idle",
        "stub": true
    }))
}

/// GET /api/stats/provider-usage
async fn provider_usage(
    State(_state): State<AppState>,
) -> Json<Value> {
    Json(json!({
        "usage": {},
        "stub": true
    }))
}

// ── Router ─────────────────────────────────────────────────────────────────────

pub fn router(state: AppState) -> Router {
    Router::new()
        // OpenCode Status & Config
        .route("/api/opencode/status", get(opencode_status))
        .route("/api/opencode/config", post(opencode_config))
        .route("/api/opencode/prompts", post(opencode_prompts))
        .route("/api/opencode/prompts/effective", get(opencode_prompts_effective))
        .route("/api/opencode/config/key", post(opencode_config_key))
        // OpenCode Config Reset & Assets
        .route("/api/opencode/config/reset", post(opencode_config_reset))
        .route("/api/opencode/assets/install", post(opencode_assets_install))
        .route("/api/opencode/tooling/install", post(opencode_tooling_install))
        // CLI, Logs, Permissions
        .route("/api/opencode/cli/install", post(opencode_cli_install))
        .route("/api/opencode/logs/requests", get(opencode_logs_requests))
        .route("/api/opencode/permissions", get(opencode_permissions_get).post(opencode_permissions_set))
        // Go Workspaces — ordering matters: literal paths before {id} paths
        .route("/api/opencode/go-workspaces", get(opencode_go_workspaces_list).post(opencode_go_workspaces_create))
        .route("/api/opencode/go-workspaces/create-flow", post(opencode_go_workspaces_create_flow))
        .route("/api/opencode/go-workspaces/{id}/activate", post(opencode_go_workspaces_activate))
        .route("/api/opencode/go-workspaces/{id}/validate", post(opencode_go_workspaces_validate))
        .route("/api/opencode/go-workspaces/{id}", put(opencode_go_workspaces_update).delete(opencode_go_workspaces_delete))
        // Cross-cutting
        .route("/api/codex-planning-status", get(codex_planning_status))
        .route("/api/stats/provider-usage", get(provider_usage))
        .with_state(state)
}
