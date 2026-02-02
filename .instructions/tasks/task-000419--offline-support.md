---
schema: task/v1
id: task-000419
title: "Implement offline support"
type: feature
status: done
priority: medium
owner: "lolzi"
skills: ["frontend"]
depends_on: ["task-000404", "task-000405"]
next_tasks: []
created: "2026-02-01"
updated: "2026-02-02"
---

## Context

Implement offline support using local storage for drafts and ideas. Sync changes when connection is restored, with conflict resolution for edits made offline.

## Acceptance Criteria

- [x] Ideas saved to IndexedDB for offline access
- [x] Sync queue for offline changes
- [x] Conflict resolution UI for competing edits
- [x] Offline indicator in UI
- [x] Service worker for offline caching
- [x] Automatic sync on reconnect

## Plan / Approach

1. Set up IndexedDB schema for local storage
2. Implement service worker for offline caching
3. Build sync queue system
4. Create conflict detection logic
5. Design conflict resolution UI
6. Add online/offline detection
7. Implement automatic sync mechanism
8. Handle edge cases (partial syncs, network failures)

## Attempts / Log

### Attempt 1 - Success
Created complete offline sync system:
- `offlineSyncService.ts` - Full sync service with: change tracking by entity type, sync queue management, conflict detection/resolution (keep-local/keep-server/merge), automatic sync on reconnect, network status detection, retry failed items, state subscription for UI updates
- `OfflineIndicator.tsx` - Status indicator showing online/offline/syncing/conflicts states, tap for details panel with last sync time and sync button
- `OfflineIndicator.css` - Pill-shaped indicator with status colors, details overlay styling
- `ConflictResolver.tsx` - Multi-conflict navigation UI with version comparison (local vs server), resolution buttons (Keep Mine/Keep Theirs/Merge), bulk resolution for all conflicts
- `ConflictResolver.css` - Full styling for conflict resolution flow

Service worker for offline caching already provided by vite-plugin-pwa.

## Failures

None.

## Notes / Discoveries

- Used navigator.onLine with online/offline events for network detection
- Sync operations merged intelligently (create+update=create, update+delete=delete)
- Spaced repetition-style retry with retryCount tracking

## Next Steps

Continue to task-000420 (News feed - optional) or skip to Phase 6
