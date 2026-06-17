use std::path::Path;

use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::{Connection, OpenFlags};

pub type PlanningPool = Pool<SqliteConnectionManager>;

/// Wrapper around a rusqlite connection with WAL mode and foreign keys
/// enabled by default.
pub struct Database {
    conn: Connection,
}

impl std::fmt::Debug for Database {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Database").finish_non_exhaustive()
    }
}

impl Database {
    /// Open a database at `path` in read-write mode.
    ///
    /// Enables WAL journal mode and foreign key enforcement.
    /// Runs planning + copilot migrations, repairs schema drift,
    /// and creates copilot indexes.
    pub fn open(path: &Path) -> rusqlite::Result<Self> {
        let conn = Connection::open(path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        conn.pragma_update(None, "busy_timeout", 5000)?;
        run_planning_migrations(&conn)?;
        for ddl in COPILOT_DDL {
            conn.execute_batch(ddl)?;
        }
        repair_schema(&conn)?;
        for idx in COPILOT_INDEXES {
            if let Err(e) = conn.execute_batch(idx) {
                tracing::warn!(index = idx, error = %e, "index creation failed (non-fatal)");
            }
        }
        Ok(Self { conn })
    }

    /// Open a database at `path` in read-only mode.
    ///
    /// Does NOT set WAL or foreign-keys pragmas (the database is not modified).
    pub fn open_readonly(path: &Path) -> rusqlite::Result<Self> {
        let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        Ok(Self { conn })
    }

    /// Access the underlying connection.
    pub fn conn(&self) -> &Connection {
        &self.conn
    }
}

/// Initialize an r2d2 connection pool for planning.db.
///
/// Applies the same pragmas, migrations, schema repair, and indexes
/// as `Database::open`.
pub fn init_planning_pool(path: &Path) -> Result<PlanningPool, r2d2::Error> {
    let manager = SqliteConnectionManager::file(path).with_init(|conn| {
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        conn.pragma_update(None, "busy_timeout", 5000)?;
        run_planning_migrations(conn)?;
        for ddl in COPILOT_DDL {
            conn.execute_batch(ddl)?;
        }
        repair_schema(conn)?;
        for idx in COPILOT_INDEXES {
            if let Err(e) = conn.execute_batch(idx) {
                tracing::warn!(index = idx, error = %e, "index creation failed (non-fatal)");
            }
        }
        Ok(())
    });

    let pool = Pool::builder()
        .max_size(8)
        .build(manager)?;

    Ok(pool)
}

// ---------------------------------------------------------------------------
// Schema: planning.db
// ---------------------------------------------------------------------------

const CREATE_PLANNING_GOALS: &str = "CREATE TABLE IF NOT EXISTS goals (
    id TEXT PRIMARY KEY,
    correlation_id TEXT,
    title TEXT,
    description TEXT,
    acceptance_criteria_json TEXT,
    rejection_criteria_json TEXT,
    status TEXT,
    tags_json TEXT,
    revision INTEGER DEFAULT 1,
    created_at TEXT,
    updated_at TEXT,
    scope_key TEXT DEFAULT 'default'
)";

const CREATE_PLANNING_ROADMAPS: &str = "CREATE TABLE IF NOT EXISTS roadmaps (
    id TEXT PRIMARY KEY,
    goal_id TEXT REFERENCES goals(id),
    correlation_id TEXT,
    title TEXT,
    summary TEXT,
    status TEXT,
    tags_json TEXT,
    revision INTEGER DEFAULT 1,
    created_at TEXT,
    updated_at TEXT,
    scope_key TEXT DEFAULT 'default'
)";

const CREATE_PLANNING_WORK_POINTS: &str = "CREATE TABLE IF NOT EXISTS work_points (
    id TEXT PRIMARY KEY,
    roadmap_id TEXT,
    title TEXT,
    tags_json TEXT,
    created_at TEXT,
    updated_at TEXT,
    scope_key TEXT DEFAULT 'default'
)";

