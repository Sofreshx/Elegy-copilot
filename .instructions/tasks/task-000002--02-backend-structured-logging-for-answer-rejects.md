---
schema: task/v1
id: task-000002
title: "Add structured server logs for answer rejection (mismatch / not answerable)"
type: feature
status: not-started
priority: medium
owner: "unassigned"
skills: ["dotnet-core", "logging", "observability"]
depends_on: ["task-000001"]
next_tasks: ["task-000007"]
created: "2026-01-13"
updated: "2026-01-13"
---

**Applies to repo root:** `c:/Users/lolzi/source/repos/Sofreshx/Quizu` 🔧

## Goal
Add structured logs at the server-side when answers are rejected due to mismatch or not answerable, so operators can diagnose discrepancies and correlate them with lobby and user context.

## Acceptance Criteria ✅
- When an answer is rejected due to mismatch (`G.Answer.QMismatch`) or not answerable (`G.Answer.QNotAnswerable` / `G.Answer.AlreadyAnswered`), a structured log record is emitted.
- Logs include: `lobbyCode`, `userId`, provided `questionId`, and—when accessible—expected/current `questionId` and `mode`.
- Logs are machine-parseable (structured JSON) and contain the stable error code string.

## Context / Links
- `Quizu/src/Quiz/Quizu.Quiz/Players/Player.cs` (domain where expected/current questionId may be known)
- `Quizu/src/Game/QuizGameApi/Features/Games/Grains/PlayerGrain.cs` (grain boundary where we can emit logs)
- Hub layer: `Quizu/src/Game/QuizGameApi/Features/Hubs/Hub.cs`
- Look for existing `HubErrors`/error constants to align how logs are categorized

## Implementation Notes 🔧
1. Add a structured logging call at the point the rejection is decided (prefer near the grain/hub boundary so it has access to user/lobby context).
2. If expected/current `questionId` is only available inside `Player.cs`, avoid leaking domain internals into DTOs; instead:
   - Option A: include a `diagnosticInfo` string in the log payload containing expected/current values, **only** for logs (not for DTO messages sent to clients).
   - Option B: add a small, internal-only diagnostic hook (e.g., `IDomainDiagnostics.LogAnswerMismatch(...)`) that can be invoked from `Player.cs`.
3. Ensure logs include the error code (e.g., `G.Answer.QMismatch`) and a clear `reason` field.
4. Add tests or log assertions where feasible (unit tests that assert logger is called with expected structured properties; integration test that produces logs).

## Validation / How to verify ✅
- Unit tests verifying structured logger is invoked with fields `lobbyCode`, `userId`, `providedQuestionId`, `errorCode`.
- Manual test: trigger mismatch and inspect server logs for a JSON entry with the enumerated fields and error code.

## Notes
- Avoid adding sensitive information to logs. Keep payloads small and focused for observability.
- Coordinate naming of log fields with any existing log schema used in the project (e.g., `lobbyCode` vs `lobby_id`).