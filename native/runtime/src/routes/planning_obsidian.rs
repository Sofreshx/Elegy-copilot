use axum::extract::{Path, State};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::json;

use crate::app::AppState;

/// GET /api/planning/obsidian/status — Obsidian vault connectivity status
async fn get_obsidian_status(
    State(_state): State<AppState>,
) -> Json<serde_json::Value> {
    Json(json!({
        "status": "disconnected",
        "stub": true
    }))
}

/// GET /api/planning/obsidian/notes — list all Obsidian planning notes
async fn list_obsidian_notes(
    State(_state): State<AppState>,
) -> Json<serde_json::Value> {
    Json(json!({
        "notes": [],
        "stub": true
    }))
}

/// GET /api/planning/obsidian/notes/{note_id} — get a single note by ID
async fn get_obsidian_note(
    State(_state): State<AppState>,
    Path(note_id): Path<String>,
) -> Json<serde_json::Value> {
    Json(json!({
        "note": {},
        "id": note_id,
        "stub": true
    }))
}

/// POST /api/planning/obsidian/sync — trigger manual Obsidian sync
async fn trigger_obsidian_sync(
    State(_state): State<AppState>,
) -> Json<serde_json::Value> {
    Json(json!({
        "ok": true,
        "stub": true
    }))
}

/// POST /api/planning/obsidian/source-selection — set active Obsidian source
async fn set_obsidian_source_selection(
    State(_state): State<AppState>,
) -> Json<serde_json::Value> {
    Json(json!({
        "ok": true,
        "stub": true
    }))
}

/// GET /api/planning/obsidian/representations/status — representation sync status
async fn get_obsidian_representation_status(
    State(_state): State<AppState>,
) -> Json<serde_json::Value> {
    Json(json!({
        "status": "idle",
        "stub": true
    }))
}

/// GET /api/planning/obsidian/representations — list planning representations
async fn list_obsidian_representations(
    State(_state): State<AppState>,
) -> Json<serde_json::Value> {
    Json(json!({
        "representations": [],
        "stub": true
    }))
}

/// POST /api/planning/obsidian/representations/refresh — refresh representations
async fn refresh_obsidian_representations(
    State(_state): State<AppState>,
) -> Json<serde_json::Value> {
    Json(json!({
        "ok": true,
        "stub": true
    }))
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/planning/obsidian/status", get(get_obsidian_status))
        .route("/api/planning/obsidian/notes", get(list_obsidian_notes))
        .route("/api/planning/obsidian/notes/{note_id}", get(get_obsidian_note))
        .route("/api/planning/obsidian/sync", post(trigger_obsidian_sync))
        .route("/api/planning/obsidian/source-selection", post(set_obsidian_source_selection))
        .route("/api/planning/obsidian/representations/status", get(get_obsidian_representation_status))
        .route("/api/planning/obsidian/representations", get(list_obsidian_representations))
        .route("/api/planning/obsidian/representations/refresh", post(refresh_obsidian_representations))
        .with_state(state)
}
