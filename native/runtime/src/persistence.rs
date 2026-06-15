// ---------------------------------------------------------------------------
// Planning Persistence — typed CRUD over the ie_* SQLite tables
//
// Port of copilot-ui/lib/planningPersistence.js (PostgreSQL → SQLite).
// All JSONB columns are stored as TEXT (JSON strings).
// All TIMESTAMPTZ columns are stored as TEXT (ISO 8601 strings).
// BOOLEAN columns are stored as INTEGER (0/1).
// ---------------------------------------------------------------------------

use chrono::Utc;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::db::Database;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Error and result types
// ---------------------------------------------------------------------------

/// A typed error code + reason string, matching the Node.js persistence error
/// surface.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersistenceError {
    pub code: String,
    pub reason: String,
}

impl PersistenceError {
    pub fn new(code: impl Into<String>, reason: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            reason: reason.into(),
        }
    }
}

impl std::fmt::Display for PersistenceError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.reason)
    }
}

impl std::error::Error for PersistenceError {}

impl From<rusqlite::Error> for PersistenceError {
    fn from(e: rusqlite::Error) -> Self {
        match e {
            rusqlite::Error::QueryReturnedNoRows => PersistenceError {
                code: "not_found".into(),
                reason: "query_returned_no_rows".into(),
            },
            other => PersistenceError {
                code: "internal_error".into(),
                reason: other.to_string(),
            },
        }
    }
}

/// Generic result with an optional error payload.
/// Mirrors the `{ ok, error }` shape from the JS layer.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersistenceResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<PersistenceError>,
}

impl PersistenceResult {
    pub fn ok() -> Self {
        Self { ok: true, error: None }
    }

    pub fn err(code: impl Into<String>, reason: impl Into<String>) -> Self {
        Self {
            ok: false,
            error: Some(PersistenceError::new(code, reason)),
        }
    }
}

