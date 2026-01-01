---
name: system-cleanup
description: "Task file maintenance. Archives completed tasks and cleans up raw inputs. Use this for internal system maintenance only."
---

# System Cleanup Skill

## Inputs
- `.instructions/tasks.md`
- `.instructions/tasks.review.md` (recently completed, awaiting review)
- `.instructions/raw.tasks.md`
- `.instructions/failed.tasks.md`
- `.instructions/tasks.archive.md` (will be created if it doesn't exist)

## Steps
1. **Sweep Active Tasks**:
   - Verify `.instructions/tasks.md` has no `done` rows. If any slipped through, move them to `.instructions/tasks.review.md` (create with matching header if absent) and remove from the active file.

2. **Move Reviewed Items to Archive**:
   - Scan `.instructions/tasks.review.md` for rows marked `done` or otherwise completed/reviewed.
   - Move these rows to `.instructions/tasks.archive.md`, appending them to the bottom.
   - Ensure `.instructions/tasks.archive.md` has a header if it's new.
   - Remove the moved rows from `.instructions/tasks.review.md`.

3. **Clean Raw Tasks**:
   - Scan `.instructions/raw.tasks.md`.
   - Identify entries that are marked as completed (e.g., `[x]`) or explicitly linked to a `done` task in `.instructions/tasks.md` (or the archive).
   - Remove these completed entries to keep the inbox clean.
   - Consolidate remaining entries if the file is fragmented.

4. **Review Failed Tasks**:
   - Check `.instructions/failed.tasks.md`.
   - If a failed task has since been re-attempted and marked `done` in `.instructions/tasks.md` (check by ID), mark the failure entry as resolved or move it to an archive section within `.instructions/failed.tasks.md`.

5. **Validation**:
   - Ensure no active (`pending`, `in-progress`) tasks were accidentally moved.
   - Ensure `.instructions/tasks.md` and `.instructions/tasks.review.md` table formatting remains valid.

## Output
- Updated `.instructions/tasks.md` (leaner).
- Updated `.instructions/raw.tasks.md` (cleaner).
- Updated `.instructions/tasks.archive.md` (history).
- Session summary of items archived and removed.


