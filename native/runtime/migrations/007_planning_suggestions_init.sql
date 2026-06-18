CREATE TABLE IF NOT EXISTS ie_planning_suggestions (
  suggestion_id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  repo_id TEXT,
  scope TEXT NOT NULL,
  state TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);