---
schema: task/v1
id: task-000443
title: "Consolidate mobile IndexedDB to single versioned database"
type: bugfix
status: done
priority: high
owner: ""
skills: ["frontend"]
group_id: "group-04-quality"
group_title: "Group 4: Code Quality"
group_order: 1
depends_on: []
next_tasks: []
plan: x-PLAN-artefact.md
created: "2026-02-08"
updated: "2026-02-08"
---

## Context
Three files open the same IndexedDB database (`mobile-companion`) at different versions, causing version conflict errors. A fourth service uses a different DB name entirely.

- Read `mobile-companion/src/services/ideasDb.ts` (opens `mobile-companion` at version 1)
- Read `mobile-companion/src/services/settingsDb.ts` (opens at version 2)
- Read `mobile-companion/src/services/chatDb.ts` (opens at version 3)
- Read `mobile-companion/src/services/offlineSyncService.ts` (uses different DB name `mobile-companion-db`)

## Acceptance Criteria
- [x] Single `db.ts` with `getDb()` singleton
- [x] All stores created in one `onupgradeneeded` handler
- [x] `ideasDb.ts`, `settingsDb.ts`, `chatDb.ts` use shared `getDb()`
- [x] No version conflict errors
- [x] No TypeScript errors

## Plan / Approach

### 1. Create `mobile-companion/src/services/db.ts`
- Single `openDb()` function that opens `mobile-companion` at the latest version
- Single `onupgradeneeded` handler that creates ALL stores (`ideas`, `tags`, `settings`, `conversations`, `messages`)
- Export `getDb(): Promise<IDBDatabase>` singleton (lazy init, shared across services)
- Handle version upgrades cleanly (create missing stores without destroying existing data)

### 2. Update consumers
- Update `ideasDb.ts`, `settingsDb.ts`, `chatDb.ts` to import `getDb()` instead of each opening their own copy

## Attempts / Log

### Attempt 1 (2026-02-08) — Success
1. Created `mobile-companion/src/services/db.ts` — single `getDb()` singleton at DB_VERSION=4
   - `onupgradeneeded` creates all 3 stores (`ideas`, `settings`, `conversations`) using `contains()` guards
   - Promise-based singleton with error-retry (resets `dbPromise` on failure)
2. Updated `ideasDb.ts` — removed `DB_NAME`, `DB_VERSION`, `dbInstance`, `openDb()`. Imported `getDb` from `./db`. All 6 CRUD methods now use `getDb()`.
3. Updated `settingsDb.ts` — same pattern. Removed full `openDb()` + store-creation logic. `get()` and `set()` use `getDb()`.
4. Updated `chatDb.ts` — same pattern. All 6 methods use `getDb()`.
5. Verified: `npx tsc --noEmit` — zero errors. All consumer imports unchanged.

### Discovery: No separate messages store
The exploration context mentioned creating a `messages` store, but in reality `chatDb.ts` embeds messages inside `Conversation` objects. No separate store needed.

## Failures

## Notes / Discoveries
- Messages are embedded in `Conversation` objects (no separate `messages` store)
- No `tags` index exists in any version — tags are computed by iterating all ideas in `getAllTags()`
- `offlineSyncService.ts` uses a completely different DB name (`mobile-companion-db`) — left untouched per plan (will be deleted in task-000444)

## Next Steps
