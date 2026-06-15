CREATE TABLE IF NOT EXISTS ie_planning_workflow_artifacts (
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
);