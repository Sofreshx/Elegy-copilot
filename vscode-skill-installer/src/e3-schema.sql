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
-- Todos (root orchestration container from prompt)
------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS todos (
  id           TEXT    PRIMARY KEY,
  session_id   TEXT    NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  title        TEXT    NOT NULL,
  summary      TEXT,
  status       TEXT    NOT NULL DEFAULT 'active'
                       CHECK(status IN ('active','completed','archived')),
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS todo_tasks (
  todo_id      TEXT    NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
  task_id      TEXT    NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  ordering     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (todo_id, task_id)
);

------------------------------------------------------------------------
-- Task Plans (nested planning attached to todo/task)
------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS task_plans (
  id              TEXT    PRIMARY KEY,
  session_id      TEXT    NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  todo_id         TEXT    REFERENCES todos(id) ON DELETE CASCADE,
  parent_plan_id  TEXT    REFERENCES task_plans(id) ON DELETE CASCADE,
  task_id         TEXT    REFERENCES tasks(id) ON DELETE SET NULL,
  title           TEXT    NOT NULL,
  summary         TEXT,
  level           INTEGER NOT NULL DEFAULT 0,
  status          TEXT    NOT NULL DEFAULT 'active'
                          CHECK(status IN ('active','completed','superseded','archived')),
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
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
-- Smart Context Phase B (additive, opt-in)
------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS context_links (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  source_note_id  INTEGER NOT NULL REFERENCES context_notes(id) ON DELETE CASCADE,
  target_note_id  INTEGER NOT NULL REFERENCES context_notes(id) ON DELETE CASCADE,
  link_type       TEXT    NOT NULL DEFAULT 'related',
  weight          REAL    NOT NULL DEFAULT 1.0,
  metadata        TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(source_note_id, target_note_id, link_type)
);

CREATE TABLE IF NOT EXISTS context_embeddings (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  note_id           INTEGER NOT NULL REFERENCES context_notes(id) ON DELETE CASCADE,
  provider          TEXT    NOT NULL,
  model             TEXT    NOT NULL,
  dimensions        INTEGER,
  embedding_ref     TEXT,          -- external vector store reference (optional)
  embedding_preview TEXT,          -- optional lightweight preview/debug payload
  metadata          TEXT,          -- JSON blob for provider-specific attributes
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(note_id, provider, model)
);

------------------------------------------------------------------------
-- Schema version  (for future migrations)
------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schema_version (
  version     INTEGER PRIMARY KEY,
  applied_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO schema_version (version) VALUES (1);
INSERT OR IGNORE INTO schema_version (version) VALUES (2);

------------------------------------------------------------------------
-- Indices
------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_tasks_status        ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_plan           ON tasks(plan_id);
CREATE INDEX IF NOT EXISTS idx_tasks_session        ON tasks(session_id);
CREATE INDEX IF NOT EXISTS idx_tasks_group          ON tasks(group_id, group_order);
CREATE INDEX IF NOT EXISTS idx_tasks_session_status ON tasks(session_id, status);
CREATE INDEX IF NOT EXISTS idx_exec_log_session     ON execution_log(session_id);
CREATE INDEX IF NOT EXISTS idx_exec_log_task        ON execution_log(task_id);
CREATE INDEX IF NOT EXISTS idx_context_scope        ON context_notes(scope, scope_id);
CREATE INDEX IF NOT EXISTS idx_context_links_source ON context_links(source_note_id);
CREATE INDEX IF NOT EXISTS idx_context_links_target ON context_links(target_note_id);
CREATE INDEX IF NOT EXISTS idx_context_embeddings_note ON context_embeddings(note_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status      ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_todos_session        ON todos(session_id);
CREATE INDEX IF NOT EXISTS idx_todos_status         ON todos(status);
CREATE INDEX IF NOT EXISTS idx_todo_tasks_task      ON todo_tasks(task_id);
CREATE INDEX IF NOT EXISTS idx_task_plans_session   ON task_plans(session_id);
CREATE INDEX IF NOT EXISTS idx_task_plans_todo      ON task_plans(todo_id);
CREATE INDEX IF NOT EXISTS idx_task_plans_parent    ON task_plans(parent_plan_id);
