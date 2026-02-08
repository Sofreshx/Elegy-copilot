---
schema: task/v1
id: task-000444
title: "Remove dead code from mobile companion"
type: chore
status: done
priority: medium
owner: ""
skills: ["frontend", "tech-debt"]
group_id: "group-04-quality"
group_title: "Group 4: Code Quality"
group_order: 2
depends_on: []
next_tasks: []
plan: x-PLAN-artefact.md
created: "2026-02-08"
updated: "2026-02-08"
---

## Context
~40% of the mobile companion's services and components are implemented but never mounted in the UI. These orphaned files add maintenance burden and confusion.

- Read `mobile-companion/src/App.tsx` for mounted routes
- Search for imports of each file below to confirm they're unused

## Acceptance Criteria
- [ ] Dead services deleted
- [ ] Dead components deleted
- [ ] No dangling imports
- [ ] App still builds and runs
- [ ] No TypeScript errors

## Plan / Approach

Remove the following files (verify no imports first):
- **Services**: `learningService.ts`, `remindersService.ts`, `queueService.ts`, `offlineSyncService.ts`, `workflowDispatch.ts`, `artifactSync.ts`, `codespacesService.ts`
- **Components**: `LearningPanel`, `QueueManager`, `ReminderSettings`, `ConflictResolver`, `OfflineIndicator`, `NotificationToast`
- ~~**Related IndexedDB stores** (learning, reminders, queue, offline-sync) from the consolidated `db.ts`~~ (N/A — offline-sync was in a separate DB deleted with offlineSyncService.ts; other stores not present in db.ts)
- Remove `FALLBACK_CLIENT_ID` from `authService.ts`
- Remove `DEFAULT_RELAY_HTTP_URL = 'https://relay.example.com'` placeholder (make env var required)

## Acceptance Criteria
- [x] Dead services deleted
- [x] Dead components deleted
- [x] No dangling imports
- [x] App still builds and runs
- [x] No TypeScript errors

## Attempts / Log

### 2026-02-08 — Attempt 1 (success)
1. Grepped pages/, hooks/, context/ for imports of all dead files — zero matches in live code. All imports are only from other dead files.
2. Deleted 8 dead service files: learningService.ts, remindersService.ts, queueService.ts, offlineSyncService.ts, workflowDispatch.ts, artifactSync.ts, codespacesService.ts, workflowWebhook.ts
3. Deleted 5 dead component directories: learning/, queue/, reminders/, offline/, notifications/
4. Cleaned authService.ts:
   - Removed `FALLBACK_CLIENT_ID` and `DEFAULT_RELAY_HTTP_URL` constants
   - `resolveClientId()` now throws if `VITE_GITHUB_CLIENT_ID` is not set
   - `resolveRelayHttpUrl()` now throws if no relay URL env var is set
   - `getAuthConfigError()` now validates both client ID and relay URL presence (no fallback)
5. Updated authService.test.ts to match new behavior (no more hardcoded fallback test case)
6. Checked `__tests__/` — only `authService.test.ts` exists, no tests for dead services
7. `npx tsc --noEmit` — zero errors

## Failures

## Notes / Discoveries

## Next Steps
