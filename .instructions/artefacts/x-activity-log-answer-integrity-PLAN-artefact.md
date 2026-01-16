# x-activity-log-answer-integrity — Plan Artefact

## Goal summary ✅
- **Upgrade Activity Log (dev-focused):** Enhance the in-game Activity Log on `/lobby` and `/game` to surface rich runtime and debug telemetry, including collapsible `details` payloads for hub messages and client-side action failures.
- **Enforce answer integrity:** Server must reject stale or wrong answers in Standard/2v2 modes with **stable error codes** and structured server logging. Rush mode should continue to accept answers for any currently open question but must reject closed/non-answerable questions with stable codes.
- **Client behavior:** Surface all relevant errors/events in the Activity Log and *optionally* trigger `GetGameState` reload when an answer mismatch or integrity error is detected.

> Target audience: `executive2` agent / engineering team. This is a durable handoff for a cross-repo implementation touching `quiz` (frontend) and `Quizu` (backend).

---

## Context loaded (files & roots) 🔍
- Frontend repo root: `c:/Users/lolzi/Documents/GitHub/quiz`
  - `src/features/chat/hooks/useActivityLog.ts`
  - `src/features/chat/components/activityLog.tsx`
  - `src/infrastructure/events/eventBus.ts`
  - `src/features/game/hubs/messages/index.ts`
  - `src/features/game/hooks/useQuizAction.ts`
  - `src/common/utils/devLog.ts` *(optional)*

- Backend repo root: `c:/Users/lolzi/source/repos/Sofreshx/Quizu`
  - `src/Quiz/Quizu.Quiz/Players/Player.cs`
  - `src/Game/QuizGameApi/Features/Games/Grains/PlayerGrain.cs`
  - `src/Game/QuizGameApi/Features/Hubs/Hub.cs` *(QuizHub)*
  - `src/Game/QuizGameApi/Common/GrainResult.cs` *(only if needed)*
  - `HubErrors` / introduce `GameErrors` constants in Game API layer

---

## Key design decisions & rationale 🔧
1. **Structured Activity Log entries** — convert entries to a typed shape: `{time, source, level, summary, details?}` where `details` is optional JSON rendered in a collapsible UI. Rationale: makes logs machine- and human-friendly while minimizing noise.
2. **EventBus telemetry** — add typed events on the frontend (`HubMessageReceived`, `ActionInvokeFailed`, `ActionInvokeSuccess`, `GameStateMismatch`) to pipe raw payloads and failures into the Activity Log. Rationale: single source-of-truth for debug/event plumbing with minimal coupling.
3. **Stable server error codes** — introduce a small, explicit set of error codes (see table below) that the server returns in `UserActionResult` payloads when answers are rejected. Rationale: avoids brittle string matching and enables consistent client behavior including auto-reload decisions.
4. **Non-breaking change** — do not alter existing SignalR contract shapes unless absolutely necessary. If the hub message lacks error reason, log full DTO for debugging.

---

## Proposed error code table (use EXACT strings) ⚠️
- `G.Answer.QMismatch` — Non-Rush mode: provided `questionId` does not match the server's current questionId (stale/wrong UI). Client should log and optionally trigger a `GetGameState` refresh.
- `G.Answer.QNotFound` — Rush mode: provided `questionId` not found (invalid id). Server rejects; client shows as error in Activity Log.
- `G.Answer.QNotAnswerable` — Rush or other modes: question exists but *cannot* be answered (closed, already completed, or otherwise non-answerable).
- `G.Answer.AlreadyAnswered` — Optional: if backend can distinguish repeat answers vs generic not-answerable. If not, it may be mapped to `G.Answer.QNotAnswerable`.

> **Keep existing codes untouched**. Map any pre-existing behavior to these codes where appropriate.

---

## Implementation map (by repo) 🗺️

Frontend (`quiz`):
- `src/features/chat/hooks/useActivityLog.ts` — add structured entry type, rendering metadata, and `appendLog(entry)` API.
- `src/features/chat/components/activityLog.tsx` — implement collapsible `details` dump (JSON viewer), filtering, and timestamps.
- `src/infrastructure/events/eventBus.ts` — add typed events: `HubMessageReceived`, `ActionInvokeFailed`, `ActionInvokeSuccess`, `GameStateMismatch`.
- `src/features/game/hubs/messages/index.ts` — ensure hub message types are exported and passed through the event bus.
- `src/features/game/hooks/useQuizAction.ts` — capture invoke results; on failure, publish `ActionInvokeFailed` with server error code & details and append an Activity Log entry. Optionally trigger `GetGameState()` on `G.Answer.QMismatch`.
- `src/common/utils/devLog.ts` *(if needed)* — small helper to standardize dev-only console + Activity Log writes.

