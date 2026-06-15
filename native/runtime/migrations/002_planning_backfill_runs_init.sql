CREATE TABLE IF NOT EXISTS ie_planning_backfill_runs (
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
);