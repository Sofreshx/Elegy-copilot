CREATE TABLE IF NOT EXISTS ie_planning_compare_receipts (
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
);