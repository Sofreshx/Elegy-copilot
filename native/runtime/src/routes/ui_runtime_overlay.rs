use axum::{Router, extract::{State, Path, Json as JsonExtract}, Json};
use axum::routing::{get, post};
use serde::Deserialize;
use std::path::PathBuf;
use crate::app::AppState;
use crate::error::ApiError;

// ── Types ────────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct CreateSessionBody {
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    label: Option<String>,
    #[serde(default)]
    repo_id: Option<String>,
}

#[derive(Deserialize)]
struct AppendBody {
    #[serde(default)]
    content: Option<serde_json::Value>,
    #[serde(default)]
    message: Option<String>,
    #[serde(default)]
    kind: Option<String>,
}

#[derive(Deserialize)]
struct ChangeRequestBody {
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    prompt: Option<String>,
    #[serde(default)]
    kind: Option<String>,
}

/// Router
pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/ui-runtime-overlay/sessions", get(list_overlay_sessions).post(create_overlay_session))
        .route("/api/ui-runtime-overlay/sessions/{id}/close", post(close_overlay_session))
        .route("/api/ui-runtime-overlay/sessions/{id}/observations", post(add_observation))
        .route("/api/ui-runtime-overlay/sessions/{id}/annotations", post(add_annotation))
        .route("/api/ui-runtime-overlay/sessions/{id}/change-requests", post(add_change_request))
        .route("/api/ui-runtime-overlay/sessions/{id}/change-requests/{cr_id}/queue", post(queue_change_request))
        .route("/api/ui-runtime-overlay/sessions/{id}/change-requests/{cr_id}/release", post(release_change_request))
        .with_state(state)
}

// ── Helpers ──────────────────────────────────────────────────────────────────

fn storage_dir(state: &AppState) -> PathBuf {
    state.config.elegy_home.join("ui-runtime-overlay")
}

fn session_path(state: &AppState, id: &str) -> PathBuf {
    storage_dir(state).join(format!("session_{}.json", id))
}

fn ensure_storage_dir(state: &AppState) -> Result<(), ApiError> {
    let dir = storage_dir(state);
    std::fs::create_dir_all(&dir).map_err(|e| ApiError::Internal(e.into()))
}

fn read_session(state: &AppState, id: &str) -> Result<serde_json::Value, ApiError> {
    let path = session_path(state, id);
    if !path.is_file() {
        return Err(ApiError::NotFound(format!("Session not found: {}", id)));
    }
    let content = std::fs::read_to_string(&path).map_err(|e| ApiError::Internal(e.into()))?;
    serde_json::from_str(&content).map_err(|e| ApiError::Internal(e.into()))
}

fn write_session(state: &AppState, id: &str, session: &serde_json::Value) -> Result<(), ApiError> {
    ensure_storage_dir(state)?;
    let path = session_path(state, id);
    let content = serde_json::to_string_pretty(session).map_err(|e| ApiError::Internal(e.into()))?;
    std::fs::write(&path, &content).map_err(|e| ApiError::Internal(e.into()))
}

// ── Route Handlers ───────────────────────────────────────────────────────────

/// GET /api/ui-runtime-overlay/sessions
/// List overlay sessions from storage dir
async fn list_overlay_sessions(
    State(state): State<AppState>,
) -> Json<serde_json::Value> {
    let dir = storage_dir(&state);
    let mut sessions = vec![];

    if dir.is_dir() {
        if let Ok(entries) = std::fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let fname = entry.file_name().to_string_lossy().to_string();
                if fname.starts_with("session_") && fname.ends_with(".json") {
                    let id = fname
                        .strip_prefix("session_")
                        .and_then(|s| s.strip_suffix(".json"))
                        .unwrap_or("")
                        .to_string();
                    if let Ok(content) = std::fs::read_to_string(&entry.path()) {
                        if let Ok(mut session) = serde_json::from_str::<serde_json::Value>(&content) {
                            if let Some(map) = session.as_object_mut() {
                                map.insert("id".to_string(), serde_json::json!(id));
                            }
                            sessions.push(session);
                        }
                    }
                }
            }
        }
    }

    Json(serde_json::json!({
        "sessions": sessions,
    }))
}

/// POST /api/ui-runtime-overlay/sessions
/// Create overlay session, write to dir
async fn create_overlay_session(
    State(state): State<AppState>,
    JsonExtract(body): JsonExtract<CreateSessionBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    ensure_storage_dir(&state)?;

    let id = body.id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let now = chrono::Utc::now().to_rfc3339();

    let session = serde_json::json!({
        "id": id,
        "label": body.label.unwrap_or_default(),
        "repoId": body.repo_id,
        "status": "open",
        "createdAt": now,
        "updatedAt": now,
        "observations": [],
        "annotations": [],
        "changeRequests": [],
    });

    write_session(&state, &id, &session)?;

    Ok(Json(serde_json::json!({
        "session": session,
    })))
}

/// POST /api/ui-runtime-overlay/sessions/{id}/close
/// Update session status to closed
async fn close_overlay_session(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let mut session = read_session(&state, &id)?;
    let now = chrono::Utc::now().to_rfc3339();

    if let Some(map) = session.as_object_mut() {
        map.insert("status".to_string(), serde_json::json!("closed"));
        map.insert("closedAt".to_string(), serde_json::json!(now));
        map.insert("updatedAt".to_string(), serde_json::json!(now));
    }

    write_session(&state, &id, &session)?;

    Ok(Json(serde_json::json!({
        "session": session,
    })))
}

