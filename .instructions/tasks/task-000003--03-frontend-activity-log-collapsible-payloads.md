---
schema: task/v1
id: task-000003
title: "Upgrade Activity Log: collapsible `details` payloads and readable JSON rendering"
type: feature
status: not-started
priority: medium
owner: "unassigned"
skills: ["frontend-react", "ui-ux", "typescript"]
depends_on: []
next_tasks: ["task-000004", "task-000005", "task-000006"]
created: "2026-01-13"
updated: "2026-01-13"
---

**Applies to repo root:** `c:/Users/lolzi/Documents/GitHub/quiz` 🔧

## Goal
Enhance the Activity Log so each entry can include an optional `details` payload with a per-entry expand/collapse UI. Render JSON payloads in a readable, syntax-highlighted format. Large payloads are collapsed by default.

## Acceptance Criteria ✅
- Activity Log entries support a `details` payload field.
- Each entry shows a summary line plus an expand/collapse control for `details`.
- Large payloads (configurable threshold) are collapsed by default; small payloads expand by default.
- There is a Clear action to empty the log; log length is capped (configurable) with older entries evicted.

## Context / Links
- Activity Log hook: `quiz/src/features/chat/hooks/useActivityLog.ts`
- Activity Log component: `quiz/src/features/chat/components/activityLog.tsx`

## Implementation Notes 🔧
1. Extend the activity log entry type to include optional `details: any` (kept serializable) and an optional `summary: string` for concise display.
2. Add UI in `activityLog.tsx` to show a row with summary and an expand/collapse chevron. When expanded, show formatted JSON (use a lightweight JSON pretty-printer or simple <pre> with indentation and monospaced font).
3. Make default collapsed/expanded behavior configurable (threshold e.g., 1KB or N keys), defaulting to collapsed for large payloads.
4. Respect accessibility (keyboard-expandable elements, aria attributes).
5. Add tests for rendering summary + details and for eviction behavior when cap is reached.

## Validation / How to verify ✅
- Unit/Component tests show entries with details collapsed/expanded.
- Manual: run `npm run dev`, perform dev hub events that include payloads, and verify UI shows collapsible details and Clear works.

## Notes
- Keep `details` generic and typed as `Record<string, any>` where possible.
- Consider reusing existing JSON formatting packages if already in the project (avoid adding heavy dependencies).