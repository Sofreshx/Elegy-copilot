use axum::extract::{Path, Query, State};
use axum::routing::get;
use axum::{Json, Router};
use rusqlite::Connection;
use serde::Deserialize;

use crate::app::AppState;
use crate::error::ApiError;

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

/// Open the elegoy-copilot.db read-only.
fn open_db(state: &AppState) -> Result<Connection, ApiError> {
    let db_path = state.config.elegy_home.join("elegy-copilot.db");
    Connection::open(&db_path).map_err(|e| ApiError::Internal(e.into()))
}

/// Convert snake_case to camelCase.
fn snake_to_camel(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    let mut upper = false;
    for c in s.chars() {
        if c == '_' {
            upper = true;
        } else if upper {
            result.push(c.to_ascii_uppercase());
            upper = false;
        } else {
            result.push(c);
        }
    }
    result
}

/// Convert a rusqlite Row to a JSON object using column names, converting to camelCase.
fn row_to_json(row: &rusqlite::Row, column_names: &[String]) -> serde_json::Value {
    let mut map = serde_json::Map::new();
    for (i, name) in column_names.iter().enumerate() {
        let camel = snake_to_camel(name);
        let value: Option<String> = row.get(i).ok();
        if let Some(v) = value {
            map.insert(camel, serde_json::Value::String(v));
        }
    }
    serde_json::Value::Object(map)
}

/// Run a query returning all rows as JSON values (no parameters).
fn query_all(db: &Connection, sql: &str) -> Result<Vec<serde_json::Value>, ApiError> {
    let mut stmt = db.prepare(sql).map_err(|e| ApiError::Internal(e.into()))?;
    let column_names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let rows = stmt
        .query_map([], |row| Ok(row_to_json(row, &column_names)))
        .map_err(|e| ApiError::Internal(e.into()))?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|e| ApiError::Internal(e.into()))?);
    }
    Ok(result)
}

// ---------------------------------------------------------------------------
// Query param types
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct PaginationParams {
    page: Option<u64>,
    page_size: Option<u64>,
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/// GET /api/elegy-db/health
async fn get_health(State(state): State<AppState>) -> Result<Json<serde_json::Value>, ApiError> {
    let db = open_db(&state)?;
    let table_count: i64 = db
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE type='table'",
            [],
            |row| row.get(0),
        )
        .map_err(|e| ApiError::Internal(e.into()))?;
    let db_path = state.config.elegy_home.join("elegy-copilot.db");
    Ok(Json(serde_json::json!({
        "ok": true,
        "tableCount": table_count,
        "dbPath": db_path.display().to_string(),
        "stub": false,
    })))
}

/// GET /api/elegy-db/sessions
async fn list_sessions(State(state): State<AppState>) -> Result<Json<serde_json::Value>, ApiError> {
    let db = open_db(&state)?;
    let sessions = query_all(&db, "SELECT * FROM sessions ORDER BY updated_at DESC")?;
    Ok(Json(serde_json::json!({
        "sessions": sessions,
        "count": sessions.len(),
    })))
}

/// GET /api/elegy-db/sessions/{session_id}
async fn get_session(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let db = open_db(&state)?;
    let mut stmt = db
        .prepare("SELECT * FROM sessions WHERE id = ?1")
        .map_err(|e| ApiError::Internal(e.into()))?;
    let column_names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let session = stmt
        .query_row([&session_id], |row| Ok(row_to_json(row, &column_names)))
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                ApiError::NotFound(format!("Session not found: {}", session_id))
            }
            other => ApiError::Internal(other.into()),
        })?;
    Ok(Json(session))
}

/// GET /api/elegy-db/worktrees
async fn list_worktrees(State(state): State<AppState>) -> Result<Json<serde_json::Value>, ApiError> {
    let db = open_db(&state)?;
    let worktrees = query_all(&db, "SELECT * FROM worktrees ORDER BY updated_at DESC")?;
    Ok(Json(serde_json::json!({
        "worktrees": worktrees,
        "count": worktrees.len(),
    })))
}

/// GET /api/elegy-db/worktrees/session-status
async fn worktrees_session_status(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let db = open_db(&state)?;
    let mut stmt = db
        .prepare("SELECT session_id, status, COUNT(*) as count FROM worktrees GROUP BY session_id, status")
        .map_err(|e| ApiError::Internal(e.into()))?;
    let rows = stmt
        .query_map([], |row| {
            let session_id: Option<String> = row.get(0).ok();
            let status: Option<String> = row.get(1).ok();
            let count: i64 = row.get(2).unwrap_or(0);
            Ok(serde_json::json!({
                "sessionId": session_id,
                "status": status,
                "count": count,
            }))
        })
        .map_err(|e| ApiError::Internal(e.into()))?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|e| ApiError::Internal(e.into()))?);
    }
    Ok(Json(serde_json::json!({ "sessionStatus": result })))
}

/// GET /api/elegy-db/worktrees/enriched
async fn list_enriched_worktrees(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let db = open_db(&state)?;
    let mut stmt = db
        .prepare(
            "SELECT w.*, s.repo as session_repo, s.branch as session_branch \
             FROM worktrees w LEFT JOIN sessions s ON w.session_id = s.id \
             ORDER BY w.updated_at DESC",
        )
        .map_err(|e| ApiError::Internal(e.into()))?;
    let column_names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let rows = stmt
        .query_map([], |row| Ok(row_to_json(row, &column_names)))
        .map_err(|e| ApiError::Internal(e.into()))?;
    let mut worktrees = Vec::new();
    for row in rows {
        worktrees.push(row.map_err(|e| ApiError::Internal(e.into()))?);
    }
    Ok(Json(serde_json::json!({
        "worktrees": worktrees,
        "count": worktrees.len(),
    })))
}

