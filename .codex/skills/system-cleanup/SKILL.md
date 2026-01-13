---
name: system-cleanup
description: >
   Task file maintenance. Archives completed tasks and cleans up raw inputs. Use this for internal system maintenance only.
   Triggers on: "system cleanup", "archive completed tasks", "cleanup tasks".
---

# System Cleanup Skill

## Inputs
- `.instructions/tasks/`
- `.instructions/tasks.archive/`
- `.instructions/tasks.history.md`
- `.instructions/raw.tasks.md`

## Steps
1. **Archive Completed Task Files**:
   - Scan `.instructions/tasks/` for tasks with `status: done`.
   - For each completed task:
     - Move the task file into `.instructions/tasks.archive/`.
     - Update front matter: set `status: archived` and bump `updated`.
     - Append a one-line recap to `.instructions/tasks.history.md` (append-only).

2. **Initialize/Validate History**:
   - Ensure `.instructions/tasks.history.md` exists; create it if missing.
   - Keep it append-only; do not rewrite history.

3. **Clean Raw Inbox (Optional)**:
   - Scan `.instructions/raw.tasks.md`.
   - Remove entries that are completed (e.g., `[x]`) or explicitly linked to an archived task ID.
   - Keep remaining entries terse; collapse duplicates.

4. **Validation**:
   - Ensure no active (`not-started`, `in-progress`, `blocked`) tasks were accidentally archived.
   - Ensure archived files remain searchable by ID.

## Output
- Updated `.instructions/tasks/` (done tasks moved out).
- Updated `.instructions/raw.tasks.md` (cleaner).
- Updated `.instructions/tasks.archive/` (archived tasks).
- Updated `.instructions/tasks.history.md` (append-only recaps).
- Session summary of items archived and removed.


