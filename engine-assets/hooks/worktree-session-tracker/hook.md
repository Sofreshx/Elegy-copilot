---
hook_type: session_lifecycle
name: Worktree Session Tracker
kind: hook
triggers:
  - session_start
  - session_end
  - worktree_create
  - worktree_remove
description: >
  Tracks session lifecycle events for worktrees. When a session starts on a 
  worktree, the worktree is marked active and its session count increments. 
  When all sessions end, the worktree returns to idle. This enables the system 
  to answer: "does this worktree have a running session?"
events:
  - hook_type: session_start
    description: Fires when an executor session begins on a worktree.
    writes:
      - table: worktrees
        fields: [status, session_count, last_activity_at]
      - table: session_worktrees
        fields: [session_id, worktree_id, assigned_at]
      - table: hook_events
        fields: [hook_type, session_id, worktree_id, event_data_json]
  - hook_type: session_end
    description: Fires when an executor session completes, fails, or is cancelled.
    writes:
      - table: worktrees
        fields: [status, session_count, last_activity_at]
      - table: session_worktrees
        fields: [released_at]
      - table: hook_events
        fields: [hook_type, session_id, worktree_id, event_data_json]
  - hook_type: worktree_create
    description: Fires when a worktree is first created (before any session starts).
    writes:
      - table: worktrees
        fields: [status, path, repo_path, branch, created_at]
      - table: hook_events
        fields: [hook_type, worktree_id]
  - hook_type: worktree_remove
    description: Fires when a worktree is removed via git worktree remove.
    writes:
      - table: worktrees
        fields: [status]
      - table: hook_events
        fields: [hook_type, worktree_id]
query:
  endpoint: GET /api/elegy-db/worktrees/enriched
  description: Returns worktree list with recent hook events and session count.
  example: |
    curl /api/elegy-db/worktrees/enriched
    # Each worktree includes status (active/idle/done), session_count, and recent hook_events.
---

## Worktree Session Tracker

Tracks agent session lifecycle on git worktrees so the system always knows 
which worktrees are busy and which are available.

### State model

| Worktree Status | Meaning |
|----------------|---------|
| `active` | At least one session is running on this worktree |
| `idle` | No sessions running; worktree is available for reuse |
| `done` | Worktree has been removed |
| `ready` | Worktree created, not yet used by any session |

### How it works

1. **Session starts** → worktree marked `active`, `session_count++`
2. **Session ends** → `session_count--`; if 0, marked `idle`
3. **Worktree removed** → marked `done`

All events are recorded in the `hook_events` table and queryable via the 
worktrees enriched API.
