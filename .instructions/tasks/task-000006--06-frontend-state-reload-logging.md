---
schema: task/v1
id: task-000006
title: "Log all state reloads (`GetGameState`) into Activity Log with reason + payload"
type: feature
status: not-started
priority: medium
owner: "unassigned"
skills: ["frontend-react", "observability", "hooks"]
depends_on: ["task-000003"]
next_tasks: ["task-000007"]
created: "2026-01-13"
updated: "2026-01-13"
---

**Applies to repo root:** `c:/Users/lolzi/Documents/GitHub/quiz` 🔧

## Goal
Record every game state reload (`GetGameState`) into the Activity Log with a reason and the payload, covering manual reloads, reconnect reloads, and mismatch-triggered reloads.

## Acceptance Criteria ✅
- Manual reload, reconnect reload (if present), and mismatch-triggered reload produce Activity Log entries.
- Each reload entry includes: `reason` (manual/reconnect/mismatch), timestamp, and the state payload (in `details`), respecting the Activity Log payload collapse behavior.

## Context / Links
- `quiz/src/features/game/hooks/useQuizAction.ts`
- Activity Log: `quiz/src/features/chat/hooks/useActivityLog.ts`

## Implementation Notes 🔧
1. Instrument the `reload()` or the `GetGameState` wrapper to publish an Activity Log entry with `reason` and the returned payload as `details`.
2. Ensure size thresholds and collapsing rules from task `task-000003` are respected so large state payloads do not overload the UI.
3. Add unit/integration tests verifying that calling reload produces an Activity Log entry with the expected `reason` field and payload.

## Validation / How to verify ✅
- Manual: trigger manual reload and mismatch-triggered reload and verify Activity Log entries appear with reason and state payload (details collapsed if large).
- Tests: assert `eventBus` or Activity Log subscribers receive reload events with the `reason` meta field.

## Notes
- Be careful not to leak sensitive information when logging full state payloads; prefer redacting PII if present.