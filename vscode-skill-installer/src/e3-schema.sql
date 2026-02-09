-- Executive3 SQLite Schema
-- Managed by the Instruction Engine VS Code extension.
-- Location: VS Code workspace storage (never committed to git).
-- Initialized via executive3.ensureDb command or e3:init npm script.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

------------------------------------------------------------------------
-- Plans
------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS plans (
  id           TEXT    PRIMARY KEY,
  title        TEXT    NOT NULL,
  summary      TEXT,
  status       TEXT    NOT NULL DEFAULT 'active'
                       CHECK(status IN ('active','superseded','archived')),
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

------------------------------------------------------------------------
-- Sessions  (one per executive3 invocation / resume)
------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
  id               TEXT    PRIMARY KEY,
  plan_id          TEXT    REFERENCES plans(id),
  status           TEXT    NOT NULL DEFAULT 'active'
                           CHECK(status IN ('active','completed','abandoned')),
  request_summary  TEXT,          -- compressed original user request
  context_snapshot TEXT,          -- JSON: compressed project context loaded at bootstrap
  started_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  ended_at         TEXT,
  replan_count     INTEGER NOT NULL DEFAULT 0
);

------------------------------------------------------------------------
-- Tasks
------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tasks (
  id                  TEXT    PRIMARY KEY,
  plan_id             TEXT    REFERENCES plans(id),
  session_id          TEXT    REFERENCES sessions(id),
  title               TEXT    NOT NULL,
  description         TEXT,
  acceptance_criteria TEXT,          -- markdown / bullet list
  status              TEXT    NOT NULL DEFAULT 'not-started'
                             CHECK(status IN ('not-started','in-progress','done','blocked','failed')),
  group_id            TEXT,
  group_title         TEXT,
  group_order         INTEGER,
  priority            INTEGER NOT NULL DEFAULT 0,   -- 0=low, 1=medium, 2=high, 3=critical
  depends_on          TEXT    DEFAULT '[]',          -- JSON array of task IDs
  skills              TEXT    DEFAULT '[]',          -- JSON array of skill names
  attempt_count       INTEGER NOT NULL DEFAULT 0,
  error_summary       TEXT,
  created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  completed_at        TEXT
);

------------------------------------------------------------------------
-- Execution log  (append-only audit trail)
------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS execution_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT    NOT NULL REFERENCES sessions(id),
  task_id     TEXT    REFERENCES tasks(id),
  agent_name  TEXT    NOT NULL,
  action      TEXT    NOT NULL
              CHECK(action IN (
                'started','completed','failed','replanned',
                'delegated','tested','reviewed','skipped','resumed','created'
              )),
  detail      TEXT,          -- JSON blob with arbitrary context
  timestamp   TEXT    NOT NULL DEFAULT (datetime('now'))
);

------------------------------------------------------------------------
-- Context notes  (cross-session learned facts / memories)
------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS context_notes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  scope       TEXT    NOT NULL CHECK(scope IN ('project','session','task')),
  scope_id    TEXT,          -- session id or task id (null for project scope)
  key         TEXT    NOT NULL,
  value       TEXT    NOT NULL,
  citations   TEXT,          -- JSON array of file:line references
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  expires_at  TEXT           -- optional TTL for transient notes
);

------------------------------------------------------------------------
-- Schema version  (for future migrations)
------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schema_version (
  version     INTEGER PRIMARY KEY,
  applied_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO schema_version (version) VALUES (1);

------------------------------------------------------------------------
-- Indices
------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_tasks_status        ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_plan           ON tasks(plan_id);
CREATE INDEX IF NOT EXISTS idx_tasks_session        ON tasks(session_id);
CREATE INDEX IF NOT EXISTS idx_tasks_group          ON tasks(group_id, group_order);
CREATE INDEX IF NOT EXISTS idx_exec_log_session     ON execution_log(session_id);
CREATE INDEX IF NOT EXISTS idx_exec_log_task        ON execution_log(task_id);
CREATE INDEX IF NOT EXISTS idx_context_scope        ON context_notes(scope, scope_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status      ON sessions(status);
