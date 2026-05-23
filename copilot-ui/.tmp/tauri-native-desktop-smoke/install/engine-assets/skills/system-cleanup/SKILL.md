---
name: system-cleanup
description: "Deprecated compatibility surface for legacy task and backlog cleanup flows. Not auto-selected in normal routing; load only for explicit system-cleanup requests or legacy compatibility. Triggers on: system cleanup, archive completed tasks, cleanup tasks."
---

# System Cleanup Skill

This skill is a deprecated compatibility surface for legacy cleanup flows. Normal routing should not auto-select it; load it only when the caller explicitly asks for `system-cleanup` or an older workflow still depends on that exact surface.

## Inputs
- Active host/session task artifacts or orchestrator state
- Repo-documented backlog or issue notes when the repository uses them
- Sanctioned temp roots (`.tmp/llm-input/`, `.tmp/llm-output/`, `.tmp/llm-work/`) when cleanup includes generated artifacts
- Legacy `.instructions/tasks/`, `.instructions/tasks.archive/`, `.instructions/tasks.history.md`, and `.instructions/raw.tasks.md` only when the repo explicitly opts into that compatibility layout

## Steps
1. **Archive Completed Task Files**:
   - Identify the active task surface from host/session artifacts or repo-documented tracking files.
   - Do not assume repo-local `.instructions/*` task files unless the repo explicitly opts into that compatibility layout.
   - If operating in the legacy compatibility layout, move completed `.instructions/tasks/` files into `.instructions/tasks.archive/`, set `status: archived`, and append a one-line recap to `.instructions/tasks.history.md`.

2. **Initialize/Validate History**:
   - Ensure the active history surface exists when the workflow requires one.
   - Keep append-only history append-only; do not rewrite it.
   - Legacy `.instructions/tasks.history.md` handling is compatibility-only when the repo explicitly opts in.

3. **Clean Raw Inbox (Optional)**:
   - Clean the active backlog or inbox surface used by the repo.
   - Remove completed or duplicated entries while preserving unresolved work.
   - Legacy `.instructions/raw.tasks.md` cleanup is compatibility-only when the repo explicitly opts in.

4. **Validation**:
   - Ensure no active (`not-started`, `in-progress`, `blocked`) tasks were accidentally archived.
   - Ensure archived or summarized items remain searchable by ID or stable label.
   - If cleaning sanctioned temp roots, avoid deleting active diagnostics or user-owned outputs.

## Output
- Updated host/session artifacts or repo-documented tracking surface.
- Optional cleanup of sanctioned `.tmp/llm-*` artifacts.
- Legacy `.instructions*` updates only in explicit compatibility mode.
- Session summary of items archived and removed.




