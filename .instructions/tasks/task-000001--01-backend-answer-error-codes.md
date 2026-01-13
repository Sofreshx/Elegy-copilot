---
schema: task/v1
id: task-000001
title: "Introduce stable answer error codes and propagate via GrainResult -> UserActionResult"
type: feature
status: not-started
priority: high
owner: "unassigned"
skills: ["dotnet-core", "backend-domain", "errors-logging"]
depends_on: []
next_tasks: ["task-000002"]
created: "2026-01-13"
updated: "2026-01-13"
---

**Applies to repo root:** `c:/Users/lolzi/source/repos/Sofreshx/Quizu` 🔧

## Goal
Introduce stable answer rejection error codes and ensure they are set and propagated from domain grains (`PlayerGrain` / `Player`) through `GrainResult` into the `UserActionResult` DTO returned via the hub.

Use these exact error code strings where appropriate:
- `G.Answer.QMismatch`
- `G.Answer.QNotFound`
- `G.Answer.QNotAnswerable`
- `G.Answer.AlreadyAnswered` (only if backend can reliably distinguish; otherwise map to `G.Answer.QNotAnswerable` and document mapping)

## Acceptance Criteria ✅
- Non-Rush mismatch returns `G.Answer.QMismatch` in `UserActionResult`.
- Rush with unknown questionId returns `G.Answer.QNotFound`.
- Closed or otherwise not answerable responses return `G.Answer.QNotAnswerable` (or `G.Answer.AlreadyAnswered` if distinguishable); document mapping choice.
- The codes are used as stable strings in code (not free-form messages) so frontends can act on them.

## Context / Links
- Domain: `Quizu/src/Quiz/Quizu.Quiz/Players/Player.cs`
- Grain: `Quizu/src/Game/QuizGameApi/Features/Games/Grains/PlayerGrain.cs`
- Hubs: `Quizu/src/Game/QuizGameApi/Features/Hubs/Hub.cs`
- DTO (read-only reference): `Quizu/src/Game/QuizGameApi/Features/Hubs/DTO/UserActionResult.cs`
- Search for `HubErrors` / game error constants to align naming and location

> Note: If the `GrainResult` type does not yet support a stable `errorCode` payload field, add one in a backward-compatible way (e.g., optional string property `ErrorCode`).

## Implementation Notes 🔧
1. Inspect `Player.cs` to determine where mismatch/not-found/not-answerable decisions happen. Prefer emitting an internal domain enum/typed error and map to the stable string codes near the grain/hub boundary.
2. Add an optional `ErrorCode` property to `GrainResult` (or equivalent result type) if absent; ensure serialization path (DTO) maps it to `UserActionResult.ErrorCode` or similar.
3. Ensure `Hub` maps domain results to `UserActionResult` preserving `ErrorCode` and `ErrorMessage` for diagnostics.
4. If backend can detect 'already answered' distinct from 'not answerable', use `G.Answer.AlreadyAnswered` and document where distinction occurs; otherwise map both to `G.Answer.QNotAnswerable` and record rationale.
5. Add unit tests for mapping and an integration test exercising typical answer flows (Rush vs non-Rush, closed question, already answered).

## Validation / How to verify ✅
- Manual: Use a test client to invoke answer flows and inspect returned `UserActionResult.ErrorCode` for the above cases.
- Automated: Add unit tests asserting `GrainResult.ErrorCode` is set correctly and hub returns `UserActionResult.ErrorCode` consistently.
- Files to check after implementation: `Player.cs`, `PlayerGrain.cs`, `Hub.cs`, DTO file for `UserActionResult` to ensure property present and documented.

## Notes
- Keep error strings stable and documented in a single constants file or enum-to-string mapper to avoid duplication.
- Coordinate with frontend tasks so they can reliably detect `G.Answer.QMismatch` and trigger a UI reload when needed.