/// POST /api/ui-runtime-overlay/sessions/{id}/observations
/// Append observation to session
async fn add_observation(
    State(state): State<AppState>,
    Path(id): Path<String>,
    JsonExtract(body): JsonExtract<AppendBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let mut session = read_session(&state, &id)?;
    let now = chrono::Utc::now().to_rfc3339();

    let observation = serde_json::json!({
        "id": uuid::Uuid::new_v4().to_string(),
        "content": body.content,
        "message": body.message,
        "timestamp": now,
    });

    if let Some(map) = session.as_object_mut() {
        if let Some(obs) = map.get_mut("observations").and_then(|o| o.as_array_mut()) {
            obs.push(observation.clone());
        }
        map.insert("updatedAt".to_string(), serde_json::json!(now));
    }

    write_session(&state, &id, &session)?;

    Ok(Json(serde_json::json!({
        "observation": observation,
    })))
}

/// POST /api/ui-runtime-overlay/sessions/{id}/annotations
/// Append annotation to session
async fn add_annotation(
    State(state): State<AppState>,
    Path(id): Path<String>,
    JsonExtract(body): JsonExtract<AppendBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let mut session = read_session(&state, &id)?;
    let now = chrono::Utc::now().to_rfc3339();

    let annotation = serde_json::json!({
        "id": uuid::Uuid::new_v4().to_string(),
        "content": body.content,
        "message": body.message,
        "timestamp": now,
    });

    if let Some(map) = session.as_object_mut() {
        if let Some(ann) = map.get_mut("annotations").and_then(|a| a.as_array_mut()) {
            ann.push(annotation.clone());
        }
        map.insert("updatedAt".to_string(), serde_json::json!(now));
    }

    write_session(&state, &id, &session)?;

    Ok(Json(serde_json::json!({
        "annotation": annotation,
    })))
}

/// POST /api/ui-runtime-overlay/sessions/{id}/change-requests
/// Append change request to session
async fn add_change_request(
    State(state): State<AppState>,
    Path(id): Path<String>,
    JsonExtract(body): JsonExtract<ChangeRequestBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let mut session = read_session(&state, &id)?;
    let now = chrono::Utc::now().to_rfc3339();
    let cr_id = uuid::Uuid::new_v4().to_string();

    let change_request = serde_json::json!({
        "id": cr_id,
        "title": body.title,
        "prompt": body.prompt,
        "kind": body.kind,
        "status": "draft",
        "createdAt": now,
        "updatedAt": now,
    });

    if let Some(map) = session.as_object_mut() {
        if let Some(crs) = map.get_mut("changeRequests").and_then(|c| c.as_array_mut()) {
            crs.push(change_request.clone());
        }
        map.insert("updatedAt".to_string(), serde_json::json!(now));
    }

    write_session(&state, &id, &session)?;

    Ok(Json(serde_json::json!({
        "changeRequest": change_request,
    })))
}

/// POST /api/ui-runtime-overlay/sessions/{id}/change-requests/{cr_id}/queue
/// Update CR status to queued
async fn queue_change_request(
    State(state): State<AppState>,
    Path((id, cr_id)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let mut session = read_session(&state, &id)?;
    let now = chrono::Utc::now().to_rfc3339();
    let mut updated = false;

    if let Some(map) = session.as_object_mut() {
        if let Some(crs) = map.get_mut("changeRequests").and_then(|c| c.as_array_mut()) {
            for cr in crs.iter_mut() {
                if cr["id"].as_str() == Some(&cr_id) {
                    if let Some(cr_map) = cr.as_object_mut() {
                        cr_map.insert("status".to_string(), serde_json::json!("queued"));
                        cr_map.insert("updatedAt".to_string(), serde_json::json!(now));
                    }
                    updated = true;
                    break;
                }
            }
        }
        map.insert("updatedAt".to_string(), serde_json::json!(now));
    }

    if !updated {
        return Err(ApiError::NotFound(format!("Change request not found: {}", cr_id)));
    }

    write_session(&state, &id, &session)?;

    Ok(Json(serde_json::json!({
        "ok": true,
        "changeRequestId": cr_id,
        "status": "queued",
    })))
}

/// POST /api/ui-runtime-overlay/sessions/{id}/change-requests/{cr_id}/release
/// Update CR status to released
async fn release_change_request(
    State(state): State<AppState>,
    Path((id, cr_id)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let mut session = read_session(&state, &id)?;
    let now = chrono::Utc::now().to_rfc3339();
    let mut updated = false;

    if let Some(map) = session.as_object_mut() {
        if let Some(crs) = map.get_mut("changeRequests").and_then(|c| c.as_array_mut()) {
            for cr in crs.iter_mut() {
                if cr["id"].as_str() == Some(&cr_id) {
                    if let Some(cr_map) = cr.as_object_mut() {
                        cr_map.insert("status".to_string(), serde_json::json!("released"));
                        cr_map.insert("updatedAt".to_string(), serde_json::json!(now));
                    }
                    updated = true;
                    break;
                }
            }
        }
        map.insert("updatedAt".to_string(), serde_json::json!(now));
    }

    if !updated {
        return Err(ApiError::NotFound(format!("Change request not found: {}", cr_id)));
    }

    write_session(&state, &id, &session)?;

    Ok(Json(serde_json::json!({
        "ok": true,
        "changeRequestId": cr_id,
        "status": "released",
    })))
}