Backend (`Quizu`):
- `src/Quiz/Quizu.Quiz/Players/Player.cs` — ensure player answer flow surfaces full question context for logging.
- `src/Game/QuizGameApi/Features/Games/Grains/PlayerGrain.cs` — enforce Rush vs non-Rush semantics, produce `UserActionResult` with stable error code strings above.
- `src/Game/QuizGameApi/Features/Hubs/Hub.cs` (QuizHub) — map domain/validation failures to the stable error codes and include structured details in hub responses.
- `src/Game/QuizGameApi/Common/GrainResult.cs` — add fields to carry error code + structured metadata if necessary.
- Add/extend `HubErrors` or introduce `GameErrors` constants file to centralize the `G.*` strings.

---

## Step-by-step execution outline (high-level) ➜
1. **Backend: define error constants** and tests to validate mapping (unit tests on validator methods).
2. **Backend: implement semantics** in `PlayerGrain.cs` — return precise `UserActionResult` codes for each rejection case and log structured details including `playerId`, `questionId`, `gameId`, mode (Rush/Standard).
3. **Frontend: event plumbing** — add event bus types and emit hub messages / invoke failures to the bus.
4. **Frontend: Activity Log UI** — support structured entries and collapsible `details`; add visual cues for error severity.
5. **Frontend: integrate** — on `ActionInvokeFailed` append proper log entry and if `G.Answer.QMismatch` optionally call `GetGameState` and log the reload event.
6. **Validation & tests** — add unit/integration tests where feasible and manual test flows (see checklist below).
7. **Rollout** — feature-flag or dev-only toggle for Activity Log verbosity if desired; monitor server logs and client telemetry.

---

## Validation checklist ✅

Frontend (manual + automated where possible):
- [ ] Manual: open `/lobby` and `/game`, verify Activity Log shows incoming hub events (e.g., question created, answers accepted) and payloads are expandable/collapsible.
- [ ] Manual: simulate an answer mismatch (stale UI questionId) and confirm Activity Log records `G.Answer.QMismatch` with details and that an optional `GetGameState` reload is triggered.
- [ ] Manual: simulate Rush invalid id and closed questions to confirm `G.Answer.QNotFound` and `G.Answer.QNotAnswerable` log entries.
- [ ] Automated: unit tests for `useActivityLog` entry creation and eventBus subscriptions.

Backend (manual + automated where possible):
- [ ] Unit tests mapping validation failure paths to explicit error codes.
- [ ] Integration or contract tests verifying hub responses contain error code and structured details.
- [ ] Manual: run server, attempt stale/wrong answers, confirm server responds with the expected `G.*` code and emits a structured log entry (include `gameId`, `playerId`, `questionId`).

Observability:
- [ ] Logs: server logs include well-structured context for each rejection; ensure privacy/PII rules are respected.

---

## Task graph (IDs + dependencies) 🧭
- T1: Backend — Define `GameErrors` & add unit tests
- T2: Backend — Enforce semantics in `PlayerGrain` and hub mapping (depends on T1)
- T3: Frontend — Add EventBus types + emitters (independent)
- T4: Frontend — Activity Log structured entries & UI (depends on T3)
- T5: Integration/Validation — E2E/manual tests (depends on T2, T4)

---

## Risks / Rollback ⚠️
- Risk: Unintended SignalR contract change breaking older clients. Mitigation: Keep hub payloads backward compatible and only add optional fields.
- Risk: Too-verbose payload dumps exposing sensitive data. Mitigation: dev-only toggle; scrub PII in log details.
- Rollback: Revert to prior commit and disable dev verbosity flag if there are functional regressions.

---

## Execution notes for `executive2` / engineers 📌
- Prefer small, verifiable PRs scoped to one repo (backend or frontend) when possible and include tests.
- Add a small feature/dev flag to gate verbose Activity Log payload dumping.
- If any ambiguity surfaces on Rush vs Standard edge-cases, ask one targeted question: "Should Rush accept an answer for a question that became closed between the client's last poll and the answer invoke?"

---

## Acceptance criteria (short) 🎯
- Server returns and logs one of the stable `G.*` error codes for rejected answers and includes structured details.
- Client Activity Log records hub messages and invoke failures with collapsible details and shows the expected error codes.
- Optional: `GetGameState` is triggered on `G.Answer.QMismatch` and its activity is logged.

---

*Created for*: `executive2` — use this as the top-level artefact for planning, task creation, and handoff. Keep this file updated if design decisions or file locations change.