// ---------------------------------------------------------------------------
// Row types (mirror the PostgreSQL ie_* table columns)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanningRecordRow {
    pub record_id: String,
    pub owner_id: String,
    pub repo_id: Option<String>,
    pub scope: String,
    pub state: serde_json::Value,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanningSuggestionRow {
    pub suggestion_id: String,
    pub actor_id: String,
    pub repo_id: Option<String>,
    pub scope: String,
    pub state: serde_json::Value,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanningRecapRow {
    pub recap_id: String,
    pub actor_id: String,
    pub repo_id: Option<String>,
    pub scope: String,
    pub state: serde_json::Value,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowArtifactRow {
    pub artifact_id: String,
    pub actor_id: String,
    pub repo_id: Option<String>,
    pub roadmap_id: String,
    pub slice_id: Option<String>,
    pub kind: String,
    pub phase: String,
    pub status: String,
    pub checksum: String,
    pub source_harness: Option<String>,
    pub source_model: Option<String>,
    pub session_id: Option<String>,
    pub body: String,
    pub structured_state: serde_json::Value,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompareReceiptRow {
    pub receipt_id: String,
    pub actor_id: String,
    pub repo_id: Option<String>,
    pub compare_hash: String,
    pub source_ids_hash: String,
    pub source_ids: serde_json::Value,
    pub version_vector: Option<serde_json::Value>,
    pub gate_state: String,
    pub merge_eligible: bool,
    pub reason: String,
    pub downgrade: Option<serde_json::Value>,
    pub issued_at: String,
    pub expires_at: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MergeIntentRow {
    pub token_id: String,
    pub compare_receipt_id: String,
    pub actor_id: String,
    pub repo_id: Option<String>,
    pub target_id: String,
    pub source_ids_hash: String,
    pub compare_hash: String,
    pub version_vector: Option<serde_json::Value>,
    pub version_vector_hash: Option<String>,
    pub issued_at: String,
    pub expires_at: String,
    pub consumed_at: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MergeIdempotencyRow {
    pub idempotency_key: String,
    pub actor_id: String,
    pub repo_id: Option<String>,
    pub operation_type: String,
    pub target_id: String,
    pub source_ids_hash: String,
    pub compare_hash: String,
    pub payload_hash: String,
    pub merge_record_id: Option<String>,
    pub response: serde_json::Value,
    pub created_at: String,
    pub expires_at: String,
}

// ---------------------------------------------------------------------------
// Complex result types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListRecordsResult {
    pub records: Vec<PlanningRecordRow>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RetentionResult {
    pub mode: String,
    pub candidate_count: usize,
    pub deleted_count: usize,
    pub candidate_record_ids: Vec<String>,
    pub deleted_record_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersistIdempotencyResult {
    pub record: Option<MergeIdempotencyRow>,
    pub replay: bool,
    pub conflict: bool,
}

// ---------------------------------------------------------------------------
// Migration types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct MigrationEntry {
    pub version: &'static str,
    pub description: &'static str,
    pub sql: &'static str,
}

/// Migration manifest — SQL embedded at compile time from `migrations/` files.
const MIGRATION_MANIFEST: &[MigrationEntry] = &[
    MigrationEntry {
        version: "001_planning_records_init",
        description: "Create planning records persistence table",
        sql: include_str!("../migrations/001_planning_records_init.sql"),
    },
    MigrationEntry {
        version: "002_planning_backfill_runs_init",
        description: "Create planning backfill runs table",
        sql: include_str!("../migrations/002_planning_backfill_runs_init.sql"),
    },
    MigrationEntry {
        version: "003_planning_backfill_items_ledger_init",
        description: "Create planning backfill item ledger table",
        sql: include_str!("../migrations/003_planning_backfill_items_ledger_init.sql"),
    },
    MigrationEntry {
        version: "004_planning_compare_receipts_init",
        description: "Create planning compare receipts durability table",
        sql: include_str!("../migrations/004_planning_compare_receipts_init.sql"),
    },
    MigrationEntry {
        version: "005_planning_merge_intents_init",
        description: "Create planning merge intents durability table",
        sql: include_str!("../migrations/005_planning_merge_intents_init.sql"),
    },
    MigrationEntry {
        version: "006_planning_merge_idempotency_ledger_init",
        description: "Create planning merge idempotency ledger table",
        sql: include_str!("../migrations/006_planning_merge_idempotency_ledger_init.sql"),
    },
    MigrationEntry {
        version: "007_planning_suggestions_init",
        description: "Create planning suggestions durability table",
        sql: include_str!("../migrations/007_planning_suggestions_init.sql"),
    },
    MigrationEntry {
        version: "008_planning_recaps_init",
        description: "Create planning recaps durability table",
        sql: include_str!("../migrations/008_planning_recaps_init.sql"),
    },
    MigrationEntry {
        version: "009_planning_workflow_artifacts_init",
        description: "Create planning workflow artifact durability table",
        sql: include_str!("../migrations/009_planning_workflow_artifacts_init.sql"),
    },
];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MigrationResult {
    pub schema_table: String,
    pub latest_version: Option<String>,
    pub manifest_count: usize,
    pub applied_count: usize,
    pub applied_versions: Vec<String>,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Compute sha256 hex checksum of a string.
fn compute_checksum(input: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(input.as_bytes());
    hex::encode(hasher.finalize())
}

/// Normalize migration SQL: trim, normalize line endings.
fn normalize_migration_sql(sql: &str) -> String {
    sql.replace("\r\n", "\n").trim().to_string()
}

/// Check if an ISO 8601 timestamp is expired (older than now).
fn is_expired(expires_at: &str) -> bool {
    let Ok(expires) = chrono::DateTime::parse_from_rfc3339(expires_at) else {
        return true; // treat unparseable as expired
    };
    let now = Utc::now();
    now > expires
}

/// Normalize a JSON value to a string for storage.
fn json_to_string(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::Null => "null".to_string(),
        _ => value.to_string(),
    }
}

/// Normalize an optional JSON value to Option<String>.
fn opt_json_to_string(value: &Option<serde_json::Value>) -> Option<String> {
    value.as_ref().map(|v| json_to_string(v))
}

// ---------------------------------------------------------------------------
// Persistence wrapper
// ---------------------------------------------------------------------------

/// Typed persistence operations over the ie_* planning tables.
///
/// Wraps a [`Database`] reference and provides all CRUD methods.
pub struct Persistence<'a> {
    db: &'a Database,
}

impl<'a> Persistence<'a> {
    /// Create a new Persistence instance wrapping a Database reference.
    pub fn new(db: &'a Database) -> Self {
        Self { db }
    }

    /// Access the underlying connection.
    fn conn(&self) -> &Connection {
        self.db.conn()
    }

    // -----------------------------------------------------------------------
    // Versioned migration runner
    // -----------------------------------------------------------------------

    /// Run pending versioned migrations with checksum drift detection.
    ///
    /// Creates `ie_schema_versions` if it does not exist, verifies existing
    /// migration checksums, applies missing migrations, and records them.
    pub fn run_migrations(&self) -> Result<MigrationResult, PersistenceError> {
        let conn = self.conn();

        // Ensure schema table exists
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS ie_schema_versions (
                version TEXT PRIMARY KEY,
                checksum TEXT NOT NULL,
                applied_at TEXT NOT NULL DEFAULT (datetime('now'))
            )",
        )?;

        // Read existing applied migrations
        let mut stmt = conn.prepare(
            "SELECT version, checksum FROM ie_schema_versions ORDER BY version ASC",
        )?;
        let existing: Vec<(String, String)> = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?
            .filter_map(Result::ok)
            .collect();

        let existing_by_version: std::collections::HashMap<String, String> =
            existing.into_iter().collect();

        // Build manifest version set
        let manifest_version_set: std::collections::HashSet<&str> =
            MIGRATION_MANIFEST.iter().map(|m| m.version).collect();

        // Check for drift: existing versions not in manifest
        let mut unexpected_versions: Vec<&str> = Vec::new();
        for version in existing_by_version.keys() {
            if !manifest_version_set.contains(version.as_str()) {
                unexpected_versions.push(version);
            }
        }
        if !unexpected_versions.is_empty() {
            return Err(PersistenceError::new(
                "migration_checksum_baseline_mismatch",
                &format!("unexpected_versions={}", unexpected_versions.join(",")),
            ));
        }

        // Check for drift: checksum mismatch
        for entry in MIGRATION_MANIFEST {
            if let Some(stored_checksum) = existing_by_version.get(entry.version) {
                let normalized = normalize_migration_sql(entry.sql);
                let expected = compute_checksum(&normalized);
                let actual = stored_checksum.trim().to_lowercase();
                if expected != actual {
                    return Err(PersistenceError::new(
                        "migration_checksum_drift",
                        &format!(
                            "version={} expected={} actual={}",
                            entry.version, expected, actual
                        ),
                    ));
                }
            }
        }

        // Apply missing migrations
        let mut applied_versions: Vec<String> = Vec::new();
        let tx = conn.unchecked_transaction()?;
        for entry in MIGRATION_MANIFEST {
            if existing_by_version.contains_key(entry.version) {
                continue;
            }
            let normalized = normalize_migration_sql(entry.sql);
            let checksum = compute_checksum(&normalized);
            tx.execute_batch(entry.sql)?;
            tx.execute(
                "INSERT INTO ie_schema_versions (version, checksum) VALUES (?1, ?2)",
                params![entry.version, checksum],
            )?;
            applied_versions.push(entry.version.to_string());
        }
        tx.commit()?;

        let latest_version = MIGRATION_MANIFEST.last().map(|m| m.version.to_string());

        Ok(MigrationResult {
            schema_table: "ie_schema_versions".to_string(),
            latest_version,
            manifest_count: MIGRATION_MANIFEST.len(),
            applied_count: applied_versions.len(),
            applied_versions,
        })
    }

    // -----------------------------------------------------------------------
    // Planning Records CRUD
    // -----------------------------------------------------------------------

    /// Insert or update a planning record.
    ///
    /// Returns the persisted row or an error.
    pub fn persist_planning_record(
        &self,
        record_id: &str,
        owner_id: &str,
        repo_id: Option<&str>,
        scope: &str,
        state: &serde_json::Value,
        created_at: &str,
        updated_at: &str,
    ) -> Result<PlanningRecordRow, PersistenceError> {
        let conn = self.conn();
        let state_str = json_to_string(state);
        let row = conn.query_row(
            "INSERT INTO ie_planning_records (record_id, owner_id, repo_id, scope, state, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT (record_id) DO UPDATE SET
               owner_id = excluded.owner_id,
               repo_id = excluded.repo_id,
               scope = excluded.scope,
               state = excluded.state,
               updated_at = excluded.updated_at
             RETURNING record_id, owner_id, repo_id, scope, state, created_at, updated_at",
            params![record_id, owner_id, repo_id, scope, state_str, created_at, updated_at],
            |row| {
                let state_raw: String = row.get(4)?;
                let state_val: serde_json::Value =
                    serde_json::from_str(&state_raw).unwrap_or(serde_json::Value::Null);
                Ok(PlanningRecordRow {
                    record_id: row.get(0)?,
                    owner_id: row.get(1)?,
                    repo_id: row.get(2)?,
                    scope: row.get(3)?,
                    state: state_val,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            },
        )?;
        Ok(row)
    }

    /// Read a planning record by its ID.
    ///
    /// Returns `None` if not found.
    pub fn read_planning_record(
        &self,
        record_id: &str,
    ) -> Result<Option<PlanningRecordRow>, PersistenceError> {
        let conn = self.conn();
        let mut stmt = conn.prepare(
            "SELECT record_id, owner_id, repo_id, scope, state, created_at, updated_at
             FROM ie_planning_records WHERE record_id = ?1",
        )?;
        let mut rows = stmt.query_map(params![record_id], |row| {
            let state_raw: String = row.get(4)?;
            let state_val: serde_json::Value =
                serde_json::from_str(&state_raw).unwrap_or(serde_json::Value::Null);
            Ok(PlanningRecordRow {
                record_id: row.get(0)?,
                owner_id: row.get(1)?,
                repo_id: row.get(2)?,
                scope: row.get(3)?,
                state: state_val,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })?;
        match rows.next() {
            Some(Ok(row)) => Ok(Some(row)),
            Some(Err(e)) => Err(PersistenceError::from(e)),
            None => Ok(None),
        }
    }

    /// List planning records by owner_id, ordered by updated_at DESC.
    pub fn list_planning_records(
        &self,
        owner_id: &str,
    ) -> Result<Vec<PlanningRecordRow>, PersistenceError> {
        let conn = self.conn();
        let mut stmt = conn.prepare(
            "SELECT record_id, owner_id, repo_id, scope, state, created_at, updated_at
             FROM ie_planning_records
             WHERE owner_id = ?1
             ORDER BY updated_at DESC",
        )?;
        let rows = stmt.query_map(params![owner_id], |row| {
            let state_raw: String = row.get(4)?;
            let state_val: serde_json::Value =
                serde_json::from_str(&state_raw).unwrap_or(serde_json::Value::Null);
            Ok(PlanningRecordRow {
                record_id: row.get(0)?,
                owner_id: row.get(1)?,
                repo_id: row.get(2)?,
                scope: row.get(3)?,
                state: state_val,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })?;
        let records: Vec<PlanningRecordRow> = rows.filter_map(Result::ok).collect();
        Ok(records)
    }

    /// Delete a planning record by its ID.
    ///
    /// Returns `true` if a row was actually deleted.
    pub fn delete_planning_record(&self, record_id: &str) -> Result<bool, PersistenceError> {
        let conn = self.conn();
        let deleted: Option<String> = conn
            .query_row(
                "DELETE FROM ie_planning_records WHERE record_id = ?1 RETURNING record_id",
                params![record_id],
                |row| row.get(0),
            )
            .ok();
        Ok(deleted.is_some())
    }

    // -----------------------------------------------------------------------
    // Suggestions CRUD
    // -----------------------------------------------------------------------

    /// Insert or update a planning suggestion with ownership guard.
    ///
    /// If the suggestion exists and `actor_id` does not match the stored actor,
    /// an `ownership_conflict` error is returned.
    pub fn persist_planning_suggestion(
        &self,
        suggestion_id: &str,
        actor_id: &str,
        repo_id: Option<&str>,
        scope: &str,
        state: &serde_json::Value,
        created_at: &str,
        updated_at: &str,
    ) -> Result<PlanningSuggestionRow, PersistenceError> {
        let conn = self.conn();
        let state_str = json_to_string(state);

        // Try upsert with ownership guard
        let result = conn.query_row(
            "INSERT INTO ie_planning_suggestions (suggestion_id, actor_id, repo_id, scope, state, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT (suggestion_id) DO UPDATE SET
               actor_id = excluded.actor_id,
               repo_id = excluded.repo_id,
               scope = excluded.scope,
               state = excluded.state,
               updated_at = excluded.updated_at
             WHERE ie_planning_suggestions.actor_id = excluded.actor_id
             RETURNING suggestion_id, actor_id, repo_id, scope, state, created_at, updated_at",
            params![suggestion_id, actor_id, repo_id, scope, state_str, created_at, updated_at],
            |row| {
                let state_raw: String = row.get(4)?;
                let state_val: serde_json::Value =
                    serde_json::from_str(&state_raw).unwrap_or(serde_json::Value::Null);
                Ok(PlanningSuggestionRow {
                    suggestion_id: row.get(0)?,
                    actor_id: row.get(1)?,
                    repo_id: row.get(2)?,
                    scope: row.get(3)?,
                    state: state_val,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            },
        );

        match result {
            Ok(row) => Ok(row),
            Err(rusqlite::Error::QueryReturnedNoRows) => {
                // The WHERE clause prevented the update — ownership conflict
                Err(PersistenceError::new(
                    "ownership_conflict",
                    "suggestion_actor_id_mismatch",
                ))
            }
            Err(e) => Err(PersistenceError::from(e)),
        }
    }

    /// Read a planning suggestion by its ID.
    pub fn read_planning_suggestion(
        &self,
        suggestion_id: &str,
    ) -> Result<Option<PlanningSuggestionRow>, PersistenceError> {
        let conn = self.conn();
        let mut stmt = conn.prepare(
            "SELECT suggestion_id, actor_id, repo_id, scope, state, created_at, updated_at
             FROM ie_planning_suggestions WHERE suggestion_id = ?1",
        )?;
        let mut rows = stmt.query_map(params![suggestion_id], |row| {
            let state_raw: String = row.get(4)?;
            let state_val: serde_json::Value =
                serde_json::from_str(&state_raw).unwrap_or(serde_json::Value::Null);
            Ok(PlanningSuggestionRow {
                suggestion_id: row.get(0)?,
                actor_id: row.get(1)?,
                repo_id: row.get(2)?,
                scope: row.get(3)?,
                state: state_val,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })?;
        match rows.next() {
            Some(Ok(row)) => Ok(Some(row)),
            Some(Err(e)) => Err(PersistenceError::from(e)),
            None => Ok(None),
        }
    }

    // -----------------------------------------------------------------------
    // Recaps CRUD
    // -----------------------------------------------------------------------

    /// Insert or update a planning recap with ownership guard.
    pub fn persist_planning_recap(
        &self,
        recap_id: &str,
        actor_id: &str,
        repo_id: Option<&str>,
        scope: &str,
        state: &serde_json::Value,
        created_at: &str,
        updated_at: &str,
    ) -> Result<PlanningRecapRow, PersistenceError> {
        let conn = self.conn();
        let state_str = json_to_string(state);

        let result = conn.query_row(
            "INSERT INTO ie_planning_recaps (recap_id, actor_id, repo_id, scope, state, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT (recap_id) DO UPDATE SET
               actor_id = excluded.actor_id,
               repo_id = excluded.repo_id,
               scope = excluded.scope,
               state = excluded.state,
               updated_at = excluded.updated_at
             WHERE ie_planning_recaps.actor_id = excluded.actor_id
             RETURNING recap_id, actor_id, repo_id, scope, state, created_at, updated_at",
            params![recap_id, actor_id, repo_id, scope, state_str, created_at, updated_at],
            |row| {
                let state_raw: String = row.get(4)?;
                let state_val: serde_json::Value =
                    serde_json::from_str(&state_raw).unwrap_or(serde_json::Value::Null);
                Ok(PlanningRecapRow {
                    recap_id: row.get(0)?,
                    actor_id: row.get(1)?,
                    repo_id: row.get(2)?,
                    scope: row.get(3)?,
                    state: state_val,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            },
        );

        match result {
            Ok(row) => Ok(row),
            Err(rusqlite::Error::QueryReturnedNoRows) => {
                Err(PersistenceError::new(
                    "ownership_conflict",
                    "recap_actor_id_mismatch",
                ))
            }
            Err(e) => Err(PersistenceError::from(e)),
        }
    }

    /// Read a planning recap by its ID.
    pub fn read_planning_recap(
        &self,
        recap_id: &str,
    ) -> Result<Option<PlanningRecapRow>, PersistenceError> {
        let conn = self.conn();
        let mut stmt = conn.prepare(
            "SELECT recap_id, actor_id, repo_id, scope, state, created_at, updated_at
             FROM ie_planning_recaps WHERE recap_id = ?1",
        )?;
        let mut rows = stmt.query_map(params![recap_id], |row| {
            let state_raw: String = row.get(4)?;
            let state_val: serde_json::Value =
                serde_json::from_str(&state_raw).unwrap_or(serde_json::Value::Null);
            Ok(PlanningRecapRow {
                recap_id: row.get(0)?,
                actor_id: row.get(1)?,
                repo_id: row.get(2)?,
                scope: row.get(3)?,
                state: state_val,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })?;
        match rows.next() {
            Some(Ok(row)) => Ok(Some(row)),
            Some(Err(e)) => Err(PersistenceError::from(e)),
            None => Ok(None),
        }
    }

    // -----------------------------------------------------------------------
    // Workflow Artifacts CRUD
    // -----------------------------------------------------------------------

    /// Insert or update a workflow artifact with ownership guard.
    pub fn persist_workflow_artifact(
        &self,
        artifact_id: &str,
        actor_id: &str,
        repo_id: Option<&str>,
        roadmap_id: &str,
        slice_id: Option<&str>,
        kind: &str,
        phase: &str,
        status: &str,
        checksum: &str,
        source_harness: Option<&str>,
        source_model: Option<&str>,
        session_id: Option<&str>,
        body: &str,
        structured_state: &serde_json::Value,
        created_at: &str,
        updated_at: &str,
    ) -> Result<WorkflowArtifactRow, PersistenceError> {
        let conn = self.conn();
        let state_str = json_to_string(structured_state);

        let result = conn.query_row(
            "INSERT INTO ie_planning_workflow_artifacts
             (artifact_id, actor_id, repo_id, roadmap_id, slice_id, kind, phase, status, checksum,
              source_harness, source_model, session_id, body, structured_state, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
             ON CONFLICT (artifact_id) DO UPDATE SET
               actor_id = excluded.actor_id,
               repo_id = excluded.repo_id,
               roadmap_id = excluded.roadmap_id,
               slice_id = excluded.slice_id,
               kind = excluded.kind,
               phase = excluded.phase,
               status = excluded.status,
               checksum = excluded.checksum,
               source_harness = excluded.source_harness,
               source_model = excluded.source_model,
               session_id = excluded.session_id,
               body = excluded.body,
               structured_state = excluded.structured_state,
               updated_at = excluded.updated_at
             WHERE ie_planning_workflow_artifacts.actor_id = excluded.actor_id
             RETURNING artifact_id, actor_id, repo_id, roadmap_id, slice_id, kind, phase, status,
                       checksum, source_harness, source_model, session_id, body, structured_state,
                       created_at, updated_at",
            params![
                artifact_id, actor_id, repo_id, roadmap_id, slice_id, kind, phase, status, checksum,
                source_harness, source_model, session_id, body, state_str, created_at, updated_at
            ],
            |row| {
                let ss_raw: String = row.get(13)?;
                let ss_val: serde_json::Value =
                    serde_json::from_str(&ss_raw).unwrap_or(serde_json::Value::Null);
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
                    structured_state: ss_val,
                    created_at: row.get(14)?,
                    updated_at: row.get(15)?,
                })
            },
        );

        match result {
            Ok(row) => Ok(row),
            Err(rusqlite::Error::QueryReturnedNoRows) => {
                Err(PersistenceError::new(
                    "ownership_conflict",
                    "artifact_actor_id_mismatch",
                ))
            }
            Err(e) => Err(PersistenceError::from(e)),
        }
    }

    /// Read a workflow artifact by its ID.
    pub fn read_workflow_artifact(
        &self,
        artifact_id: &str,
    ) -> Result<Option<WorkflowArtifactRow>, PersistenceError> {
        let conn = self.conn();
        let mut stmt = conn.prepare(
            "SELECT artifact_id, actor_id, repo_id, roadmap_id, slice_id, kind, phase, status,
                    checksum, source_harness, source_model, session_id, body, structured_state,
                    created_at, updated_at
             FROM ie_planning_workflow_artifacts
             WHERE artifact_id = ?1",
        )?;
        let mut rows = stmt.query_map(params![artifact_id], |row| {
            let ss_raw: String = row.get(13)?;
            let ss_val: serde_json::Value =
                serde_json::from_str(&ss_raw).unwrap_or(serde_json::Value::Null);
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
                structured_state: ss_val,
                created_at: row.get(14)?,
                updated_at: row.get(15)?,
            })
        })?;
        match rows.next() {
            Some(Ok(row)) => Ok(Some(row)),
            Some(Err(e)) => Err(PersistenceError::from(e)),
            None => Ok(None),
        }
    }

    /// List workflow artifacts by roadmap_id, ordered by updated_at DESC.
    pub fn list_workflow_artifacts(
        &self,
        roadmap_id: &str,
    ) -> Result<Vec<WorkflowArtifactRow>, PersistenceError> {
        let conn = self.conn();
        let mut stmt = conn.prepare(
            "SELECT artifact_id, actor_id, repo_id, roadmap_id, slice_id, kind, phase, status,
                    checksum, source_harness, source_model, session_id, body, structured_state,
                    created_at, updated_at
             FROM ie_planning_workflow_artifacts
             WHERE roadmap_id = ?1
             ORDER BY updated_at DESC",
        )?;
        let rows = stmt.query_map(params![roadmap_id], |row| {
            let ss_raw: String = row.get(13)?;
            let ss_val: serde_json::Value =
                serde_json::from_str(&ss_raw).unwrap_or(serde_json::Value::Null);
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
                structured_state: ss_val,
                created_at: row.get(14)?,
                updated_at: row.get(15)?,
            })
        })?;
        let artifacts: Vec<WorkflowArtifactRow> = rows.filter_map(Result::ok).collect();
        Ok(artifacts)
    }

    // -----------------------------------------------------------------------
    // Compare Receipts CRUD
    // -----------------------------------------------------------------------

    /// Insert or update a compare receipt.
    pub fn persist_compare_receipt(
        &self,
        receipt_id: &str,
        actor_id: &str,
        repo_id: Option<&str>,
        compare_hash: &str,
        source_ids_hash: &str,
        source_ids: &serde_json::Value,
        version_vector: Option<&serde_json::Value>,
        gate_state: &str,
        merge_eligible: bool,
        reason: &str,
        downgrade: Option<&serde_json::Value>,
        issued_at: &str,
        expires_at: &str,
    ) -> Result<CompareReceiptRow, PersistenceError> {
        let conn = self.conn();
        let source_ids_str = json_to_string(source_ids);
        let vv_str = opt_json_to_string(&version_vector.map(|v| v.clone()));
        let downgrade_str = opt_json_to_string(&downgrade.map(|v| v.clone()));
        let merge_eligible_int: i32 = if merge_eligible { 1 } else { 0 };

        let row = conn.query_row(
            "INSERT INTO ie_planning_compare_receipts
             (receipt_id, actor_id, repo_id, compare_hash, source_ids_hash, source_ids,
              version_vector, gate_state, merge_eligible, reason, downgrade, issued_at, expires_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
             ON CONFLICT (receipt_id) DO UPDATE SET
               actor_id = excluded.actor_id,
               repo_id = excluded.repo_id,
               compare_hash = excluded.compare_hash,
               source_ids_hash = excluded.source_ids_hash,
               source_ids = excluded.source_ids,
               version_vector = excluded.version_vector,
               gate_state = excluded.gate_state,
               merge_eligible = excluded.merge_eligible,
               reason = excluded.reason,
               downgrade = excluded.downgrade,
               issued_at = excluded.issued_at,
               expires_at = excluded.expires_at
             RETURNING receipt_id, actor_id, repo_id, compare_hash, source_ids_hash, source_ids,
                       version_vector, gate_state, merge_eligible, reason, downgrade,
                       issued_at, expires_at, created_at",
            params![
                receipt_id, actor_id, repo_id, compare_hash, source_ids_hash, source_ids_str,
                vv_str, gate_state, merge_eligible_int, reason, downgrade_str,
                issued_at, expires_at
            ],
            |row| {
                let si_raw: String = row.get(5)?;
                let si_val: serde_json::Value =
                    serde_json::from_str(&si_raw).unwrap_or(serde_json::Value::Array(vec![]));
                let vv_raw: Option<String> = row.get(6)?;
                let vv_val: Option<serde_json::Value> = vv_raw
                    .and_then(|s| serde_json::from_str(&s).ok());
                let me_int: i32 = row.get(8)?;
                let dg_raw: Option<String> = row.get(10)?;
                let dg_val: Option<serde_json::Value> = dg_raw
                    .and_then(|s| serde_json::from_str(&s).ok());
                Ok(CompareReceiptRow {
                    receipt_id: row.get(0)?,
                    actor_id: row.get(1)?,
                    repo_id: row.get(2)?,
                    compare_hash: row.get(3)?,
                    source_ids_hash: row.get(4)?,
                    source_ids: si_val,
                    version_vector: vv_val,
                    gate_state: row.get(7)?,
                    merge_eligible: me_int != 0,
                    reason: row.get(9)?,
                    downgrade: dg_val,
                    issued_at: row.get(11)?,
                    expires_at: row.get(12)?,
                    created_at: row.get(13)?,
                })
            },
        )?;
        Ok(row)
    }

    /// Read a compare receipt by its ID, with expiry auto-delete.
    ///
    /// If the receipt is expired, it is deleted automatically and an error is returned.
    pub fn read_compare_receipt(
        &self,
        receipt_id: &str,
    ) -> Result<CompareReceiptRow, PersistenceError> {
        let conn = self.conn();

        // First, read the row to check expiry
        let row = conn.query_row(
            "SELECT receipt_id, actor_id, repo_id, compare_hash, source_ids_hash, source_ids,
                    version_vector, gate_state, merge_eligible, reason, downgrade,
                    issued_at, expires_at, created_at
             FROM ie_planning_compare_receipts
             WHERE receipt_id = ?1",
            params![receipt_id],
            |row| {
                let si_raw: String = row.get(5)?;
                let si_val: serde_json::Value =
                    serde_json::from_str(&si_raw).unwrap_or(serde_json::Value::Array(vec![]));
                let vv_raw: Option<String> = row.get(6)?;
                let vv_val: Option<serde_json::Value> = vv_raw
                    .and_then(|s| serde_json::from_str(&s).ok());
                let me_int: i32 = row.get(8)?;
                let dg_raw: Option<String> = row.get(10)?;
                let dg_val: Option<serde_json::Value> = dg_raw
                    .and_then(|s| serde_json::from_str(&s).ok());
                Ok(CompareReceiptRow {
                    receipt_id: row.get(0)?,
                    actor_id: row.get(1)?,
                    repo_id: row.get(2)?,
                    compare_hash: row.get(3)?,
                    source_ids_hash: row.get(4)?,
                    source_ids: si_val,
                    version_vector: vv_val,
                    gate_state: row.get(7)?,
                    merge_eligible: me_int != 0,
                    reason: row.get(9)?,
                    downgrade: dg_val,
                    issued_at: row.get(11)?,
                    expires_at: row.get(12)?,
                    created_at: row.get(13)?,
                })
            },
        )?;

        // Check expiry
        if is_expired(&row.expires_at) {
            conn.execute(
                "DELETE FROM ie_planning_compare_receipts WHERE receipt_id = ?1",
                params![receipt_id],
            )?;
            return Err(PersistenceError::new("invalid_compare_receipt", "compare_receipt_expired"));
        }

        Ok(row)
    }

    // -----------------------------------------------------------------------
    // Merge Intents CRUD
    // -----------------------------------------------------------------------

    /// Insert or update a merge intent.
    pub fn persist_merge_intent(
        &self,
        token_id: &str,
        compare_receipt_id: &str,
        actor_id: &str,
        repo_id: Option<&str>,
        target_id: &str,
        source_ids_hash: &str,
        compare_hash: &str,
        version_vector: Option<&serde_json::Value>,
        version_vector_hash: Option<&str>,
        issued_at: &str,
        expires_at: &str,
        consumed_at: Option<&str>,
    ) -> Result<MergeIntentRow, PersistenceError> {
        let conn = self.conn();
        let vv_str = opt_json_to_string(&version_vector.map(|v| v.clone()));

        let row = conn.query_row(
            "INSERT INTO ie_planning_merge_intents
             (token_id, compare_receipt_id, actor_id, repo_id, target_id, source_ids_hash,
              compare_hash, version_vector, version_vector_hash, issued_at, expires_at, consumed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
             ON CONFLICT (token_id) DO UPDATE SET
               compare_receipt_id = excluded.compare_receipt_id,
               actor_id = excluded.actor_id,
               repo_id = excluded.repo_id,
               target_id = excluded.target_id,
               source_ids_hash = excluded.source_ids_hash,
               compare_hash = excluded.compare_hash,
               version_vector = excluded.version_vector,
               version_vector_hash = excluded.version_vector_hash,
               issued_at = excluded.issued_at,
               expires_at = excluded.expires_at,
               consumed_at = excluded.consumed_at
             RETURNING token_id, compare_receipt_id, actor_id, repo_id, target_id, source_ids_hash,
                       compare_hash, version_vector, version_vector_hash, issued_at, expires_at,
                       consumed_at, created_at",
            params![
                token_id, compare_receipt_id, actor_id, repo_id, target_id, source_ids_hash,
                compare_hash, vv_str, version_vector_hash, issued_at, expires_at, consumed_at
            ],
            |row| {
                let vv_raw: Option<String> = row.get(7)?;
                let vv_val: Option<serde_json::Value> = vv_raw
                    .and_then(|s| serde_json::from_str(&s).ok());
                Ok(MergeIntentRow {
                    token_id: row.get(0)?,
                    compare_receipt_id: row.get(1)?,
                    actor_id: row.get(2)?,
                    repo_id: row.get(3)?,
                    target_id: row.get(4)?,
                    source_ids_hash: row.get(5)?,
                    compare_hash: row.get(6)?,
                    version_vector: vv_val,
                    version_vector_hash: row.get(8)?,
                    issued_at: row.get(9)?,
                    expires_at: row.get(10)?,
                    consumed_at: row.get(11)?,
                    created_at: row.get(12)?,
                })
            },
        )?;
        Ok(row)
    }

    /// Read a merge intent by its token ID, with expiry auto-delete.
    pub fn read_merge_intent(
        &self,
        token_id: &str,
    ) -> Result<MergeIntentRow, PersistenceError> {
        let conn = self.conn();

        let row = conn.query_row(
            "SELECT token_id, compare_receipt_id, actor_id, repo_id, target_id, source_ids_hash,
                    compare_hash, version_vector, version_vector_hash, issued_at, expires_at,
                    consumed_at, created_at
             FROM ie_planning_merge_intents
             WHERE token_id = ?1",
            params![token_id],
            |row| {
                let vv_raw: Option<String> = row.get(7)?;
                let vv_val: Option<serde_json::Value> = vv_raw
                    .and_then(|s| serde_json::from_str(&s).ok());
                Ok(MergeIntentRow {
                    token_id: row.get(0)?,
                    compare_receipt_id: row.get(1)?,
                    actor_id: row.get(2)?,
                    repo_id: row.get(3)?,
                    target_id: row.get(4)?,
                    source_ids_hash: row.get(5)?,
                    compare_hash: row.get(6)?,
                    version_vector: vv_val,
                    version_vector_hash: row.get(8)?,
                    issued_at: row.get(9)?,
                    expires_at: row.get(10)?,
                    consumed_at: row.get(11)?,
                    created_at: row.get(12)?,
                })
            },
        )?;

        // Check expiry
        if is_expired(&row.expires_at) {
            conn.execute(
                "DELETE FROM ie_planning_merge_intents WHERE token_id = ?1",
                params![token_id],
            )?;
            return Err(PersistenceError::new("invalid_confirmation_token", "token_expired"));
        }

        Ok(row)
    }

    /// Consume a merge intent by setting `consumed_at`.
    ///
    /// Returns the updated row. If the token is already consumed, returns an error.
    pub fn consume_merge_intent(
        &self,
        token_id: &str,
        consumed_at: &str,
    ) -> Result<MergeIntentRow, PersistenceError> {
        let conn = self.conn();

        let result = conn.query_row(
            "UPDATE ie_planning_merge_intents
             SET consumed_at = ?2
             WHERE token_id = ?1 AND consumed_at IS NULL
             RETURNING token_id, compare_receipt_id, actor_id, repo_id, target_id, source_ids_hash,
                       compare_hash, version_vector, version_vector_hash, issued_at, expires_at,
                       consumed_at, created_at",
            params![token_id, consumed_at],
            |row| {
                let vv_raw: Option<String> = row.get(7)?;
                let vv_val: Option<serde_json::Value> = vv_raw
                    .and_then(|s| serde_json::from_str(&s).ok());
                Ok(MergeIntentRow {
                    token_id: row.get(0)?,
                    compare_receipt_id: row.get(1)?,
                    actor_id: row.get(2)?,
                    repo_id: row.get(3)?,
                    target_id: row.get(4)?,
                    source_ids_hash: row.get(5)?,
                    compare_hash: row.get(6)?,
                    version_vector: vv_val,
                    version_vector_hash: row.get(8)?,
                    issued_at: row.get(9)?,
                    expires_at: row.get(10)?,
                    consumed_at: row.get(11)?,
                    created_at: row.get(12)?,
                })
            },
        );

        match result {
            Ok(row) => Ok(row),
            Err(rusqlite::Error::QueryReturnedNoRows) => {
                // Could be already consumed or not found — check which
                match self.read_merge_intent(token_id) {
                    Ok(existing) => {
                        if existing.consumed_at.is_some() {
                            Err(PersistenceError::new(
                                "invalid_confirmation_token",
                                "token_consumed",
                            ))
                        } else {
                            // shouldn't happen because row was returned for expire check
                            Err(PersistenceError::new(
                                "invalid_confirmation_token",
                                "token_not_found",
                            ))
                        }
                    }
                    Err(e) => Err(e),
                }
            }
            Err(e) => Err(PersistenceError::from(e)),
        }
    }

    // -----------------------------------------------------------------------
    // Merge Idempotency Ledger CRUD
    // -----------------------------------------------------------------------

    /// Persist an idempotency record.
    ///
    /// First reads the existing record. If the same key exists with a different
    /// `payload_hash`, returns an `idempotency_conflict` error. If the same key
    /// exists with the same hash, returns the record as a replay (no insert).
    /// Otherwise, inserts a new record.
    pub fn persist_merge_idempotency(
        &self,
        idempotency_key: &str,
        actor_id: &str,
        repo_id: Option<&str>,
        operation_type: &str,
        target_id: &str,
        source_ids_hash: &str,
        compare_hash: &str,
        payload_hash: &str,
        merge_record_id: Option<&str>,
        response: &serde_json::Value,
        expires_at: &str,
    ) -> Result<PersistIdempotencyResult, PersistenceError> {
        let conn = self.conn();

        // Check existing
        let existing = self.read_merge_idempotency_record(idempotency_key)?;

        if let Some(record) = existing {
            if record.payload_hash != payload_hash {
                return Ok(PersistIdempotencyResult {
                    record: None,
                    replay: false,
                    conflict: true,
                });
            }
            return Ok(PersistIdempotencyResult {
                record: Some(record),
                replay: true,
                conflict: false,
            });
        }

        let response_str = json_to_string(response);

        let row = conn.query_row(
            "INSERT INTO ie_planning_merge_idempotency_ledger
             (idempotency_key, actor_id, repo_id, operation_type, target_id, source_ids_hash,
              compare_hash, payload_hash, merge_record_id, response, expires_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
             RETURNING idempotency_key, actor_id, repo_id, operation_type, target_id,
                       source_ids_hash, compare_hash, payload_hash, merge_record_id,
                       response, created_at, expires_at",
            params![
                idempotency_key, actor_id, repo_id, operation_type, target_id, source_ids_hash,
                compare_hash, payload_hash, merge_record_id, response_str, expires_at
            ],
            |row| {
                let resp_raw: String = row.get(9)?;
                let resp_val: serde_json::Value =
                    serde_json::from_str(&resp_raw).unwrap_or(serde_json::Value::Object(Default::default()));
                Ok(MergeIdempotencyRow {
                    idempotency_key: row.get(0)?,
                    actor_id: row.get(1)?,
                    repo_id: row.get(2)?,
                    operation_type: row.get(3)?,
                    target_id: row.get(4)?,
                    source_ids_hash: row.get(5)?,
                    compare_hash: row.get(6)?,
                    payload_hash: row.get(7)?,
                    merge_record_id: row.get(8)?,
                    response: resp_val,
                    created_at: row.get(10)?,
                    expires_at: row.get(11)?,
                })
            },
        )?;

        Ok(PersistIdempotencyResult {
            record: Some(row),
            replay: false,
            conflict: false,
        })
    }

    /// Read an idempotency record by its key, with expiry auto-delete.
    pub fn read_merge_idempotency_record(
        &self,
        idempotency_key: &str,
    ) -> Result<Option<MergeIdempotencyRow>, PersistenceError> {
        let conn = self.conn();

        let result = conn.query_row(
            "SELECT idempotency_key, actor_id, repo_id, operation_type, target_id,
                    source_ids_hash, compare_hash, payload_hash, merge_record_id,
                    response, created_at, expires_at
             FROM ie_planning_merge_idempotency_ledger
             WHERE idempotency_key = ?1",
            params![idempotency_key],
            |row| {
                let resp_raw: String = row.get(9)?;
                let resp_val: serde_json::Value =
                    serde_json::from_str(&resp_raw).unwrap_or(serde_json::Value::Object(Default::default()));
                Ok(MergeIdempotencyRow {
                    idempotency_key: row.get(0)?,
                    actor_id: row.get(1)?,
                    repo_id: row.get(2)?,
                    operation_type: row.get(3)?,
                    target_id: row.get(4)?,
                    source_ids_hash: row.get(5)?,
                    compare_hash: row.get(6)?,
                    payload_hash: row.get(7)?,
                    merge_record_id: row.get(8)?,
                    response: resp_val,
                    created_at: row.get(10)?,
                    expires_at: row.get(11)?,
                })
            },
        );

        match result {
            Ok(row) => {
                if is_expired(&row.expires_at) {
                    conn.execute(
                        "DELETE FROM ie_planning_merge_idempotency_ledger WHERE idempotency_key = ?1",
                        params![idempotency_key],
                    )?;
                    return Ok(None);
                }
                Ok(Some(row))
            }
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(PersistenceError::from(e)),
        }
    }

    // -----------------------------------------------------------------------
    // Retention
    // -----------------------------------------------------------------------

    /// Run retention on `ie_planning_records` based on `updated_at`.
    ///
    /// `dry_run` controls whether records are actually deleted.
    pub fn run_retention(
        &self,
        older_than_days: u64,
        dry_run: bool,
    ) -> Result<RetentionResult, PersistenceError> {
        let conn = self.conn();
        let now = Utc::now();
        let cutoff = now - chrono::Duration::days(older_than_days as i64);
        let cutoff_str = cutoff.to_rfc3339();

        let mode = if dry_run { "dry-run".to_string() } else { "execute".to_string() };

        // Find candidates
        let mut stmt = conn.prepare(
            "SELECT record_id FROM ie_planning_records WHERE updated_at < ?1 ORDER BY record_id ASC",
        )?;
        let candidate_ids: Vec<String> = stmt
            .query_map(params![cutoff_str], |row| row.get(0))?
            .filter_map(Result::ok)
            .collect();

        let deleted_ids: Vec<String> = if !dry_run && !candidate_ids.is_empty() {
            // Delete each candidate and collect the returned IDs
            let mut del_stmt = conn.prepare(
                "DELETE FROM ie_planning_records WHERE record_id = ?1 RETURNING record_id",
            )?;
            let mut deleted = Vec::new();
            for id in &candidate_ids {
                let result: Option<String> = del_stmt
                    .query_row(params![id], |row| row.get(0))
                    .ok();
                if let Some(did) = result {
                    deleted.push(did);
                }
            }
            deleted
        } else {
            vec![]
        };

        Ok(RetentionResult {
            mode,
            candidate_count: candidate_ids.len(),
            deleted_count: deleted_ids.len(),
            candidate_record_ids: candidate_ids,
            deleted_record_ids: deleted_ids,
        })
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_db_path() -> std::path::PathBuf {
        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time travel")
            .as_nanos();
        std::env::temp_dir().join(format!("elegy-persistence-test-{}.db", ts))
    }

    fn setup_temp_db() -> (Database, std::path::PathBuf) {
        let path = temp_db_path();
        let db = Database::open(&path).expect("open temp db");
        (db, path)
    }

    fn make_state(thought: &str) -> serde_json::Value {
        serde_json::json!({"thought": thought})
    }

    // -----------------------------------------------------------------------
    // Planning Records
    // -----------------------------------------------------------------------

    #[test]
    fn test_persist_and_read_record() {
        let (db, path) = setup_temp_db();
        let p = Persistence::new(&db);

        let state = make_state("hello world");
        let row = p
            .persist_planning_record(
                "rec-1", "user-a", None, "user", &state, "2025-01-01T00:00:00Z", "2025-01-01T00:00:00Z",
            )
            .expect("persist record");
        assert_eq!(row.record_id, "rec-1");
        assert_eq!(row.owner_id, "user-a");

        let read = p
            .read_planning_record("rec-1")
            .expect("read record")
            .expect("record should exist");
        assert_eq!(read.record_id, "rec-1");
        assert_eq!(read.owner_id, "user-a");

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn test_list_records_by_owner() {
        let (db, path) = setup_temp_db();
        let p = Persistence::new(&db);

        p.persist_planning_record(
            "rec-a", "owner-1", None, "user", &make_state("a"),
            "2025-01-01T00:00:00Z", "2025-01-01T00:00:00Z",
        )
        .expect("persist a");
        p.persist_planning_record(
            "rec-b", "owner-1", None, "user", &make_state("b"),
            "2025-01-01T00:00:01Z", "2025-01-01T00:00:01Z",
        )
        .expect("persist b");

        let records = p.list_planning_records("owner-1").expect("list records");
        assert_eq!(records.len(), 2);
        // Ordered by updated_at DESC
        assert_eq!(records[0].record_id, "rec-b");

        let empty = p.list_planning_records("other-user").expect("list empty");
        assert_eq!(empty.len(), 0);

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn test_upsert_record() {
        let (db, path) = setup_temp_db();
        let p = Persistence::new(&db);

        // Insert
        let state1 = make_state("v1");
        p.persist_planning_record(
            "rec-upsert", "owner-x", None, "user", &state1,
            "2025-01-01T00:00:00Z", "2025-01-01T00:00:00Z",
        )
        .expect("insert");

        // Update with same id, different state
        let state2 = make_state("v2");
        p.persist_planning_record(
            "rec-upsert", "owner-x", None, "user", &state2,
            "2025-01-01T00:00:00Z", "2025-02-01T00:00:00Z",
        )
        .expect("upsert");

        let read = p
            .read_planning_record("rec-upsert")
            .expect("read")
            .expect("should exist");
        assert_eq!(read.state, state2);
        assert_eq!(read.updated_at, "2025-02-01T00:00:00Z");

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn test_delete_record() {
        let (db, path) = setup_temp_db();
        let p = Persistence::new(&db);

        let state = make_state("delete-me");
        p.persist_planning_record(
            "rec-del", "user-del", None, "user", &state,
            "2025-01-01T00:00:00Z", "2025-01-01T00:00:00Z",
        )
        .expect("persist");

        let deleted = p.delete_planning_record("rec-del").expect("delete");
        assert!(deleted);

        let exists = p
            .read_planning_record("rec-del")
            .expect("read after delete");
        assert!(exists.is_none());

        let deleted_again = p.delete_planning_record("rec-del").expect("delete again");
        assert!(!deleted_again);

        let _ = std::fs::remove_file(&path);
    }

    // -----------------------------------------------------------------------
    // Ownership guard
    // -----------------------------------------------------------------------

    #[test]
    fn test_ownership_guard_suggestion() {
        let (db, path) = setup_temp_db();
        let p = Persistence::new(&db);

        let state_a = make_state("actor a state");
        // Insert by actor A
        p.persist_planning_suggestion(
            "sug-1", "actor-a", None, "user", &state_a,
            "2025-01-01T00:00:00Z", "2025-01-01T00:00:00Z",
        )
        .expect("actor_a creates");

        // Try upsert by actor B — should fail ownership conflict
        let state_b = make_state("actor b state");
        let err = p
            .persist_planning_suggestion(
                "sug-1", "actor-b", None, "user", &state_b,
                "2025-01-01T00:00:00Z", "2025-02-01T00:00:00Z",
            )
            .expect_err("actor_b should be blocked");
        assert_eq!(err.code, "ownership_conflict");

        // Actor A can still update
        let state_a2 = make_state("actor a updated");
        let updated = p
            .persist_planning_suggestion(
                "sug-1", "actor-a", None, "user", &state_a2,
                "2025-01-01T00:00:00Z", "2025-03-01T00:00:00Z",
            )
            .expect("actor_a updates");
        assert_eq!(updated.state, state_a2);

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn test_ownership_guard_recap() {
        let (db, path) = setup_temp_db();
        let p = Persistence::new(&db);

        let state_a = make_state("a state");
        p.persist_planning_recap(
            "recap-1", "user-a", None, "user", &state_a,
            "2025-01-01T00:00:00Z", "2025-01-01T00:00:00Z",
        )
        .expect("user_a creates");

        let state_b = make_state("b state");
        let err = p
            .persist_planning_recap(
                "recap-1", "user-b", None, "user", &state_b,
                "2025-01-01T00:00:00Z", "2025-02-01T00:00:00Z",
            )
            .expect_err("user_b should be blocked");
        assert_eq!(err.code, "ownership_conflict");

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn test_ownership_guard_artifact() {
        let (db, path) = setup_temp_db();
        let p = Persistence::new(&db);

        let state = make_state("ss");
        p.persist_workflow_artifact(
            "art-1", "alice", None, "roadmap-1", None,
            "doc", "plan", "active", "sha256:abc",
            None, None, None, "body text", &state,
            "2025-01-01T00:00:00Z", "2025-01-01T00:00:00Z",
        )
        .expect("alice creates");

        let err = p
            .persist_workflow_artifact(
                "art-1", "bob", None, "roadmap-1", None,
                "doc", "plan", "active", "sha256:def",
                None, None, None, "bob body", &state,
                "2025-01-01T00:00:00Z", "2025-02-01T00:00:00Z",
            )
            .expect_err("bob should be blocked");
        assert_eq!(err.code, "ownership_conflict");

        let _ = std::fs::remove_file(&path);
    }

    // -----------------------------------------------------------------------
    // Expiry auto-delete
    // -----------------------------------------------------------------------

    #[test]
    fn test_expiry_auto_delete_receipt() {
        let (db, path) = setup_temp_db();
        let p = Persistence::new(&db);

        let past = "2020-01-01T00:00:00Z";
        let future = "2099-01-01T00:00:00Z";

        // Insert with past expiry
        p.persist_compare_receipt(
            "rec-expired", "actor-a", None, "hash-c", "hash-s",
            &serde_json::json!([]),
            None, "approved", true, "ok", None,
            "2020-01-01T00:00:00Z", past,
        )
        .expect("persist expired receipt");

        // Read should fail with expired
        let err = p
            .read_compare_receipt("rec-expired")
            .expect_err("should be expired");
        assert_eq!(err.reason, "compare_receipt_expired");

        // Insert with future expiry
        p.persist_compare_receipt(
            "rec-valid", "actor-a", None, "hash-c", "hash-s",
            &serde_json::json!([]),
            None, "approved", true, "ok", None,
            "2025-01-01T00:00:00Z", future,
        )
        .expect("persist valid receipt");

        let valid = p.read_compare_receipt("rec-valid").expect("should be valid");
        assert_eq!(valid.receipt_id, "rec-valid");

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn test_expiry_auto_delete_merge_intent() {
        let (db, path) = setup_temp_db();
        let p = Persistence::new(&db);

        let past = "2020-01-01T00:00:00Z";

        p.persist_merge_intent(
            "tok-expired", "receipt-1", "actor-a", None, "target-1",
            "hash-s", "hash-c", None, None,
            "2020-01-01T00:00:00Z", past, None,
        )
        .expect("persist expired intent");

        let err = p
            .read_merge_intent("tok-expired")
            .expect_err("should be expired");
        assert_eq!(err.reason, "token_expired");

        let _ = std::fs::remove_file(&path);
    }

    // -----------------------------------------------------------------------
    // Consume merge intent
    // -----------------------------------------------------------------------

    #[test]
    fn test_consume_merge_intent() {
        let (db, path) = setup_temp_db();
        let p = Persistence::new(&db);

        let future = "2099-01-01T00:00:00Z";

        p.persist_merge_intent(
            "tok-consume", "receipt-1", "actor-a", None, "target-1",
            "hash-s", "hash-c", None, None,
            "2025-01-01T00:00:00Z", future, None,
        )
        .expect("persist");

        let consumed = p
            .consume_merge_intent("tok-consume", "2025-06-01T00:00:00Z")
            .expect("consume");
        assert_eq!(consumed.consumed_at, Some("2025-06-01T00:00:00Z".to_string()));

        // Second consume should fail
        let err = p
            .consume_merge_intent("tok-consume", "2025-07-01T00:00:00Z")
            .expect_err("already consumed");
        assert_eq!(err.reason, "token_consumed");

        let _ = std::fs::remove_file(&path);
    }

    // -----------------------------------------------------------------------
    // Idempotency
    // -----------------------------------------------------------------------

    #[test]
    fn test_persist_merge_idempotency() {
        let (db, path) = setup_temp_db();
        let p = Persistence::new(&db);

        let future = "2099-01-01T00:00:00Z";
        let resp = serde_json::json!({"status": "ok"});

        // First insert
        let result = p
            .persist_merge_idempotency(
                "key-1", "actor-a", None, "merge", "target-1",
                "hash-s", "hash-c", "payload-1", None, &resp, future,
            )
            .expect("insert idempotency");
        assert!(!result.replay);
        assert!(!result.conflict);
        assert!(result.record.is_some());

        // Same key with same payload → replay
        let replay = p
            .persist_merge_idempotency(
                "key-1", "actor-a", None, "merge", "target-1",
                "hash-s", "hash-c", "payload-1", None, &resp, future,
            )
            .expect("replay idempotency");
        assert!(replay.replay);
        assert!(!replay.conflict);

        // Same key with different payload → conflict
        let conflict = p
            .persist_merge_idempotency(
                "key-1", "actor-a", None, "merge", "target-1",
                "hash-s", "hash-c", "payload-different", None, &resp, future,
            )
            .expect("conflict check");
        assert!(!conflict.replay);
        assert!(conflict.conflict);

        let _ = std::fs::remove_file(&path);
    }

    // -----------------------------------------------------------------------
    // Retention
    // -----------------------------------------------------------------------

    #[test]
    fn test_run_retention_dry_run() {
        let (db, path) = setup_temp_db();
        let p = Persistence::new(&db);

        let state = make_state("old");
        p.persist_planning_record(
            "rec-old", "user-x", None, "user", &state,
            "2020-01-01T00:00:00Z", "2020-01-01T00:00:00Z",
        )
        .expect("persist old");

        let state2 = make_state("recent");
        let now = Utc::now().to_rfc3339();
        p.persist_planning_record(
            "rec-recent", "user-x", None, "user", &state2,
            &now, &now,
        )
        .expect("persist recent");

        let result = p.run_retention(30, true).expect("retention dry-run");
        assert_eq!(result.mode, "dry-run");
        // The old record should be a candidate
        assert_eq!(result.candidate_count, 1);
        assert_eq!(result.candidate_record_ids[0], "rec-old");
        // No records should be deleted in dry-run mode
        assert_eq!(result.deleted_count, 0);

        // Verify the old record still exists
        let old = p
            .read_planning_record("rec-old")
            .expect("read old")
            .expect("should still exist in dry-run");
        assert_eq!(old.record_id, "rec-old");

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn test_run_retention_execute() {
        let (db, path) = setup_temp_db();
        let p = Persistence::new(&db);

        let state = make_state("old");
        p.persist_planning_record(
            "rec-old", "user-x", None, "user", &state,
            "2020-01-01T00:00:00Z", "2020-01-01T00:00:00Z",
        )
        .expect("persist old");

        let state2 = make_state("recent");
        let now = Utc::now().to_rfc3339();
        p.persist_planning_record(
            "rec-recent", "user-x", None, "user", &state2,
            &now, &now,
        )
        .expect("persist recent");

        let result = p.run_retention(30, false).expect("retention execute");
        assert_eq!(result.mode, "execute");
        assert_eq!(result.deleted_count, 1);
        assert_eq!(result.deleted_record_ids[0], "rec-old");

        // Verify old record is gone
        let old = p.read_planning_record("rec-old").expect("read old");
        assert!(old.is_none());

        // Recent record should still be there
        let recent = p
            .read_planning_record("rec-recent")
            .expect("read recent")
            .expect("recent should exist");
        assert_eq!(recent.record_id, "rec-recent");

        let _ = std::fs::remove_file(&path);
    }
}
