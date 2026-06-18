CREATE TABLE IF NOT EXISTS ie_planning_merge_intents (
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
);