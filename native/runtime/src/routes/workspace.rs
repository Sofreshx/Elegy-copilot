use axum::extract::{Path, State};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::{json, Value};

use crate::app::AppState;
use crate::error::ApiError;

// ── GET /api/workspace/commands ──────────────────────────────────────────────

/// List available workspace commands.
///
/// Stub: returns empty commands list.
async fn list_commands(
    State(_state): State<AppState>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({
        "commands": [],
        "stub": true
    })))
}

// ── POST /api/workspace/commands/run ─────────────────────────────────────────

/// Run a workspace command.
///
/// Stub: acknowledges the command request and returns success.
async fn run_command(
    State(_state): State<AppState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    tracing::debug!("workspace command run request: {:?}", body);
    Ok(Json(json!({
        "ok": true,
        "stub": true
    })))
}

// ── GET /api/workspace/launchers ─────────────────────────────────────────────

/// List available launchers.
///
/// Stub: returns empty launchers list.
async fn list_launchers(
    State(_state): State<AppState>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({
        "launchers": [],
        "stub": true
    })))
}

// ── POST /api/workspace/launch ───────────────────────────────────────────────

/// Launch an application via a launcher.
///
/// Stub: acknowledges the launch request and returns success.
async fn launch(
    State(_state): State<AppState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    tracing::debug!("workspace launch request: {:?}", body);
    Ok(Json(json!({
        "ok": true,
        "stub": true
    })))
}

// ── GET /api/workspace/pinned-commands ──────────────────────────────────────

/// List pinned commands.
///
/// Stub: returns empty pinned commands list.
async fn list_pinned_commands(
    State(_state): State<AppState>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({
        "pinnedCommands": [],
        "stub": true
    })))
}

// ── POST /api/workspace/pinned-commands ─────────────────────────────────────

/// Add a command to the pinned list.
///
/// Stub: acknowledges the pin request and returns success.
async fn create_pinned_command(
    State(_state): State<AppState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    tracing::debug!("workspace create pinned command: {:?}", body);
    Ok(Json(json!({
        "ok": true,
        "stub": true
    })))
}

// ── DELETE /api/workspace/pinned-commands/{id} ─────────────────────────────

/// Remove a command from the pinned list.
///
/// Stub: acknowledges the removal request and returns success.
async fn delete_pinned_command(
    State(_state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    tracing::debug!("workspace delete pinned command: {}", id);
    Ok(Json(json!({
        "ok": true,
        "stub": true
    })))
}

// ── Router ───────────────────────────────────────────────────────────────────

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/workspace/commands", get(list_commands))
        .route("/api/workspace/commands/run", post(run_command))
        .route("/api/workspace/launchers", get(list_launchers))
        .route("/api/workspace/launch", post(launch))
        .route(
            "/api/workspace/pinned-commands",
            get(list_pinned_commands).post(create_pinned_command),
        )
        .route(
            "/api/workspace/pinned-commands/{id}",
            axum::routing::delete(delete_pinned_command),
        )
        .with_state(state)
}