/// GET /api/elegy-db/worktrees/enriched/{worktree_id}/branches
async fn worktree_branches(
    State(state): State<AppState>,
    Path(worktree_id): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let db = open_db(&state)?;
    let mut stmt = db
        .prepare(
            "SELECT branch FROM worktrees \
             WHERE repo_id = (SELECT repo_id FROM worktrees WHERE id = ?1) \
             AND id != ?1",
        )
        .map_err(|e| ApiError::Internal(e.into()))?;
    let rows = stmt
        .query_map([&worktree_id], |row| {
            let branch: Option<String> = row.get(0).ok();
            Ok(branch)
        })
        .map_err(|e| ApiError::Internal(e.into()))?;
    let mut branches = Vec::new();
    for row in rows {
        if let Some(branch) = row.map_err(|e| ApiError::Internal(e.into()))? {
            branches.push(serde_json::Value::String(branch));
        }
    }
    Ok(Json(serde_json::json!({ "branches": branches })))
}

/// GET /api/elegy-db/hook-events
async fn list_hook_events(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let db = open_db(&state)?;
    let events = query_all(&db, "SELECT * FROM hook_events ORDER BY created_at DESC LIMIT 100")?;
    Ok(Json(serde_json::json!({
        "hookEvents": events,
        "count": events.len(),
    })))
}

/// GET /api/elegy-db/hook-events/{event_id}
async fn get_hook_event(
    State(state): State<AppState>,
    Path(event_id): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let db = open_db(&state)?;
    let mut stmt = db
        .prepare("SELECT * FROM hook_events WHERE id = ?1")
        .map_err(|e| ApiError::Internal(e.into()))?;
    let column_names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let event = stmt
        .query_row([&event_id], |row| Ok(row_to_json(row, &column_names)))
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                ApiError::NotFound(format!("Hook event not found: {}", event_id))
            }
            other => ApiError::Internal(other.into()),
        })?;
    Ok(Json(event))
}

/// GET /api/elegy-db/paginated
async fn list_entity_types(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let db = open_db(&state)?;
    let mut stmt = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .map_err(|e| ApiError::Internal(e.into()))?;
    let rows = stmt
        .query_map([], |row| {
            let name: String = row.get(0)?;
            Ok(name)
        })
        .map_err(|e| ApiError::Internal(e.into()))?;
    let mut entity_types = Vec::new();
    for row in rows {
        entity_types.push(serde_json::Value::String(
            row.map_err(|e| ApiError::Internal(e.into()))?,
        ));
    }
    Ok(Json(serde_json::json!({ "entityTypes": entity_types })))
}

/// GET /api/elegy-db/paginated/{entity_type}
async fn list_entities_paginated(
    State(state): State<AppState>,
    Path(entity_type): Path<String>,
    Query(params): Query<PaginationParams>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let db = open_db(&state)?;

    // Validate entity type against sqlite_master to prevent SQL injection
    let valid: bool = db
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name = ?1",
            [&entity_type],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|e| ApiError::Internal(e.into()))?
        > 0;
    if !valid {
        return Err(ApiError::NotFound(format!(
            "Unknown entity type: {}",
            entity_type
        )));
    }

    let page = params.page.unwrap_or(1).max(1);
    let page_size = params.page_size.unwrap_or(20).max(1).min(100);
    let offset = (page - 1) * page_size;

    // Get total count
    let count_query = format!("SELECT count(*) FROM \"{}\"", entity_type);
    let total: i64 = db
        .query_row(&count_query, [], |row| row.get(0))
        .map_err(|e| ApiError::Internal(e.into()))?;

    // Get paginated data
    let data_query = format!(
        "SELECT * FROM \"{}\" ORDER BY rowid DESC LIMIT ?1 OFFSET ?2",
        entity_type
    );
    let mut stmt = db
        .prepare(&data_query)
        .map_err(|e| ApiError::Internal(e.into()))?;
    let column_names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let rows = stmt
        .query_map(rusqlite::params![page_size as i64, offset as i64], |row| {
            Ok(row_to_json(row, &column_names))
        })
        .map_err(|e| ApiError::Internal(e.into()))?;
    let mut entities = Vec::new();
    for row in rows {
        entities.push(row.map_err(|e| ApiError::Internal(e.into()))?);
    }

    Ok(Json(serde_json::json!({
        "entities": entities,
        "total": total,
        "page": page,
        "pageSize": page_size,
    })))
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

/// Build the router for all /api/elegy-db/* routes.
pub fn router(state: AppState) -> Router {
    Router::new()
        // Health
        .route("/api/elegy-db/health", get(get_health))
        // Sessions
        .route("/api/elegy-db/sessions", get(list_sessions))
        .route("/api/elegy-db/sessions/{session_id}", get(get_session))
        // Worktrees — specific sub-routes precede parameterized routes
        .route("/api/elegy-db/worktrees", get(list_worktrees))
        .route(
            "/api/elegy-db/worktrees/session-status",
            get(worktrees_session_status),
        )
        .route(
            "/api/elegy-db/worktrees/enriched",
            get(list_enriched_worktrees),
        )
        .route(
            "/api/elegy-db/worktrees/enriched/{worktree_id}/branches",
            get(worktree_branches),
        )
        // Hook events
        .route("/api/elegy-db/hook-events", get(list_hook_events))
        .route("/api/elegy-db/hook-events/{event_id}", get(get_hook_event))
        // Paginated
        .route("/api/elegy-db/paginated", get(list_entity_types))
        .route(
            "/api/elegy-db/paginated/{entity_type}",
            get(list_entities_paginated),
        )
        .with_state(state)
}
