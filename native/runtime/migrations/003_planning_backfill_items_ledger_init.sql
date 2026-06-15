CREATE TABLE IF NOT EXISTS ie_planning_backfill_items_ledger (
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
);