use anyhow;
use axum::extract::{Path, Query, State};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;

use crate::app::AppState;
use crate::error::ApiError;
use crate::{db, persistence::{
    Persistence, PlanningRecordRow, PlanningSuggestionRow, PlanningRecapRow,
    WorkflowArtifactRow, CompareReceiptRow, MergeIntentRow,
}};

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

pub fn router(state: AppState) -> Router {
    Router::new()
        // Records
        .route("/api/planning/records", post(create_record).get(list_records))
        .route("/api/planning/records/{id}", axum::routing::patch(update_record))
        // Suggestions
        .route("/api/planning/suggestions", post(create_suggestion).get(read_suggestion))
        // Recaps
        .route("/api/planning/recaps", post(create_recap).get(read_recap))
        // Workflow artifacts
        .route("/api/planning/workflow-artifacts", post(create_artifact).get(read_artifact))
        // Compare receipts
        .route("/api/planning/compare", post(create_compare_receipt))
        // Merge intents
        .route("/api/planning/merge-intent", post(create_merge_intent))
        // Merge
        .route("/api/planning/merge", post(merge_records))
        // Persistence management
        .route("/api/planning/persistence/init", post(init_persistence))
        .route("/api/planning/persistence/retention", post(run_retention))
        // Search, session, explorer
        .route("/api/planning/search", get(search))
        .route("/api/planning/session", get(session))
        .route("/api/planning/explorer", get(explorer))
        // Persistence sub-routes
        .route("/api/planning/persistence/corruption/scan", post(corruption_scan))
        .route("/api/planning/persistence/export", post(export))
        .route("/api/planning/persistence/import", post(import))
        // Workflow artifacts sub-route
        .route("/api/planning/workflow-artifacts/continuation-package", get(continuation_package))
        .with_state(state)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Request body types
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateRecordBody {
    record_id: String,
    owner_id: String,
    repo_id: Option<String>,
    scope: String,
    state: serde_json::Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListRecordsQuery {
    owner_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateSuggestionBody {
    suggestion_id: String,
    actor_id: String,
    repo_id: Option<String>,
    scope: String,
    state: serde_json::Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadSuggestionQuery {
    suggestion_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateRecapBody {
    recap_id: String,
    actor_id: String,
    repo_id: Option<String>,
    scope: String,
    state: serde_json::Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadRecapQuery {
    recap_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateArtifactBody {
    artifact_id: String,
    actor_id: String,
    repo_id: Option<String>,
    roadmap_id: String,
    slice_id: Option<String>,
    kind: String,
    phase: String,
    status: String,
    checksum: String,
    source_harness: Option<String>,
    source_model: Option<String>,
    session_id: Option<String>,
    body: String,
    structured_state: serde_json::Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadArtifactQuery {
    artifact_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateCompareReceiptBody {
    receipt_id: String,
    actor_id: String,
    repo_id: Option<String>,
    compare_hash: String,
    source_ids_hash: String,
    source_ids: serde_json::Value,
    version_vector: Option<serde_json::Value>,
    gate_state: String,
    merge_eligible: bool,
    reason: String,
    downgrade: Option<serde_json::Value>,
    issued_at: String,
    expires_at: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateMergeIntentBody {
    token_id: String,
    compare_receipt_id: String,
    actor_id: String,
    repo_id: Option<String>,
    target_id: String,
    source_ids_hash: String,
    compare_hash: String,
    version_vector: Option<serde_json::Value>,
    version_vector_hash: Option<String>,
    issued_at: String,
    expires_at: String,
    consumed_at: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
struct MergeRecordsBody {
    target_id: String,
    source_ids: Vec<String>,
    actor_id: String,
    repo_id: Option<String>,
    scope: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RetentionBody {
    older_than_days: u64,
    dry_run: Option<bool>,
}

// ---------------------------------------------------------------------------
// Request body types for new handlers
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchQuery {
    q: String,
    owner_id: Option<String>,
    #[serde(default = "default_limit")]
    limit: u32,
}

fn default_limit() -> u32 {
    20
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportBody {
    owner_id: String,
    #[serde(default)]
    include: Option<Vec<String>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportBody {
    data: ImportData,
    owner_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportData {
    #[serde(default)]
    records: Vec<serde_json::Value>,
    #[serde(default)]
    suggestions: Vec<serde_json::Value>,
    #[serde(default)]
    recaps: Vec<serde_json::Value>,
    #[serde(default)]
    artifacts: Vec<serde_json::Value>,
}

// ---------------------------------------------------------------------------
// Handlers — Records
// ---------------------------------------------------------------------------

async fn create_record(
    State(state): State<AppState>,
    Json(body): Json<CreateRecordBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let db = state.planning_pool.get().map_err(|e| ApiError::Internal(anyhow::anyhow!("{}: {}", "planning pool exhausted", e)))?;
    let p = Persistence::new(&db);
    let now = chrono::Utc::now().to_rfc3339();
    match p.persist_planning_record(
        &body.record_id,
        &body.owner_id,
        body.repo_id.as_deref(),
        &body.scope,
        &body.state,
        &now,
        &now,
    ) {
        Ok(row) => Ok(Json(serde_json::json!({ "ok": true, "record": record_row_to_value(&row) }))),
        Err(e) => Ok(Json(serde_json::json!({ "ok": false, "error": { "code": e.code, "reason": e.reason } }))),
    }
}

async fn list_records(
    State(state): State<AppState>,
    Query(query): Query<ListRecordsQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let db = state.planning_pool.get().map_err(|e| ApiError::Internal(anyhow::anyhow!("{}: {}", "planning pool exhausted", e)))?;
    let p = Persistence::new(&db);
    match p.list_planning_records(&query.owner_id) {
        Ok(records) => Ok(Json(serde_json::json!({
            "records": records.iter().map(record_row_to_value).collect::<Vec<_>>()
        }))),
        Err(e) => Ok(Json(serde_json::json!({ "ok": false, "error": { "code": e.code, "reason": e.reason } }))),
    }
}

async fn update_record(
    State(state): State<AppState>,
    Path(record_id): Path<String>,
    Json(body): Json<CreateRecordBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let db = state.planning_pool.get().map_err(|e| ApiError::Internal(anyhow::anyhow!("{}: {}", "planning pool exhausted", e)))?;
    let p = Persistence::new(&db);
    let now = chrono::Utc::now().to_rfc3339();
    // Use the path parameter as the record_id, ignore body.record_id
    match p.persist_planning_record(
        &record_id,
        &body.owner_id,
        body.repo_id.as_deref(),
        &body.scope,
        &body.state,
        &now,
        &now,
    ) {
        Ok(row) => Ok(Json(serde_json::json!({ "ok": true, "record": record_row_to_value(&row) }))),
        Err(e) => Ok(Json(serde_json::json!({ "ok": false, "error": { "code": e.code, "reason": e.reason } }))),
    }
}

// ---------------------------------------------------------------------------
// Handlers — Suggestions
// ---------------------------------------------------------------------------

async fn create_suggestion(
    State(state): State<AppState>,
    Json(body): Json<CreateSuggestionBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let db = state.planning_pool.get().map_err(|e| ApiError::Internal(anyhow::anyhow!("{}: {}", "planning pool exhausted", e)))?;
    let p = Persistence::new(&db);
    let now = chrono::Utc::now().to_rfc3339();
    match p.persist_planning_suggestion(
        &body.suggestion_id,
        &body.actor_id,
        body.repo_id.as_deref(),
        &body.scope,
        &body.state,
        &now,
        &now,
    ) {
        Ok(row) => Ok(Json(serde_json::json!({ "ok": true, "suggestion": suggestion_row_to_value(&row) }))),
        Err(e) => Ok(Json(serde_json::json!({ "ok": false, "error": { "code": e.code, "reason": e.reason } }))),
    }
}

async fn read_suggestion(
    State(state): State<AppState>,
    Query(query): Query<ReadSuggestionQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let db = state.planning_pool.get().map_err(|e| ApiError::Internal(anyhow::anyhow!("{}: {}", "planning pool exhausted", e)))?;
    let p = Persistence::new(&db);
    match p.read_planning_suggestion(&query.suggestion_id) {
        Ok(Some(row)) => Ok(Json(serde_json::json!({ "ok": true, "suggestion": suggestion_row_to_value(&row) }))),
        Ok(None) => Ok(Json(serde_json::json!({ "ok": false, "error": { "code": "not_found", "reason": "suggestion_not_found" } }))),
        Err(e) => Ok(Json(serde_json::json!({ "ok": false, "error": { "code": e.code, "reason": e.reason } }))),
    }
}

// ---------------------------------------------------------------------------
// Handlers — Recaps
// ---------------------------------------------------------------------------

async fn create_recap(
    State(state): State<AppState>,
    Json(body): Json<CreateRecapBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let db = state.planning_pool.get().map_err(|e| ApiError::Internal(anyhow::anyhow!("{}: {}", "planning pool exhausted", e)))?;
    let p = Persistence::new(&db);
    let now = chrono::Utc::now().to_rfc3339();
    match p.persist_planning_recap(
        &body.recap_id,
        &body.actor_id,
        body.repo_id.as_deref(),
        &body.scope,
        &body.state,
        &now,
        &now,
    ) {
        Ok(row) => Ok(Json(serde_json::json!({ "ok": true, "recap": recap_row_to_value(&row) }))),
        Err(e) => Ok(Json(serde_json::json!({ "ok": false, "error": { "code": e.code, "reason": e.reason } }))),
    }
}

async fn read_recap(
    State(state): State<AppState>,
    Query(query): Query<ReadRecapQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let db = state.planning_pool.get().map_err(|e| ApiError::Internal(anyhow::anyhow!("{}: {}", "planning pool exhausted", e)))?;
    let p = Persistence::new(&db);
    match p.read_planning_recap(&query.recap_id) {
        Ok(Some(row)) => Ok(Json(serde_json::json!({ "ok": true, "recap": recap_row_to_value(&row) }))),
        Ok(None) => Ok(Json(serde_json::json!({ "ok": false, "error": { "code": "not_found", "reason": "recap_not_found" } }))),
        Err(e) => Ok(Json(serde_json::json!({ "ok": false, "error": { "code": e.code, "reason": e.reason } }))),
    }
}

// ---------------------------------------------------------------------------
// Handlers — Workflow Artifacts
// ---------------------------------------------------------------------------

async fn create_artifact(
    State(state): State<AppState>,
    Json(body): Json<CreateArtifactBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let db = state.planning_pool.get().map_err(|e| ApiError::Internal(anyhow::anyhow!("{}: {}", "planning pool exhausted", e)))?;
    let p = Persistence::new(&db);
    let now = chrono::Utc::now().to_rfc3339();
    match p.persist_workflow_artifact(
        &body.artifact_id,
        &body.actor_id,
        body.repo_id.as_deref(),
        &body.roadmap_id,
        body.slice_id.as_deref(),
        &body.kind,
        &body.phase,
        &body.status,
        &body.checksum,
        body.source_harness.as_deref(),
        body.source_model.as_deref(),
        body.session_id.as_deref(),
        &body.body,
        &body.structured_state,
        &now,
        &now,
    ) {
        Ok(row) => Ok(Json(serde_json::json!({ "ok": true, "artifact": artifact_row_to_value(&row) }))),
        Err(e) => Ok(Json(serde_json::json!({ "ok": false, "error": { "code": e.code, "reason": e.reason } }))),
    }
}

async fn read_artifact(
    State(state): State<AppState>,
    Query(query): Query<ReadArtifactQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let db = state.planning_pool.get().map_err(|e| ApiError::Internal(anyhow::anyhow!("{}: {}", "planning pool exhausted", e)))?;
    let p = Persistence::new(&db);
    match p.read_workflow_artifact(&query.artifact_id) {
        Ok(Some(row)) => Ok(Json(serde_json::json!({ "ok": true, "artifact": artifact_row_to_value(&row) }))),
        Ok(None) => Ok(Json(serde_json::json!({ "ok": false, "error": { "code": "not_found", "reason": "artifact_not_found" } }))),
        Err(e) => Ok(Json(serde_json::json!({ "ok": false, "error": { "code": e.code, "reason": e.reason } }))),
    }
}

// ---------------------------------------------------------------------------
// Handlers — Compare Receipts
// ---------------------------------------------------------------------------

async fn create_compare_receipt(
    State(state): State<AppState>,
    Json(body): Json<CreateCompareReceiptBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let db = state.planning_pool.get().map_err(|e| ApiError::Internal(anyhow::anyhow!("{}: {}", "planning pool exhausted", e)))?;
    let p = Persistence::new(&db);
    match p.persist_compare_receipt(
        &body.receipt_id,
        &body.actor_id,
        body.repo_id.as_deref(),
        &body.compare_hash,
        &body.source_ids_hash,
        &body.source_ids,
        body.version_vector.as_ref(),
        &body.gate_state,
        body.merge_eligible,
        &body.reason,
        body.downgrade.as_ref(),
        &body.issued_at,
        &body.expires_at,
    ) {
        Ok(row) => Ok(Json(serde_json::json!({ "ok": true, "receipt": compare_receipt_row_to_value(&row) }))),
        Err(e) => Ok(Json(serde_json::json!({ "ok": false, "error": { "code": e.code, "reason": e.reason } }))),
    }
}

// ---------------------------------------------------------------------------
// Handlers — Merge Intents
// ---------------------------------------------------------------------------

async fn create_merge_intent(
    State(state): State<AppState>,
    Json(body): Json<CreateMergeIntentBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let db = state.planning_pool.get().map_err(|e| ApiError::Internal(anyhow::anyhow!("{}: {}", "planning pool exhausted", e)))?;
    let p = Persistence::new(&db);
    match p.persist_merge_intent(
        &body.token_id,
        &body.compare_receipt_id,
        &body.actor_id,
        body.repo_id.as_deref(),
        &body.target_id,
        &body.source_ids_hash,
        &body.compare_hash,
        body.version_vector.as_ref(),
        body.version_vector_hash.as_deref(),
        &body.issued_at,
        &body.expires_at,
        body.consumed_at.as_deref(),
    ) {
        Ok(row) => Ok(Json(serde_json::json!({ "ok": true, "intent": merge_intent_row_to_value(&row) }))),
        Err(e) => Ok(Json(serde_json::json!({ "ok": false, "error": { "code": e.code, "reason": e.reason } }))),
    }
}

// ---------------------------------------------------------------------------
// Handlers — Merge Records
// ---------------------------------------------------------------------------

async fn merge_records(
    State(state): State<AppState>,
    Json(body): Json<MergeRecordsBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let db = state.planning_pool.get().map_err(|e| ApiError::Internal(anyhow::anyhow!("{}: {}", "planning pool exhausted", e)))?;
    let p = Persistence::new(&db);
    let now = chrono::Utc::now().to_rfc3339();

    // Read target record
    let target = match p.read_planning_record(&body.target_id) {
        Ok(Some(record)) => record,
        Ok(None) => return Ok(Json(serde_json::json!({
            "ok": false,
            "error": { "code": "not_found", "reason": "target_not_found" }
        }))),
        Err(e) => return Ok(Json(serde_json::json!({
            "ok": false,
            "error": { "code": e.code, "reason": e.reason }
        }))),
    };

    // Merge source states into target
    let mut merged_state = target.state.clone();
    for source_id in &body.source_ids {
        if let Ok(Some(source)) = p.read_planning_record(source_id) {
            if let serde_json::Value::Object(map) = &source.state {
                if let serde_json::Value::Object(ref mut target_map) = merged_state {
                    for (k, v) in map {
                        target_map.insert(k.clone(), v.clone());
                    }
                }
            }
        }
    }

    // Persist merged
    match p.persist_planning_record(
        &target.record_id,
        &target.owner_id,
        target.repo_id.as_deref(),
        &target.scope,
        &merged_state,
        &target.created_at,
        &now,
    ) {
        Ok(row) => Ok(Json(serde_json::json!({ "ok": true, "record": record_row_to_value(&row) }))),
        Err(e) => Ok(Json(serde_json::json!({ "ok": false, "error": { "code": e.code, "reason": e.reason } }))),
    }
}

// ---------------------------------------------------------------------------
// Handlers — Persistence Management
// ---------------------------------------------------------------------------

async fn init_persistence(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let db = state.planning_pool.get().map_err(|e| ApiError::Internal(anyhow::anyhow!("{}: {}", "planning pool exhausted", e)))?;
    let p = Persistence::new(&db);
    match p.run_migrations() {
        Ok(result) => Ok(Json(serde_json::json!({
            "ok": true,
            "latestVersion": result.latest_version,
            "appliedCount": result.applied_count,
            "appliedVersions": result.applied_versions,
        }))),
        Err(e) => Ok(Json(serde_json::json!({ "ok": false, "error": { "code": e.code, "reason": e.reason } }))),
    }
}

async fn run_retention(
    State(state): State<AppState>,
    Json(body): Json<RetentionBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let db = state.planning_pool.get().map_err(|e| ApiError::Internal(anyhow::anyhow!("{}: {}", "planning pool exhausted", e)))?;
    let p = Persistence::new(&db);
    match p.run_retention(body.older_than_days, body.dry_run.unwrap_or(true)) {
        Ok(result) => Ok(Json(serde_json::json!({
            "ok": true,
            "mode": result.mode,
            "candidateCount": result.candidate_count,
            "deletedCount": result.deleted_count,
        }))),
        Err(e) => Ok(Json(serde_json::json!({ "ok": false, "error": { "code": e.code, "reason": e.reason } }))),
    }
}

// ---------------------------------------------------------------------------
// Handlers — Search
// ---------------------------------------------------------------------------

async fn search(
    State(state): State<AppState>,
    Query(query): Query<SearchQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let db = state.planning_pool.get().map_err(|e| ApiError::Internal(anyhow::anyhow!("{}: {}", "planning pool exhausted", e)))?;
    let conn = &*db;
    let limit = query.limit;
    let pattern = format!("%{}%", query.q);
    let owner_filter = query.owner_id.as_deref().unwrap_or("");

    // Search ie_planning_records
    let mut records: Vec<serde_json::Value> = Vec::new();
    if let Ok(mut stmt) = conn.prepare(
        "SELECT record_id, owner_id, repo_id, scope, state, created_at, updated_at
         FROM ie_planning_records
         WHERE (?1 = '' OR owner_id = ?1) AND (scope LIKE ?2 OR state LIKE ?2)
         LIMIT ?3",
    ) {
        if let Ok(rows) = stmt.query_map(rusqlite::params![owner_filter, pattern, limit], |row| {
            let state_raw: String = row.get(4)?;
            Ok(PlanningRecordRow {
                record_id: row.get(0)?,
                owner_id: row.get(1)?,
                repo_id: row.get(2)?,
                scope: row.get(3)?,
                state: serde_json::from_str(&state_raw).unwrap_or(serde_json::Value::Null),
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        }) {
            for row in rows.flatten() {
                records.push(record_row_to_value(&row));
            }
        }
    }

    // Search ie_planning_suggestions
    let mut suggestions: Vec<serde_json::Value> = Vec::new();
    if let Ok(mut stmt) = conn.prepare(
        "SELECT suggestion_id, actor_id, repo_id, scope, state, created_at, updated_at
         FROM ie_planning_suggestions
         WHERE (?1 = '' OR actor_id = ?1) AND (scope LIKE ?2 OR state LIKE ?2)
         LIMIT ?3",
    ) {
        if let Ok(rows) = stmt.query_map(rusqlite::params![owner_filter, pattern, limit], |row| {
            let state_raw: String = row.get(4)?;
            Ok(PlanningSuggestionRow {
                suggestion_id: row.get(0)?,
                actor_id: row.get(1)?,
                repo_id: row.get(2)?,
                scope: row.get(3)?,
                state: serde_json::from_str(&state_raw).unwrap_or(serde_json::Value::Null),
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        }) {
            for row in rows.flatten() {
                suggestions.push(suggestion_row_to_value(&row));
            }
        }
    }

    // Search ie_planning_recaps
    let mut recaps: Vec<serde_json::Value> = Vec::new();
    if let Ok(mut stmt) = conn.prepare(
        "SELECT recap_id, actor_id, repo_id, scope, state, created_at, updated_at
         FROM ie_planning_recaps
         WHERE (?1 = '' OR actor_id = ?1) AND (scope LIKE ?2 OR state LIKE ?2)
         LIMIT ?3",
    ) {
        if let Ok(rows) = stmt.query_map(rusqlite::params![owner_filter, pattern, limit], |row| {
            let state_raw: String = row.get(4)?;
            Ok(PlanningRecapRow {
                recap_id: row.get(0)?,
                actor_id: row.get(1)?,
                repo_id: row.get(2)?,
                scope: row.get(3)?,
                state: serde_json::from_str(&state_raw).unwrap_or(serde_json::Value::Null),
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        }) {
            for row in rows.flatten() {
                recaps.push(recap_row_to_value(&row));
            }
        }
    }

    // Search ie_planning_workflow_artifacts
    let mut artifacts: Vec<serde_json::Value> = Vec::new();
    if let Ok(mut stmt) = conn.prepare(
        "SELECT artifact_id, actor_id, repo_id, roadmap_id, slice_id, kind, phase, status,
                checksum, source_harness, source_model, session_id, body, structured_state,
                created_at, updated_at
         FROM ie_planning_workflow_artifacts
         WHERE (?1 = '' OR actor_id = ?1)
           AND (body LIKE ?2 OR kind LIKE ?2 OR phase LIKE ?2 OR status LIKE ?2 OR structured_state LIKE ?2)
         LIMIT ?3",
    ) {
        if let Ok(rows) = stmt.query_map(rusqlite::params![owner_filter, pattern, limit], |row| {
            let ss_raw: String = row.get(13)?;
            Ok(WorkflowArtifactRow {
                artifact_id: row.get(0)?,
                actor_id: row.get(1)?,
                repo_id: row.get(2)?,
                roadmap_id: row.get(3)?,
                slice_id: row.get(4)?,
                kind: row.get(5)?,
                phase: row.get(6)?,
                status: row.get(7)?,
                checksum: row.get(8)?,
                source_harness: row.get(9)?,
                source_model: row.get(10)?,
                session_id: row.get(11)?,
                body: row.get(12)?,
                structured_state: serde_json::from_str(&ss_raw).unwrap_or(serde_json::Value::Null),
                created_at: row.get(14)?,
                updated_at: row.get(15)?,
            })
        }) {
            for row in rows.flatten() {
                artifacts.push(artifact_row_to_value(&row));
            }
        }
    }

    let count = records.len() + suggestions.len() + recaps.len() + artifacts.len();

    Ok(Json(serde_json::json!({
        "results": {
            "records": records,
            "suggestions": suggestions,
            "recaps": recaps,
            "artifacts": artifacts
        },
        "count": count,
        "query": query.q,
    })))
}

// ---------------------------------------------------------------------------
// Handler — Session
// ---------------------------------------------------------------------------

async fn session(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let session_state_dir = state.config.elegy_home.join("session-state");

    if !session_state_dir.exists() {
        return Ok(Json(serde_json::json!({"session": null})));
    }

    let mut entries: Vec<_> = match std::fs::read_dir(&session_state_dir) {
        Ok(rd) => rd.filter_map(|e| e.ok()).collect(),
        Err(_) => return Ok(Json(serde_json::json!({"session": null}))),
    };

    // Sort by modified time descending to find the most recent session
    entries.sort_by(|a, b| {
        let a_mtime = a.metadata().ok().and_then(|m| m.modified().ok());
        let b_mtime = b.metadata().ok().and_then(|m| m.modified().ok());
        b_mtime.cmp(&a_mtime)
    });

    for entry in entries {
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }

        let session_dir = entry.path();
        let session_id = entry.file_name().to_string_lossy().to_string();

        // Read plan.md if it exists
        let plan_path = session_dir.join("plan.md");
        let active_plan = if plan_path.is_file() {
            std::fs::read_to_string(&plan_path).ok()
        } else {
            None
        };

        // Read planning-session.json if it exists
        let session_json_path = session_dir.join("planning-session.json");
        let planning_scope: Option<serde_json::Value> = if session_json_path.is_file() {
            std::fs::read_to_string(&session_json_path)
                .ok()
                .and_then(|content| serde_json::from_str::<serde_json::Value>(&content).ok())
                .and_then(|v| v.get("planningScope").cloned())
        } else {
            None
        };

        return Ok(Json(serde_json::json!({
            "session": {
                "id": session_id,
                "activePlan": active_plan,
                "planningContext": null,
                "planningScope": planning_scope,
            }
        })));
    }

    Ok(Json(serde_json::json!({"session": null})))
}

// ---------------------------------------------------------------------------
// Handler — Explorer
// ---------------------------------------------------------------------------

async fn explorer(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let db = state.planning_pool.get().map_err(|e| ApiError::Internal(anyhow::anyhow!("{}: {}", "planning pool exhausted", e)))?;
    let conn = &*db;

    // Recent records (last 20)
    let mut recent_records: Vec<serde_json::Value> = Vec::new();
    if let Ok(mut stmt) = conn.prepare(
        "SELECT record_id, owner_id, repo_id, scope, state, created_at, updated_at
         FROM ie_planning_records
         ORDER BY updated_at DESC LIMIT 20",
    ) {
        if let Ok(rows) = stmt.query_map([], |row| {
            let state_raw: String = row.get(4)?;
            Ok(PlanningRecordRow {
                record_id: row.get(0)?,
                owner_id: row.get(1)?,
                repo_id: row.get(2)?,
                scope: row.get(3)?,
                state: serde_json::from_str(&state_raw).unwrap_or(serde_json::Value::Null),
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        }) {
            for row in rows.flatten() {
                recent_records.push(record_row_to_value(&row));
            }
        }
    }

    // Recent suggestions (last 20)
    let mut recent_suggestions: Vec<serde_json::Value> = Vec::new();
    if let Ok(mut stmt) = conn.prepare(
        "SELECT suggestion_id, actor_id, repo_id, scope, state, created_at, updated_at
         FROM ie_planning_suggestions
         ORDER BY updated_at DESC LIMIT 20",
    ) {
        if let Ok(rows) = stmt.query_map([], |row| {
            let state_raw: String = row.get(4)?;
            Ok(PlanningSuggestionRow {
                suggestion_id: row.get(0)?,
                actor_id: row.get(1)?,
                repo_id: row.get(2)?,
                scope: row.get(3)?,
                state: serde_json::from_str(&state_raw).unwrap_or(serde_json::Value::Null),
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        }) {
            for row in rows.flatten() {
                recent_suggestions.push(suggestion_row_to_value(&row));
            }
        }
    }

    // Recent recaps (last 20)
    let mut recent_recaps: Vec<serde_json::Value> = Vec::new();
    if let Ok(mut stmt) = conn.prepare(
        "SELECT recap_id, actor_id, repo_id, scope, state, created_at, updated_at
         FROM ie_planning_recaps
         ORDER BY updated_at DESC LIMIT 20",
    ) {
        if let Ok(rows) = stmt.query_map([], |row| {
            let state_raw: String = row.get(4)?;
            Ok(PlanningRecapRow {
                recap_id: row.get(0)?,
                actor_id: row.get(1)?,
                repo_id: row.get(2)?,
                scope: row.get(3)?,
                state: serde_json::from_str(&state_raw).unwrap_or(serde_json::Value::Null),
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        }) {
            for row in rows.flatten() {
                recent_recaps.push(recap_row_to_value(&row));
            }
        }
    }

    // Recent artifacts (last 20)
    let mut recent_artifacts: Vec<serde_json::Value> = Vec::new();
    if let Ok(mut stmt) = conn.prepare(
        "SELECT artifact_id, actor_id, repo_id, roadmap_id, slice_id, kind, phase, status,
                checksum, source_harness, source_model, session_id, body, structured_state,
                created_at, updated_at
         FROM ie_planning_workflow_artifacts
         ORDER BY updated_at DESC LIMIT 20",
    ) {
        if let Ok(rows) = stmt.query_map([], |row| {
            let ss_raw: String = row.get(13)?;
            Ok(WorkflowArtifactRow {
                artifact_id: row.get(0)?,
                actor_id: row.get(1)?,
                repo_id: row.get(2)?,
                roadmap_id: row.get(3)?,
                slice_id: row.get(4)?,
                kind: row.get(5)?,
                phase: row.get(6)?,
                status: row.get(7)?,
                checksum: row.get(8)?,
                source_harness: row.get(9)?,
                source_model: row.get(10)?,
                session_id: row.get(11)?,
                body: row.get(12)?,
                structured_state: serde_json::from_str(&ss_raw).unwrap_or(serde_json::Value::Null),
                created_at: row.get(14)?,
                updated_at: row.get(15)?,
            })
        }) {
            for row in rows.flatten() {
                recent_artifacts.push(artifact_row_to_value(&row));
            }
        }
    }

    Ok(Json(serde_json::json!({
        "explorer": {
            "recentRecords": recent_records,
            "recentSuggestions": recent_suggestions,
            "recentRecaps": recent_recaps,
            "recentArtifacts": recent_artifacts,
        }
    })))
}

// ---------------------------------------------------------------------------
// Handlers — Persistence Management
// ---------------------------------------------------------------------------

async fn corruption_scan(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let db = state.planning_pool.get().map_err(|e| ApiError::Internal(anyhow::anyhow!("{}: {}", "planning pool exhausted", e)))?;
    let conn = &*db;

    // Run SQLite integrity check
    let integrity: String = conn
        .query_row("PRAGMA integrity_check", [], |row| row.get(0))
        .map_err(|e| ApiError::Internal(e.into()))?;

    let mut corrupted: Vec<String> = Vec::new();

    if integrity.to_lowercase() != "ok" {
        corrupted.push(format!("integrity_check: {}", integrity));
    }

    // Scan ie_planning_records for missing owner_id
    if let Ok(mut stmt) = conn.prepare(
        "SELECT record_id FROM ie_planning_records WHERE owner_id IS NULL OR owner_id = ''",
    ) {
        if let Ok(rows) = stmt.query_map([], |row| row.get::<_, String>(0)) {
            for id in rows.flatten() {
                corrupted.push(format!("ie_planning_records({}): missing owner_id", id));
            }
        }
    }

    // Scan ie_planning_suggestions for missing actor_id
    if let Ok(mut stmt) = conn.prepare(
        "SELECT suggestion_id FROM ie_planning_suggestions WHERE actor_id IS NULL OR actor_id = ''",
    ) {
        if let Ok(rows) = stmt.query_map([], |row| row.get::<_, String>(0)) {
            for id in rows.flatten() {
                corrupted.push(format!("ie_planning_suggestions({}): missing actor_id", id));
            }
        }
    }

    // Scan ie_planning_recaps for missing actor_id
    if let Ok(mut stmt) = conn.prepare(
        "SELECT recap_id FROM ie_planning_recaps WHERE actor_id IS NULL OR actor_id = ''",
    ) {
        if let Ok(rows) = stmt.query_map([], |row| row.get::<_, String>(0)) {
            for id in rows.flatten() {
                corrupted.push(format!("ie_planning_recaps({}): missing actor_id", id));
            }
        }
    }

    // Scan ie_planning_workflow_artifacts for missing actor_id
    if let Ok(mut stmt) = conn.prepare(
        "SELECT artifact_id FROM ie_planning_workflow_artifacts WHERE actor_id IS NULL OR actor_id = ''",
    ) {
        if let Ok(rows) = stmt.query_map([], |row| row.get::<_, String>(0)) {
            for id in rows.flatten() {
                corrupted.push(format!("ie_planning_workflow_artifacts({}): missing actor_id", id));
            }
        }
    }

    let ok = corrupted.is_empty();
    let message = if ok {
        "Integrity check passed".to_string()
    } else {
        format!("Found {} issue(s)", corrupted.len())
    };

    Ok(Json(serde_json::json!({
        "corrupted": corrupted,
        "ok": ok,
        "message": message,
    })))
}

async fn export(
    State(state): State<AppState>,
    Json(body): Json<ExportBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let db = state.planning_pool.get().map_err(|e| ApiError::Internal(anyhow::anyhow!("{}: {}", "planning pool exhausted", e)))?;
    let p = Persistence::new(&db);
    let conn = &*db;
    let now = chrono::Utc::now().to_rfc3339();

    let include = body.include.as_deref().unwrap_or(&[]);

    // Export records
    let records: Vec<serde_json::Value> = if include.is_empty() || include.contains(&"records".to_string()) {
        p.list_planning_records(&body.owner_id)
            .unwrap_or_default()
            .iter()
            .map(record_row_to_value)
            .collect()
    } else {
        vec![]
    };

    // Export suggestions
    let suggestions: Vec<serde_json::Value> = if include.is_empty() || include.contains(&"suggestions".to_string()) {
        let mut result = Vec::new();
        if let Ok(mut stmt) = conn.prepare(
            "SELECT suggestion_id, actor_id, repo_id, scope, state, created_at, updated_at
             FROM ie_planning_suggestions WHERE actor_id = ?1 ORDER BY updated_at DESC",
        ) {
            if let Ok(rows) = stmt.query_map(rusqlite::params![body.owner_id], |row| {
                let state_raw: String = row.get(4)?;
                Ok(PlanningSuggestionRow {
                    suggestion_id: row.get(0)?,
                    actor_id: row.get(1)?,
                    repo_id: row.get(2)?,
                    scope: row.get(3)?,
                    state: serde_json::from_str(&state_raw).unwrap_or(serde_json::Value::Null),
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            }) {
                for row in rows.flatten() {
                    result.push(suggestion_row_to_value(&row));
                }
            }
        }
        result
    } else {
        vec![]
    };

    // Export recaps
    let recaps: Vec<serde_json::Value> = if include.is_empty() || include.contains(&"recaps".to_string()) {
        let mut result = Vec::new();
        if let Ok(mut stmt) = conn.prepare(
            "SELECT recap_id, actor_id, repo_id, scope, state, created_at, updated_at
             FROM ie_planning_recaps WHERE actor_id = ?1 ORDER BY updated_at DESC",
        ) {
            if let Ok(rows) = stmt.query_map(rusqlite::params![body.owner_id], |row| {
                let state_raw: String = row.get(4)?;
                Ok(PlanningRecapRow {
                    recap_id: row.get(0)?,
                    actor_id: row.get(1)?,
                    repo_id: row.get(2)?,
                    scope: row.get(3)?,
                    state: serde_json::from_str(&state_raw).unwrap_or(serde_json::Value::Null),
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            }) {
                for row in rows.flatten() {
                    result.push(recap_row_to_value(&row));
                }
            }
        }
        result
    } else {
        vec![]
    };

    // Export workflow artifacts
    let artifacts: Vec<serde_json::Value> = if include.is_empty() || include.contains(&"artifacts".to_string()) {
        let mut result = Vec::new();
        if let Ok(mut stmt) = conn.prepare(
            "SELECT artifact_id, actor_id, repo_id, roadmap_id, slice_id, kind, phase, status,
                    checksum, source_harness, source_model, session_id, body, structured_state,
                    created_at, updated_at
             FROM ie_planning_workflow_artifacts WHERE actor_id = ?1 ORDER BY updated_at DESC",
        ) {
            if let Ok(rows) = stmt.query_map(rusqlite::params![body.owner_id], |row| {
                let ss_raw: String = row.get(13)?;
                Ok(WorkflowArtifactRow {
                    artifact_id: row.get(0)?,
                    actor_id: row.get(1)?,
                    repo_id: row.get(2)?,
                    roadmap_id: row.get(3)?,
                    slice_id: row.get(4)?,
                    kind: row.get(5)?,
                    phase: row.get(6)?,
                    status: row.get(7)?,
                    checksum: row.get(8)?,
                    source_harness: row.get(9)?,
                    source_model: row.get(10)?,
                    session_id: row.get(11)?,
                    body: row.get(12)?,
                    structured_state: serde_json::from_str(&ss_raw).unwrap_or(serde_json::Value::Null),
                    created_at: row.get(14)?,
                    updated_at: row.get(15)?,
                })
            }) {
                for row in rows.flatten() {
                    result.push(artifact_row_to_value(&row));
                }
            }
        }
        result
    } else {
        vec![]
    };

    let count = records.len() + suggestions.len() + recaps.len() + artifacts.len();

    Ok(Json(serde_json::json!({
        "data": {
            "records": records,
            "suggestions": suggestions,
            "recaps": recaps,
            "artifacts": artifacts,
        },
        "exportedAt": now,
        "format": "json",
        "count": count,
    })))
}

async fn import(
    State(state): State<AppState>,
    Json(body): Json<ImportBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let db = state.planning_pool.get().map_err(|e| ApiError::Internal(anyhow::anyhow!("{}: {}", "planning pool exhausted", e)))?;
    let p = Persistence::new(&db);
    let now = chrono::Utc::now().to_rfc3339();

    let mut records_count = 0u64;
    for rec in &body.data.records {
        let record_id = rec.get("recordId").and_then(|v| v.as_str()).unwrap_or("");
        let owner_id = rec.get("ownerId").and_then(|v| v.as_str()).unwrap_or(&body.owner_id);
        let repo_id = rec.get("repoId").and_then(|v| v.as_str());
        let scope = rec.get("scope").and_then(|v| v.as_str()).unwrap_or("import");
        let state = rec.get("state").unwrap_or(&serde_json::Value::Null);
        let created_at = rec.get("createdAt").and_then(|v| v.as_str()).unwrap_or(&now);
        let updated_at = rec.get("updatedAt").and_then(|v| v.as_str()).unwrap_or(&now);

        if !record_id.is_empty() {
            if p
                .persist_planning_record(record_id, owner_id, repo_id, scope, state, created_at, updated_at)
                .is_ok()
            {
                records_count += 1;
            }
        }
    }

    let mut suggestions_count = 0u64;
    for sug in &body.data.suggestions {
        let suggestion_id = sug.get("suggestionId").and_then(|v| v.as_str()).unwrap_or("");
        let actor_id = sug.get("actorId").and_then(|v| v.as_str()).unwrap_or(&body.owner_id);
        let repo_id = sug.get("repoId").and_then(|v| v.as_str());
        let scope = sug.get("scope").and_then(|v| v.as_str()).unwrap_or("import");
        let state = sug.get("state").unwrap_or(&serde_json::Value::Null);
        let created_at = sug.get("createdAt").and_then(|v| v.as_str()).unwrap_or(&now);
        let updated_at = sug.get("updatedAt").and_then(|v| v.as_str()).unwrap_or(&now);

        if !suggestion_id.is_empty() {
            if p
                .persist_planning_suggestion(suggestion_id, actor_id, repo_id, scope, state, created_at, updated_at)
                .is_ok()
            {
                suggestions_count += 1;
            }
        }
    }

    let mut recaps_count = 0u64;
    for rec in &body.data.recaps {
        let recap_id = rec.get("recapId").and_then(|v| v.as_str()).unwrap_or("");
        let actor_id = rec.get("actorId").and_then(|v| v.as_str()).unwrap_or(&body.owner_id);
        let repo_id = rec.get("repoId").and_then(|v| v.as_str());
        let scope = rec.get("scope").and_then(|v| v.as_str()).unwrap_or("import");
        let state = rec.get("state").unwrap_or(&serde_json::Value::Null);
        let created_at = rec.get("createdAt").and_then(|v| v.as_str()).unwrap_or(&now);
        let updated_at = rec.get("updatedAt").and_then(|v| v.as_str()).unwrap_or(&now);

        if !recap_id.is_empty() {
            if p
                .persist_planning_recap(recap_id, actor_id, repo_id, scope, state, created_at, updated_at)
                .is_ok()
            {
                recaps_count += 1;
            }
        }
    }

    let mut artifacts_count = 0u64;
    for art in &body.data.artifacts {
        let artifact_id = art.get("artifactId").and_then(|v| v.as_str()).unwrap_or("");
        let actor_id = art.get("actorId").and_then(|v| v.as_str()).unwrap_or(&body.owner_id);
        let repo_id = art.get("repoId").and_then(|v| v.as_str());
        let roadmap_id = art.get("roadmapId").and_then(|v| v.as_str()).unwrap_or("");
        let slice_id = art.get("sliceId").and_then(|v| v.as_str());
        let kind = art.get("kind").and_then(|v| v.as_str()).unwrap_or("import");
        let phase = art.get("phase").and_then(|v| v.as_str()).unwrap_or("unknown");
        let status = art.get("status").and_then(|v| v.as_str()).unwrap_or("unknown");
        let checksum = art.get("checksum").and_then(|v| v.as_str()).unwrap_or("");
        let source_harness = art.get("sourceHarness").and_then(|v| v.as_str());
        let source_model = art.get("sourceModel").and_then(|v| v.as_str());
        let session_id = art.get("sessionId").and_then(|v| v.as_str());
        let body = art.get("body").and_then(|v| v.as_str()).unwrap_or("");
        let structured_state = art.get("structuredState").unwrap_or(&serde_json::Value::Null);
        let created_at = art.get("createdAt").and_then(|v| v.as_str()).unwrap_or(&now);
        let updated_at = art.get("updatedAt").and_then(|v| v.as_str()).unwrap_or(&now);

        if !artifact_id.is_empty() && !roadmap_id.is_empty() {
            if p
                .persist_workflow_artifact(
                    artifact_id, actor_id, repo_id, roadmap_id, slice_id, kind, phase, status,
                    checksum, source_harness, source_model, session_id, body, structured_state,
                    created_at, updated_at,
                )
                .is_ok()
            {
                artifacts_count += 1;
            }
        }
    }

    Ok(Json(serde_json::json!({
        "ok": true,
        "imported": {
            "records": records_count,
            "suggestions": suggestions_count,
            "recaps": recaps_count,
            "artifacts": artifacts_count,
        }
    })))
}

// ---------------------------------------------------------------------------
// Handlers — Workflow Artifacts
// ---------------------------------------------------------------------------

async fn continuation_package(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let db = state.planning_pool.get().map_err(|e| ApiError::Internal(anyhow::anyhow!("{}: {}", "planning pool exhausted", e)))?;
    let conn = &*db;

    let result = conn.query_row(
        "SELECT artifact_id, actor_id, repo_id, roadmap_id, slice_id, kind, phase, status,
                checksum, source_harness, source_model, session_id, body, structured_state,
                created_at, updated_at
         FROM ie_planning_workflow_artifacts
         WHERE kind = 'continuation'
         ORDER BY created_at DESC
         LIMIT 1",
        [],
        |row| {
            let ss_raw: String = row.get(13)?;
            Ok(WorkflowArtifactRow {
                artifact_id: row.get(0)?,
                actor_id: row.get(1)?,
                repo_id: row.get(2)?,
                roadmap_id: row.get(3)?,
                slice_id: row.get(4)?,
                kind: row.get(5)?,
                phase: row.get(6)?,
                status: row.get(7)?,
                checksum: row.get(8)?,
                source_harness: row.get(9)?,
                source_model: row.get(10)?,
                session_id: row.get(11)?,
                body: row.get(12)?,
                structured_state: serde_json::from_str(&ss_raw).unwrap_or(serde_json::Value::Null),
                created_at: row.get(14)?,
                updated_at: row.get(15)?,
            })
        },
    );

    match result {
        Ok(artifact) => Ok(Json(serde_json::json!({
            "package": artifact_row_to_value(&artifact)
        }))),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(Json(serde_json::json!({
            "package": null
        }))),
        Err(e) => Err(ApiError::Internal(e.into())),
    }
}

// ---------------------------------------------------------------------------
// Row-to-JSON helpers
// ---------------------------------------------------------------------------

fn record_row_to_value(row: &PlanningRecordRow) -> serde_json::Value {
    serde_json::json!({
        "recordId": row.record_id,
        "ownerId": row.owner_id,
        "repoId": row.repo_id,
        "scope": row.scope,
        "state": row.state,
        "createdAt": row.created_at,
        "updatedAt": row.updated_at,
    })
}

fn suggestion_row_to_value(row: &PlanningSuggestionRow) -> serde_json::Value {
    serde_json::json!({
        "suggestionId": row.suggestion_id,
        "actorId": row.actor_id,
        "repoId": row.repo_id,
        "scope": row.scope,
        "state": row.state,
        "createdAt": row.created_at,
        "updatedAt": row.updated_at,
    })
}

fn recap_row_to_value(row: &PlanningRecapRow) -> serde_json::Value {
    serde_json::json!({
        "recapId": row.recap_id,
        "actorId": row.actor_id,
        "repoId": row.repo_id,
        "scope": row.scope,
        "state": row.state,
        "createdAt": row.created_at,
        "updatedAt": row.updated_at,
    })
}

fn artifact_row_to_value(row: &WorkflowArtifactRow) -> serde_json::Value {
    serde_json::json!({
        "artifactId": row.artifact_id,
        "actorId": row.actor_id,
        "repoId": row.repo_id,
        "roadmapId": row.roadmap_id,
        "sliceId": row.slice_id,
        "kind": row.kind,
        "phase": row.phase,
        "status": row.status,
        "checksum": row.checksum,
        "sourceHarness": row.source_harness,
        "sourceModel": row.source_model,
        "sessionId": row.session_id,
        "body": row.body,
        "structuredState": row.structured_state,
        "createdAt": row.created_at,
        "updatedAt": row.updated_at,
    })
}

fn compare_receipt_row_to_value(row: &CompareReceiptRow) -> serde_json::Value {
    serde_json::json!({
        "receiptId": row.receipt_id,
        "actorId": row.actor_id,
        "repoId": row.repo_id,
        "compareHash": row.compare_hash,
        "sourceIdsHash": row.source_ids_hash,
        "sourceIds": row.source_ids,
        "versionVector": row.version_vector,
        "gateState": row.gate_state,
        "mergeEligible": row.merge_eligible,
        "reason": row.reason,
        "downgrade": row.downgrade,
        "issuedAt": row.issued_at,
        "expiresAt": row.expires_at,
        "createdAt": row.created_at,
    })
}

fn merge_intent_row_to_value(row: &MergeIntentRow) -> serde_json::Value {
    serde_json::json!({
        "tokenId": row.token_id,
        "compareReceiptId": row.compare_receipt_id,
        "actorId": row.actor_id,
        "repoId": row.repo_id,
        "targetId": row.target_id,
        "sourceIdsHash": row.source_ids_hash,
        "compareHash": row.compare_hash,
        "versionVector": row.version_vector,
        "versionVectorHash": row.version_vector_hash,
        "issuedAt": row.issued_at,
        "expiresAt": row.expires_at,
        "consumedAt": row.consumed_at,
        "createdAt": row.created_at,
    })
}
