---
schema: task/v1
id: task-000005
title: "Surface answer rejection errors in Activity Log and auto-reload on `G.Answer.QMismatch`"
type: feature
status: not-started
priority: high
owner: "unassigned"
skills: ["frontend-react", "hooks", "integration-testing"]
depends_on: ["task-000001","task-000003","task-000004"]
next_tasks: ["task-000006","task-000007"]
created: "2026-01-13"
updated: "2026-01-13"
---

**Applies to repo root:** `c:/Users/lolzi/Documents/GitHub/quiz` 🔧

## Goal
When an answer invoke fails due to server rejection, surface the server `errorCode` / `errorMessage` in the Activity Log with context (local active questionId, selectedQuestionId, mode). When the `errorCode` is `G.Answer.QMismatch`, trigger a `reload()` of the game state and record the reload in the Activity Log.

## Acceptance Criteria ✅
- Rejected answer invokes create Activity Log entry containing `errorCode`, `errorMessage`, `localActiveQuestionId`, `selectedQuestionId`, and `mode`.
- On `G.Answer.QMismatch`, `reload()` is called and a corresponding Activity Log entry is created indicating the reload reason.
- If `G.Answer.QNotFound` or `G.Answer.QNotAnswerable` occurs, entries appear in the Activity Log with diagnostic info but do not trigger reload (unless otherwise agreed).

## Context / Links
- Action hooks: `quiz/src/features/game/hooks/useQuizAction.ts`
- Activity Log: `quiz/src/features/chat/hooks/useActivityLog.ts` and `quiz/src/features/chat/components/activityLog.tsx`

## Implementation Notes 🔧
1. Ensure `useQuizAction` (or wrappers around hub invocations) inspects `UserActionResult.ErrorCode` (or equivalent) and publishes a dev Activity Log entry with the server error code/message and local context.
2. Implement reload behavior: when `ErrorCode === 'G.Answer.QMismatch'`, call the existing `reload()` function in `useQuizAction` and also publish an Activity Log entry for the reload reason.
3. Make sure Activity Log entry `details` include `localActiveQuestionId` and `selectedQuestionId` so developers can correlate.
4. Avoid triggering reload on `G.Answer.QNotFound` in Rush scenario unless product decides otherwise—document behavior.

## Validation / How to verify ✅
- Manual: simulate mismatch (server returns `G.Answer.QMismatch`) and verify Activity Log shows rejection with context and that reload is called and logged.
- Tests: add an integration test or e2e test that mocks hub responses and asserts reload called on mismatch.

## Notes
- Use exact error code strings (`G.Answer.QMismatch`, `G.Answer.QNotFound`, `G.Answer.QNotAnswerable`) so UI logic is stable.
- Keep Activity Log entries brief but include `details` for diagnostics.