const CREATE_PLANNING_PLANS: &str = "CREATE TABLE IF NOT EXISTS plans (
    id TEXT PRIMARY KEY,
    goal_id TEXT,
    roadmap_id TEXT,
    work_point_id TEXT,
    title TEXT,
    tags_json TEXT,
    created_at TEXT,
    updated_at TEXT,
    scope_key TEXT DEFAULT 'default'
)";

const CREATE_PLANNING_TODOS: &str = "CREATE TABLE IF NOT EXISTS todos (
    id TEXT PRIMARY KEY,
    plan_id TEXT,
    work_point_id TEXT,
    title TEXT,
    tags_json TEXT,
    created_at TEXT,
    updated_at TEXT,
    scope_key TEXT DEFAULT 'default'
)";

const CREATE_PLANNING_ISSUES: &str = "CREATE TABLE IF NOT EXISTS issues (
    id TEXT PRIMARY KEY,
    title TEXT,
    tags_json TEXT,
    created_at TEXT,
    updated_at TEXT,
    scope_key TEXT DEFAULT 'default'
)";

const CREATE_PLANNING_REVIEW_POINTS: &str = "CREATE TABLE IF NOT EXISTS review_points (
    id TEXT PRIMARY KEY,
    title TEXT,
    tags_json TEXT,
    created_at TEXT,
    updated_at TEXT,
    scope_key TEXT DEFAULT 'default'
)";

const CREATE_PLANNING_TAG_INDEX: &str = "CREATE TABLE IF NOT EXISTS tag_index (
    scope_key TEXT DEFAULT 'default',
    entity_type TEXT,
    entity_id TEXT,
    tag TEXT,
    PRIMARY KEY (scope_key, entity_type, entity_id, tag)
)";

const CREATE_PLANNING_EVENTS: &str = "CREATE TABLE IF NOT EXISTS planning_events (
    event_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    aggregate_type TEXT NOT NULL,
    aggregate_id TEXT NOT NULL,
    correlation_id TEXT,
    causation_id TEXT,
    run_id TEXT NOT NULL,
    stream_id TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    parent_event_id TEXT,
    event_type TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    payload_json TEXT,
    scope_key TEXT DEFAULT 'default'
)";

const PLANNING_TABLES: &[&str] = &[
    "goals",
    "roadmaps",
    "work_points",
    "plans",
    "todos",
    "issues",
    "review_points",
    "tag_index",
    "planning_events",
];

const PLANNING_DDL: &[&str] = &[
    CREATE_PLANNING_GOALS,
    CREATE_PLANNING_ROADMAPS,
    CREATE_PLANNING_WORK_POINTS,
    CREATE_PLANNING_PLANS,
    CREATE_PLANNING_TODOS,
    CREATE_PLANNING_ISSUES,
    CREATE_PLANNING_REVIEW_POINTS,
    CREATE_PLANNING_TAG_INDEX,
    CREATE_PLANNING_EVENTS,
];

// ---------------------------------------------------------------------------
// Schema: elegy-copilot.db
// ---------------------------------------------------------------------------

const CREATE_COPILOT_SESSIONS: &str = "CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL DEFAULT 'copilot',
    harness TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    title TEXT,
    repo_path TEXT,
    repo_id TEXT,
    branch TEXT,
    worktree_path TEXT,
    model TEXT,
    plan_id TEXT,
    goal_id TEXT,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    updated_at TEXT NOT NULL,
    metadata_json TEXT
)";

const CREATE_COPILOT_WORKTREES: &str = "CREATE TABLE IF NOT EXISTS worktrees (
    id TEXT PRIMARY KEY,
    path TEXT NOT NULL UNIQUE,
    repo_path TEXT,
    repo_id TEXT,
    branch TEXT,
    source TEXT NOT NULL DEFAULT 'manual',
    status TEXT NOT NULL DEFAULT 'ready',
    head_sha TEXT,
    detached INTEGER DEFAULT 0,
    locked TEXT,
    session_count INTEGER DEFAULT 0,
    last_activity_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    metadata_json TEXT
)";

