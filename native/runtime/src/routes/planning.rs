use axum::extract::{Path, Query, State};
use axum::routing::post;
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
        .with_state(state)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Open `planning.db` from the configured `elegy_home` directory.
fn open_planning_db(state: &AppState) -> Result<db::Database, ApiError> {
    let path = state.config.elegy_home.join("planning.db");
    db::Database::open(&path).map_err(|e| ApiError::Internal(e.into()))
}

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
// Handlers — Records
// ---------------------------------------------------------------------------

async fn create_record(
    State(state): State<AppState>,
    Json(body): Json<CreateRecordBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let db = open_planning_db(&state)?;
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
    let db = open_planning_db(&state)?;
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
    let db = open_planning_db(&state)?;
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
    let db = open_planning_db(&state)?;
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
    let db = open_planning_db(&state)?;
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
    let db = open_planning_db(&state)?;
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
    let db = open_planning_db(&state)?;
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
    let db = open_planning_db(&state)?;
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
    let db = open_planning_db(&state)?;
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
    let db = open_planning_db(&state)?;
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
    let db = open_planning_db(&state)?;
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
    let db = open_planning_db(&state)?;
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
    let db = open_planning_db(&state)?;
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
    let db = open_planning_db(&state)?;
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
