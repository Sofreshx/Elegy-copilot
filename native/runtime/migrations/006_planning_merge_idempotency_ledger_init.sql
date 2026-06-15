CREATE TABLE IF NOT EXISTS ie_planning_merge_idempotency_ledger (
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
);