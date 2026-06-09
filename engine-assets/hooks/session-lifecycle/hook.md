---
hook_type: session_lifecycle
name: Session Lifecycle Recorder
kind: hook
triggers:
  - session_start
  - session_end
description: >
  Records all agent session lifecycle events to the hook_events table with 
  full metadata including session ID, worktree association, harness, model, 
  repo path, and plan ID. Provides a complete audit trail of agent activity.
events:
  - hook_type: session_start
    description: Records session creation with metadata (model, branch, plan).
    writes:
      - table: sessions
        fields: [id, status, title, repo_path, worktree_path, model, plan_id, started_at]
      - table: hook_events
        fields: [hook_type, session_id, worktree_id, event_data_json]
  - hook_type: session_end
    description: Records session completion with final status (completed/failed/cancelled).
    writes:
      - table: sessions
        fields: [status, ended_at]
      - table: hook_events
        fields: [hook_type, session_id, worktree_id, event_data_json]
query:
  endpoint: GET /api/elegy-db/hook-events?sessionId=<id>
  description: Returns all lifecycle events for a specific session.
---

## Session Lifecycle Recorder

Records every agent session start and end with full metadata.

### Tracked data per session
- Session ID, title, source harness
- Model used
- Repository path and branch
- Worktree path (if isolated)
- Plan/Goal ID (if part of a planning workflow)
- Start time and end time with final status

### Query examples
```
# All hook events for a session
GET /api/elegy-db/hook-events?sessionId=sdk_abc123

# Recent session_start events
GET /api/elegy-db/hook-events?hookType=session_start&limit=20
```
