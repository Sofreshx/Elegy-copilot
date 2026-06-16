use axum::{
    Router, routing::get,
    extract::{State, Path},
    Json,
};
use std::collections::HashSet;
use crate::app::AppState;
use crate::sessions;
use crate::error::ApiError;

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/sessions", get(list_sessions))
        .route("/api/sessions/unified", get(unified_sessions))
        .route("/api/sessions/{id}/events", get(read_events))
        .route("/api/sessions/{id}/plan", get(read_plan))
        .route("/api/sessions/{id}/archive", axum::routing::post(archive_session))
        .route("/api/sessions/{id}/delete", axum::routing::post(delete_session))
        .with_state(state)
}

/// GET /api/sessions — list all sessions
async fn list_sessions(
    State(state): State<AppState>,
) -> Json<serde_json::Value> {
    let sessions = sessions::list_sessions(&state.config.elegy_home);
    let result: Vec<serde_json::Value> = sessions.iter().map(|s| {
        serde_json::json!({
            "id": s.id,
            "storageId": s.storage_id,
            "repo": s.repo,
            "repoId": s.repo_id,
            "projectId": s.project_id,
            "branch": s.branch,
            "cwd": s.cwd,
            "startTime": s.start_time,
            "lastEventTime": s.last_event_time,
            "status": s.status,
        })
    }).collect();
    Json(serde_json::Value::Array(result))
}

/// GET /api/sessions/unified — merge sessions from both elegy_home and sandboxes_home
async fn unified_sessions(
    State(state): State<AppState>,
) -> Json<serde_json::Value> {
    let sessions_list = sessions::list_sessions(&state.config.sandboxes_home);
    let copilot_sessions = sessions::list_sessions(&state.config.elegy_home);
    let mut seen: HashSet<&str> = HashSet::new();
    let mut result = Vec::new();
    for s in copilot_sessions.iter().chain(sessions_list.iter()) {
        if seen.insert(&s.id) {
            result.push(serde_json::json!({
                "id": s.id,
                "storageId": s.storage_id,
                "repo": s.repo,
                "repoId": s.repo_id,
                "status": s.status,
                "source": "copilot",
                "startTime": s.start_time,
                "lastEventTime": s.last_event_time,
            }));
        }
    }
    Json(serde_json::json!({ "sessions": result, "count": result.len() }))
}

/// GET /api/sessions/:id/events — read recent events
async fn read_events(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    if !is_valid_session_id(&id) {
        return Err(ApiError::BadRequest("Invalid session ID".into()));
    }
    let dir = state.config.elegy_home.join("session-state").join(&id);
    if !dir.exists() {
        return Err(ApiError::NotFound(format!("Session not found: {}", id)));
    }
    let events_path = dir.join("events.jsonl");
    let events = sessions::read_recent_events(&events_path, 50);
    Ok(Json(serde_json::json!({ "events": events })))
}

/// GET /api/sessions/:id/plan — read plan.md
async fn read_plan(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    if !is_valid_session_id(&id) {
        return Err(ApiError::BadRequest("Invalid session ID".into()));
    }
    let plan_path = state.config.elegy_home.join("session-state").join(&id).join("plan.md");
    if !plan_path.exists() {
        return Err(ApiError::NotFound("No plan found for session".into()));
    }
    let content = std::fs::read_to_string(&plan_path)
        .map_err(|e| ApiError::Internal(e.into()))?;
    Ok(Json(serde_json::json!({ "content": content })))
}

/// POST /api/sessions/:id/archive — archive session to sessions-archive/
async fn archive_session(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    if !is_valid_session_id(&id) {
        return Err(ApiError::BadRequest("Invalid session ID".into()));
    }
    let src = state.config.elegy_home.join("session-state").join(&id);
    if !src.exists() {
        return Err(ApiError::NotFound(format!("Session not found: {}", id)));
    }
    let archive_dir = state.config.elegy_home.join("sessions-archive");
    std::fs::create_dir_all(&archive_dir).map_err(|e| ApiError::Internal(e.into()))?;
    let dst = archive_dir.join(&id);
    std::fs::rename(&src, &dst).map_err(|e| ApiError::Internal(e.into()))?;
    Ok(Json(serde_json::json!({ "ok": true, "archived": id })))
}

/// POST /api/sessions/:id/delete — delete session directory
async fn delete_session(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    if !is_valid_session_id(&id) {
        return Err(ApiError::BadRequest("Invalid session ID".into()));
    }
    let dir = state.config.elegy_home.join("session-state").join(&id);
    if !dir.exists() {
        return Err(ApiError::NotFound(format!("Session not found: {}", id)));
    }
    std::fs::remove_dir_all(&dir).map_err(|e| ApiError::Internal(e.into()))?;
    Ok(Json(serde_json::json!({ "ok": true, "deleted": id })))
}

fn is_valid_session_id(id: &str) -> bool {
    // Match Node.js: alphanumeric + hyphens, max 256, no path traversal
    id.len() <= 256
        && !id.contains("..")
        && !id.contains('/')
        && !id.contains('\\')
        && id.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_')
}
