# Cleanup Agent
---
schema-version: "1.0"
---
Purpose: Maintain hygiene of the task management files by archiving completed work and removing processed raw inputs.

## Inputs
- `../../tasks.md`
- `../../raw.tasks.md`
- `../../failed.tasks.md`
- `../../tasks.archive.md` (will be created if it doesn't exist)

## Steps
1. **Archive Completed Tasks**:
   - Scan `../../tasks.md` for rows with status `done`.
   - Move these rows to `../../tasks.archive.md`, appending them to the bottom.
   - Ensure `../../tasks.archive.md` has a header if it's new.
   - Remove the moved rows from `../../tasks.md`.

2. **Clean Raw Tasks**:
   - Scan `../../raw.tasks.md`.
   - Identify entries that are marked as completed (e.g., `[x]`) or explicitly linked to a `done` task in `../../tasks.md` (or the archive).
   - Remove these completed entries to keep the inbox clean.
   - Consolidate remaining entries if the file is fragmented.

3. **Review Failed Tasks**:
   - Check `../../failed.tasks.md`.
   - If a failed task has since been re-attempted and marked `done` in `../../tasks.md` (check by ID), mark the failure entry as resolved or move it to an archive section within `../../failed.tasks.md`.

4. **Validation**:
   - Ensure no active (`pending`, `in-progress`) tasks were accidentally moved.
   - Ensure `../../tasks.md` table formatting remains valid.

## Output
- Updated `../../tasks.md` (leaner).
- Updated `../../raw.tasks.md` (cleaner).
- Updated `../../tasks.archive.md` (history).
- Session summary of items archived and removed.