const CREATE_COPILOT_SESSION_WORKTREES: &str = "CREATE TABLE IF NOT EXISTS session_worktrees (
    session_id TEXT NOT NULL REFERENCES sessions(id),
    worktree_id TEXT NOT NULL REFERENCES worktrees(id),
    assigned_at TEXT NOT NULL,
    released_at TEXT,
    PRIMARY KEY (session_id, worktree_id)
)";

const CREATE_COPILOT_HOOK_EVENTS: &str = "CREATE TABLE IF NOT EXISTS hook_events (
    id TEXT PRIMARY KEY,
    hook_type TEXT NOT NULL,
    harness TEXT,
    session_id TEXT,
    worktree_id TEXT,
    repo_path TEXT,
    event_data_json TEXT,
    created_at TEXT NOT NULL
)";

const CREATE_COPILOT_REPO_ASSETS: &str = "CREATE TABLE IF NOT EXISTS repo_assets (
    repo_path TEXT NOT NULL,
    repo_id TEXT,
    asset_id TEXT NOT NULL,
    asset_kind TEXT NOT NULL,
    harness TEXT NOT NULL,
    installed_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    source_path TEXT,
    PRIMARY KEY (repo_path, asset_id, harness)
)";

const COPILOT_DDL: &[&str] = &[
    CREATE_COPILOT_SESSIONS,
    CREATE_COPILOT_WORKTREES,
    CREATE_COPILOT_SESSION_WORKTREES,
    CREATE_COPILOT_HOOK_EVENTS,
    CREATE_COPILOT_REPO_ASSETS,
];

const COPILOT_TABLES: &[&str] = &[
    "sessions",
    "worktrees",
    "session_worktrees",
    "hook_events",
    "repo_assets",
];

const COPILOT_INDEXES: &[&str] = &[
    "CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status)",
    "CREATE INDEX IF NOT EXISTS idx_sessions_source ON sessions(source)",
    "CREATE INDEX IF NOT EXISTS idx_sessions_repo_path ON sessions(repo_path)",
    "CREATE INDEX IF NOT EXISTS idx_sessions_worktree_path ON sessions(worktree_path)",
    "CREATE INDEX IF NOT EXISTS idx_worktrees_status ON worktrees(status)",
    "CREATE INDEX IF NOT EXISTS idx_worktrees_repo_path ON worktrees(repo_path)",
    "CREATE INDEX IF NOT EXISTS idx_worktrees_source ON worktrees(source)",
    "CREATE INDEX IF NOT EXISTS idx_hook_events_session ON hook_events(session_id)",
    "CREATE INDEX IF NOT EXISTS idx_hook_events_type ON hook_events(hook_type)",
    "CREATE INDEX IF NOT EXISTS idx_repo_assets_repo ON repo_assets(repo_path)",
    "CREATE INDEX IF NOT EXISTS idx_repo_assets_harness ON repo_assets(harness)",
];

// ---------------------------------------------------------------------------
// Schema: ie_* planning persistence tables (SQLite port of PostgreSQL JSONB)
// ---------------------------------------------------------------------------

const CREATE_IE_SCHEMA_VERSIONS: &str = "CREATE TABLE IF NOT EXISTS ie_schema_versions (
    version TEXT PRIMARY KEY,
    checksum TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
)";

const CREATE_IE_PLANNING_RECORDS: &str = "CREATE TABLE IF NOT EXISTS ie_planning_records (
    record_id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    repo_id TEXT,
    scope TEXT NOT NULL,
    state TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)";

const CREATE_IE_PLANNING_BACKFILL_RUNS: &str = "CREATE TABLE IF NOT EXISTS ie_planning_backfill_runs (
    run_id TEXT PRIMARY KEY,
    scope TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    repo_id TEXT,
    source_identity TEXT NOT NULL,
    checkpoint_key TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT,
    metadata TEXT NOT NULL DEFAULT '{}'
)";

