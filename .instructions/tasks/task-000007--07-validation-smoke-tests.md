---
schema: task/v1
id: task-000007
title: "Validation smoke tests for answer error codes, activity log, and reload flows"
type: chore
status: not-started
priority: medium
owner: "unassigned"
skills: ["qa", "testing", "integration"]
depends_on: ["task-000001","task-000002","task-000003","task-000004","task-000005","task-000006"]
next_tasks: []
created: "2026-01-13"
updated: "2026-01-13"
---

**Applies to repo roots:**
- Backend: `c:/Users/lolzi/source/repos/Sofreshx/Quizu` 🔧
- Frontend: `c:/Users/lolzi/Documents/GitHub/quiz` 🔧

## Goal
Define and run validation steps that exercise the end-to-end behavior across backend and frontend changes introduced by the previous tasks: stable answer error codes, structured server logs, Activity Log UI and payload collapsing, dev hub events, rejection surfacing, and reload logging.

## Acceptance Criteria ✅
- A checklist of runnable steps exists covering both repositories.
- Frontend: `npm test` (or closest test script) runs and relevant component/unit tests pass; `npm run dev` manual steps are documented for manual verification.
- Backend: `dotnet test` targeted projects run where available; otherwise `dotnet build` + manual reproduction steps are documented.
- Manual test script verifies: Activity Log UI shows collapsible payloads, dev hub events appear in Activity Log (dev mode), an answer rejection with `G.Answer.QMismatch` leads to Activity Log entry and triggers reload, and Rush closed question / unknown questionId returns `G.Answer.QNotFound` or `G.Answer.QNotAnswerable` as specified.

## Context / Links
- Frontend tests & run scripts: `quiz/package.json` (scripts), `quiz/src/features/chat/*`, `quiz/src/features/game/hooks/useQuizAction.ts`
- Backend tests & build: `Quizu.sln`, relevant projects under `Quizu/src/*`

## Implementation Notes 🔧
1. Write a short manual test plan documenting commands and steps to reproduce each acceptance criterion.
2. Add unit/integration tests where feasible in each repo to validate behavior (frontend component tests for Activity Log, backend unit tests for error code mapping and logger calls).
3. Include sample test cases for:
   - Mismatch path: server returns `G.Answer.QMismatch` → frontend logs and reloads.
   - Rush missing questionId: server returns `G.Answer.QNotFound`.
   - Closed/already answered: server returns `G.Answer.QNotAnswerable` or `G.Answer.AlreadyAnswered` per mapping.
4. If full automated e2e is heavy, include a concise manual test script so reviewers can validate quickly.

## Validation / How to verify ✅
- Run frontend tests: `cd c:/Users/lolzi/Documents/GitHub/quiz && npm test` (or run the closest test suite); ensure tests for Activity Log UI pass.
- Run backend tests: `cd c:/Users/lolzi/source/repos/Sofreshx/Quizu && dotnet test` (or `dotnet build` + specific unit tests).
- Manual verification steps (documented in this file):
  1. Start backend (local dev) and frontend dev server.
  2. In dev mode, reproduce hub messages to confirm dev hub event entries appear in Activity Log.
  3. Simulate answer mismatch and observe Activity Log entry + reload.
  4. Simulate Rush answer with unknown questionId and observe `G.Answer.QNotFound` in `UserActionResult` and Activity Log.

## Notes
- Keep the manual script minimal and copy-paste friendly. Include command lines and expected key assertions.
- If the backend cannot run certain unit tests in CI locally, note which projects to run and any preconditions.