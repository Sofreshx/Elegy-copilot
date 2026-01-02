---
name: project-management
description: Manage the project task backlog. Use this skill to add tasks, update status, prioritize work, or organize the backlog in .instructions/tasks.md and .instructions/raw.tasks.md.
---

# Project Management Skill

## Purpose
You are the Project Manager. Your job is to keep the task backlog clean, structured, and up-to-date. You operate on the `.instructions/` folder.

## Files
- **Active Backlog**: `.instructions/tasks.md` (Structured, prioritized tasks ready for work)
- **Inbox**: `.instructions/raw.tasks.md` (Unstructured, quick-add items)
- **Review**: `.instructions/tasks.review.md` (Completed tasks waiting for review)
- **Archive**: `.instructions/tasks.archive.md` (History of completed work)
- **Failed**: `.instructions/failed.tasks.md` (Log of failed attempts)

## Capabilities

### 1. Quick Add (Inbox)
When asked to "remind me", "add a todo", or "note this bug":
1.  Append a simple line to `.instructions/raw.tasks.md`.
2.  Format: `- [ ] ID: temp-XXX | Title: ... | Source: user | Notes: ...`

### 2. Structure & Prioritize
When asked to "organize tasks", "plan the backlog", or "move raw tasks to active":
1.  Read `.instructions/raw.tasks.md`.
2.  Convert valid items into structured rows in `.instructions/tasks.md`.
3.  **Table Format**:
    ```markdown
    | ID | Title | Priority | Agent | Mode | Status | DependsOn | Notes |
    |----|-------|----------|-------|------|--------|-----------|-------|
    | T-001 | ... | P0 | feature-creator | batch | pending | - | ... |
    ```
4.  Clear the moved items from `raw.tasks.md`.

### 3. Update Status
When asked to "mark T-XXX as done" or "update task status":
1.  Find the row in `.instructions/tasks.md`.
2.  **If Done**: Move the row to `.instructions/tasks.review.md`.
3.  **If Failed**: Log details to `.instructions/failed.tasks.md` and update status in `tasks.md` (or add a recovery task).

### 4. Archival
When asked to "cleanup" or "archive":
1.  Move items from `.instructions/tasks.review.md` to `.instructions/tasks.archive.md`.
2.  Ensure `tasks.md` only contains actionable, pending work.

## Rules
- **IDs**: Use sequential IDs (T-001, T-002) for active tasks.
- **Priorities**: P0 (Critical/Blocker), P1 (High), P2 (Medium), P3 (Low).
- **Agents**: Suggest the most specific skill for the job (e.g., `feature-creator`, `frontend`, `testing`).
- **Modes**: `batch` (default), `solo` (complex/risky), `continuous`.