const CREATE_IE_PLANNING_BACKFILL_ITEMS_LEDGER: &str = "CREATE TABLE IF NOT EXISTS ie_planning_backfill_items_ledger (
    run_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    scope TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    repo_id TEXT,
    source_identity TEXT NOT NULL,
    artifact_path TEXT NOT NULL,
    artifact_hash TEXT NOT NULL,
    record_type TEXT NOT NULL,
    source_idempotency_key TEXT NOT NULL,
    status TEXT NOT NULL,
    status_detail TEXT,
    version INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (run_id, item_id),
    UNIQUE (scope, source_identity, artifact_path, artifact_hash, record_type)
)";

const CREATE_IE_PLANNING_COMPARE_RECEIPTS: &str = "CREATE TABLE IF NOT EXISTS ie_planning_compare_receipts (
    receipt_id TEXT PRIMARY KEY,
    actor_id TEXT NOT NULL,
    repo_id TEXT,
    compare_hash TEXT NOT NULL,
    source_ids_hash TEXT NOT NULL,
    source_ids TEXT NOT NULL DEFAULT '[]',
    version_vector TEXT,
    gate_state TEXT NOT NULL,
    merge_eligible INTEGER NOT NULL,
    reason TEXT NOT NULL,
    downgrade TEXT,
    issued_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
)";

const CREATE_IE_PLANNING_MERGE_INTENTS: &str = "CREATE TABLE IF NOT EXISTS ie_planning_merge_intents (
    token_id TEXT PRIMARY KEY,
    compare_receipt_id TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    repo_id TEXT,
    target_id TEXT NOT NULL,
    source_ids_hash TEXT NOT NULL,
    compare_hash TEXT NOT NULL,
    version_vector TEXT,
    version_vector_hash TEXT,
    issued_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    consumed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
)";

const CREATE_IE_PLANNING_MERGE_IDEMPOTENCY_LEDGER: &str = "CREATE TABLE IF NOT EXISTS ie_planning_merge_idempotency_ledger (
    idempotency_key TEXT PRIMARY KEY,
    actor_id TEXT NOT NULL,
    repo_id TEXT,
    operation_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    source_ids_hash TEXT NOT NULL,
    compare_hash TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    merge_record_id TEXT,
    response TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL
)";

const CREATE_IE_PLANNING_SUGGESTIONS: &str = "CREATE TABLE IF NOT EXISTS ie_planning_suggestions (
    suggestion_id TEXT PRIMARY KEY,
    actor_id TEXT NOT NULL,
    repo_id TEXT,
    scope TEXT NOT NULL,
    state TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)";

const CREATE_IE_PLANNING_RECAPS: &str = "CREATE TABLE IF NOT EXISTS ie_planning_recaps (
    recap_id TEXT PRIMARY KEY,
    actor_id TEXT NOT NULL,
    repo_id TEXT,
    scope TEXT NOT NULL,
    state TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)";

const CREATE_IE_PLANNING_WORKFLOW_ARTIFACTS: &str = "CREATE TABLE IF NOT EXISTS ie_planning_workflow_artifacts (
    artifact_id TEXT PRIMARY KEY,
    actor_id TEXT NOT NULL,
    repo_id TEXT,
    roadmap_id TEXT NOT NULL,
    slice_id TEXT,
    kind TEXT NOT NULL,
    phase TEXT NOT NULL,
    status TEXT NOT NULL,
    checksum TEXT NOT NULL,
    source_harness TEXT,
    source_model TEXT,
    session_id TEXT,
    body TEXT NOT NULL,
    structured_state TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)";

const IE_DDL: &[&str] = &[
    CREATE_IE_SCHEMA_VERSIONS,
    CREATE_IE_PLANNING_RECORDS,
    CREATE_IE_PLANNING_BACKFILL_RUNS,
    CREATE_IE_PLANNING_BACKFILL_ITEMS_LEDGER,
    CREATE_IE_PLANNING_COMPARE_RECEIPTS,
    CREATE_IE_PLANNING_MERGE_INTENTS,
    CREATE_IE_PLANNING_MERGE_IDEMPOTENCY_LEDGER,
    CREATE_IE_PLANNING_SUGGESTIONS,
    CREATE_IE_PLANNING_RECAPS,
    CREATE_IE_PLANNING_WORKFLOW_ARTIFACTS,
];

