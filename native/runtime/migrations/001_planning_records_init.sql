CREATE TABLE IF NOT EXISTS ie_planning_records (
  record_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  repo_id TEXT,
  scope TEXT NOT NULL,
  state TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);