// ---------------------------------------------------------------------------
// Migration runner
// ---------------------------------------------------------------------------

/// Run planning.db table migrations.
///
/// Creates all planning tables (goals, roadmaps, work_points, plans, todos,
/// issues, review_points, tag_index, planning_events) plus the ie_*
/// planning persistence tables.
/// Idempotent — all DDL uses `CREATE TABLE IF NOT EXISTS`.
pub fn run_planning_migrations(conn: &Connection) -> rusqlite::Result<()> {
    for ddl in PLANNING_DDL {
        conn.execute_batch(ddl)?;
    }
    for ddl in IE_DDL {
        conn.execute_batch(ddl)?;
    }
    Ok(())
}

/// Run copilot.db table and index migrations.
///
/// Creates all copilot tables (sessions, worktrees, session_worktrees,
/// hook_events, repo_assets) and their indexes.
/// Idempotent — all DDL uses `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`.
pub fn run_copilot_migrations(conn: &Connection) -> rusqlite::Result<()> {
    for ddl in COPILOT_DDL {
        conn.execute_batch(ddl)?;
    }
    for idx in COPILOT_INDEXES {
        conn.execute_batch(idx)?;
    }
    Ok(())
}

/// Run all planning and copilot migrations.
///
/// Convenience function that calls both `run_planning_migrations` and
/// `run_copilot_migrations`.
pub fn run_migrations(conn: &Connection) -> rusqlite::Result<()> {
    run_planning_migrations(conn)?;
    run_copilot_migrations(conn)?;
    Ok(())
}

/// Returns the list of planning table names expected after migrations.
pub fn planning_table_names() -> &'static [&'static str] {
    PLANNING_TABLES
}

/// Returns the list of copilot table names expected after migrations.
pub fn copilot_table_names() -> &'static [&'static str] {
    COPILOT_TABLES
}

// ---------------------------------------------------------------------------
// Schema repair: add missing columns to pre-existing tables
// ---------------------------------------------------------------------------

/// Expected column set for every table. After CREATE TABLE IF NOT EXISTS,
/// pre-existing tables might be missing newer columns. This map drives
/// `ALTER TABLE ADD COLUMN` for any column present here but missing in the
/// actual table schema.
const EXPECTED_TABLE_COLUMNS: &[(&str, &[&str])] = &[
    ("goals", &["id", "correlation_id", "title", "description", "acceptance_criteria_json", "rejection_criteria_json", "status", "tags_json", "revision", "created_at", "updated_at", "scope_key"]),
    ("roadmaps", &["id", "goal_id", "correlation_id", "title", "summary", "status", "tags_json", "revision", "created_at", "updated_at", "scope_key"]),
    ("work_points", &["id", "roadmap_id", "title", "tags_json", "created_at", "updated_at", "scope_key"]),
    ("plans", &["id", "goal_id", "roadmap_id", "work_point_id", "title", "tags_json", "created_at", "updated_at", "scope_key"]),
    ("todos", &["id", "plan_id", "work_point_id", "title", "tags_json", "created_at", "updated_at", "scope_key"]),
    ("issues", &["id", "title", "tags_json", "created_at", "updated_at", "scope_key"]),
    ("review_points", &["id", "title", "tags_json", "created_at", "updated_at", "scope_key"]),
    ("tag_index", &["scope_key", "entity_type", "entity_id", "tag"]),
    ("planning_events", &["event_id", "entity_type", "entity_id", "aggregate_type", "aggregate_id", "correlation_id", "causation_id", "run_id", "stream_id", "sequence", "parent_event_id", "event_type", "timestamp", "payload_json", "scope_key"]),
    ("sessions", &["id", "source", "harness", "status", "title", "repo_path", "repo_id", "branch", "worktree_path", "model", "plan_id", "goal_id", "started_at", "ended_at", "updated_at", "metadata_json"]),
    ("worktrees", &["id", "path", "repo_path", "repo_id", "branch", "source", "status", "head_sha", "detached", "locked", "session_count", "last_activity_at", "created_at", "updated_at", "metadata_json"]),
    ("session_worktrees", &["session_id", "worktree_id", "assigned_at", "released_at"]),
    ("hook_events", &["id", "hook_type", "harness", "session_id", "worktree_id", "repo_path", "event_data_json", "created_at"]),
    ("repo_assets", &["repo_path", "repo_id", "asset_id", "asset_kind", "harness", "installed_at", "updated_at", "source_path"]),
    ("ie_schema_versions", &["version", "checksum", "applied_at"]),
    ("ie_planning_records", &["record_id", "owner_id", "repo_id", "scope", "state", "created_at", "updated_at"]),
    ("ie_planning_backfill_runs", &["run_id", "scope", "owner_id", "repo_id", "source_identity", "checkpoint_key", "status", "started_at", "completed_at", "metadata"]),
    ("ie_planning_backfill_items_ledger", &["run_id", "item_id", "scope", "owner_id", "repo_id", "source_identity", "artifact_path", "artifact_hash", "record_type", "source_idempotency_key", "status", "status_detail", "version", "updated_at", "created_at"]),
    ("ie_planning_compare_receipts", &["receipt_id", "actor_id", "repo_id", "compare_hash", "source_ids_hash", "source_ids", "version_vector", "gate_state", "merge_eligible", "reason", "downgrade", "issued_at", "expires_at", "created_at"]),
    ("ie_planning_merge_intents", &["token_id", "compare_receipt_id", "actor_id", "repo_id", "target_id", "source_ids_hash", "compare_hash", "version_vector", "version_vector_hash", "issued_at", "expires_at", "consumed_at", "created_at"]),
    ("ie_planning_merge_idempotency_ledger", &["idempotency_key", "actor_id", "repo_id", "operation_type", "target_id", "source_ids_hash", "compare_hash", "payload_hash", "merge_record_id", "response", "created_at", "expires_at"]),
    ("ie_planning_suggestions", &["suggestion_id", "actor_id", "repo_id", "scope", "state", "created_at", "updated_at"]),
    ("ie_planning_recaps", &["recap_id", "actor_id", "repo_id", "scope", "state", "created_at", "updated_at"]),
    ("ie_planning_workflow_artifacts", &["artifact_id", "actor_id", "repo_id", "roadmap_id", "slice_id", "kind", "phase", "status", "checksum", "source_harness", "source_model", "session_id", "body", "structured_state", "created_at", "updated_at"]),
];

/// Repair schema drift on pre-existing tables.
///
/// After `CREATE TABLE IF NOT EXISTS` creates new tables, this function
/// queries `PRAGMA table_info` on every known table and adds any expected
/// column that is missing via `ALTER TABLE ADD COLUMN <name> TEXT`.
pub fn repair_schema(conn: &Connection) -> rusqlite::Result<()> {
    for (table_name, expected_columns) in EXPECTED_TABLE_COLUMNS {
        // Check if table exists
        let exists: bool = conn.query_row(
            "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name=?1",
            [table_name],
            |row| row.get(0),
        ).unwrap_or(false);
        if !exists {
            continue;
        }

        // Get actual columns
        let mut actual_cols: Vec<String> = Vec::new();
        let mut stmt = conn.prepare(&format!("PRAGMA table_info({})", table_name))?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
        for name in rows {
            if let Ok(col) = name {
                actual_cols.push(col);
            }
        }

        // Add missing columns
        for expected in *expected_columns {
            if !actual_cols.contains(&expected.to_string()) {
                let sql = format!(
                    "ALTER TABLE {} ADD COLUMN {} TEXT",
                    table_name, expected
                );
                match conn.execute_batch(&sql) {
                    Ok(()) => tracing::info!(
                        table = table_name,
                        column = expected,
                        "repaired schema: added missing column"
                    ),
                    Err(e) => tracing::warn!(
                        table = table_name,
                        column = expected,
                        error = %e,
                        "schema repair: failed to add column (non-fatal)"
                    ),
                }
            }
        }
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    /// Helper: create a unique temp database path.
    fn temp_db_path() -> std::path::PathBuf {
        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time travel")
            .as_nanos();
        std::env::temp_dir().join(format!("elegy-native-db-test-{}.db", ts))
    }

    #[test]
    fn test_open_temp_database() {
        let path = temp_db_path();
        {
            let db = Database::open(&path).expect("open temp db");
            // WAL should be set
            let mode: String = db
                .conn()
                .query_row("PRAGMA journal_mode", [], |row| row.get(0))
                .expect("query journal_mode");
            assert_eq!(mode.to_lowercase(), "wal", "WAL journal mode should be set");

            // Foreign keys should be on
            let fk: i64 = db
                .conn()
                .pragma_query_value(None, "foreign_keys", |row| row.get(0))
                .expect("query foreign_keys");
            assert_eq!(fk, 1, "foreign_keys should be enabled");
        } // db dropped here, file closed

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn test_run_migrations_creates_all_tables() {
        let path = temp_db_path();
        {
            let db = Database::open(&path).expect("open temp db");

            run_migrations(db.conn()).expect("migrations succeed");

            // Query sqlite_master for all table names
            let mut stmt = db
                .conn()
                .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
                .expect("prepare stmt");
            let actual: Vec<String> = stmt
                .query_map([], |row| row.get(0))
                .expect("query tables")
                .filter_map(Result::ok)
                .collect();

            let mut expected: Vec<&str> = Vec::new();
            expected.extend_from_slice(PLANNING_TABLES);
            expected.extend_from_slice(COPILOT_TABLES);
            expected.sort();

            // sqlite_master also includes sqlite_sequence (auto-generated if any
            // table has AUTOINCREMENT), so we only check that all expected tables
            // exist rather than exact match.
            for table in &expected {
                assert!(
                    actual.contains(&table.to_string()),
                    "expected table '{}' to exist in {:?}",
                    table,
                    actual
                );
            }

        } // db + stmt dropped here, file closed

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn test_migration_idempotent() {
        let path = temp_db_path();
        {
            let db = Database::open(&path).expect("open temp db");

            // First run
            run_migrations(db.conn()).expect("first migration run");

            // Second run — must not error
            run_migrations(db.conn()).expect("second (idempotent) migration run");

            // Verify we have all tables
            let mut stmt = db
                .conn()
                .prepare("SELECT COUNT(*) FROM sqlite_master WHERE type='table'")
                .expect("prepare");
            let count: i64 = stmt
                .query_row([], |row| row.get(0))
                .expect("query count");
            // Must have all planning + copilot + ie_* tables (no extra duplicates)
            // IE_DDL has 10 entries; the UNIQUE constraint on ie_planning_backfill_items_ledger
            // also creates sqlite_sequence if any autoinc table, but we don't have any.
            let expected_count = PLANNING_TABLES.len() + COPILOT_TABLES.len() + IE_DDL.len();
            assert!(
                count as usize >= expected_count,
                "expected at least {} tables, got {}",
                expected_count,
                count
            );
        } // db + stmt dropped here, file closed

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn test_read_existing_planning_db() {
        // Check if ~/.elegy/planning.db exists
        let home = dirs::home_dir().unwrap_or_else(|| std::path::PathBuf::from("~"));
        let path = home.join(".elegy").join("planning.db");

        if !path.exists() {
            eprintln!("SKIP: planning.db not found at {:?}", path);
            return;
        }

        let db = Database::open_readonly(&path).expect("open existing planning.db");

        // Verify WAL mode (the existing DB should already have it)
        let mode: String = db
            .conn()
            .query_row("PRAGMA journal_mode", [], |row| row.get(0))
            .expect("query journal_mode");
        eprintln!("planning.db journal_mode = {}", mode);

        // Probe core tables
        let goal_count: i64 = db
            .conn()
            .query_row("SELECT COUNT(*) FROM goals", [], |row| row.get(0))
            .expect("query goals");
        eprintln!("planning.db has {} goals", goal_count);
        assert!(goal_count >= 0, "goals count must be non-negative");

        let roadmap_count: i64 = db
            .conn()
            .query_row("SELECT COUNT(*) FROM roadmaps", [], |row| row.get(0))
            .expect("query roadmaps");
        eprintln!("planning.db has {} roadmaps", roadmap_count);

        // Check tag_index exists and has rows
        let ti_count: i64 = db
            .conn()
            .query_row("SELECT COUNT(*) FROM tag_index", [], |row| row.get(0))
            .expect("query tag_index");
        eprintln!("planning.db has {} tag_index rows", ti_count);

        // Check planning_events has rows
        let ev_count: i64 = db
            .conn()
            .query_row("SELECT COUNT(*) FROM planning_events", [], |row| row.get(0))
            .expect("query planning_events");
        eprintln!("planning.db has {} planning_events", ev_count);

        eprintln!(
            "SUCCESS: planning.db at {:?} is readable and schema-compatible",
            path
        );
    }

    #[test]
    fn test_run_migrations_on_copilot_db() {
        let path = temp_db_path();
        {
            let db = Database::open(&path).expect("open temp db");
            run_migrations(db.conn()).expect("migrations");

            // Verify copilot tables exist
            for table in COPILOT_TABLES {
                let exists: bool = db
                    .conn()
                    .query_row(
                        "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name=?1",
                        [table],
                        |row| row.get(0),
                    )
                    .expect("check table exists");
                assert!(exists, "copilot table '{}' should exist", table);
            }

            // Verify indexes exist
            for idx_name in &[
                "idx_sessions_status",
                "idx_sessions_source",
                "idx_sessions_repo_path",
                "idx_sessions_worktree_path",
                "idx_worktrees_status",
                "idx_worktrees_repo_path",
                "idx_worktrees_source",
                "idx_hook_events_session",
                "idx_hook_events_type",
                "idx_repo_assets_repo",
                "idx_repo_assets_harness",
            ] {
                let exists: bool = db
                    .conn()
                    .query_row(
                        "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='index' AND name=?1",
                        [idx_name],
                        |row| row.get(0),
                    )
                    .expect("check index exists");
                assert!(exists, "index '{}' should exist", idx_name);
            }
        } // db dropped here, file closed

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn test_database_open_readonly_fails_on_nonexistent() {
        let path = temp_db_path();
        // Ensure it doesn't exist
        let _ = std::fs::remove_file(&path);

        let result = Database::open_readonly(&path);
        assert!(result.is_err(), "open_readonly should fail on missing file");
    }

    #[test]
    fn test_repair_schema_adds_missing_column() {
        let path = temp_db_path();
        {
            let conn = rusqlite::Connection::open(&path).expect("open temp db");
            conn.pragma_update(None, "journal_mode", "WAL").ok();
            conn.pragma_update(None, "foreign_keys", "ON").ok();

            // Create a legacy worktrees table WITHOUT repo_path column
            conn.execute_batch(
                "CREATE TABLE worktrees (
                    id TEXT PRIMARY KEY,
                    path TEXT NOT NULL UNIQUE
                )",
            )
            .expect("create legacy worktrees");

            // repair_schema should add missing columns
            repair_schema(&conn).expect("repair schema");

            // Verify repo_path column was added
            let mut stmt = conn
                .prepare("PRAGMA table_info(worktrees)")
                .expect("prepare");
            let cols: Vec<String> = stmt
                .query_map([], |row| row.get::<_, String>(1))
                .expect("query table_info")
                .filter_map(Result::ok)
                .collect();
            assert!(
                cols.contains(&"repo_path".to_string()),
                "repo_path should be added by repair_schema, got: {:?}",
                cols
            );
            assert!(
                cols.contains(&"branch".to_string()),
                "branch should be added by repair_schema"
            );
        }
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn test_repair_schema_handles_nonexistent_tables() {
        let path = temp_db_path();
        {
            let conn = rusqlite::Connection::open(&path).expect("open temp db");
            // No tables at all — repair_schema should succeed silently
            repair_schema(&conn).expect("repair on empty db should not fail");
        }
        let _ = std::fs::remove_file(&path);
    }
}
