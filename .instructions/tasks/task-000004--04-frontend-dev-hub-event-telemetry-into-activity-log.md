---
schema: task/v1
id: task-000004
title: "Emit dev-only hub-message events into typed eventBus and show in Activity Log"
type: feature
status: not-started
priority: medium
owner: "unassigned"
skills: ["frontend-react", "event-bus", "telemetry"]
depends_on: ["task-000003"]
next_tasks: ["task-000005"]
created: "2026-01-13"
updated: "2026-01-13"
---

**Applies to repo root:** `c:/Users/lolzi/Documents/GitHub/quiz` 🔧

## Goal
Emit dev-only hub-message received events into a typed `eventBus` so the Activity Log can record them for debugging. Include the hub message name and the full payload.

## Acceptance Criteria ✅
- In development mode only, Activity Log records hub messages with name and full payload for the following messages: `OnStart`, `OnEnd`, `OnGameState`, `OnRoundState`, `OnQuestionsBatch`, `OnAnswerResult`, `OnSkipResult`.
- Event emission uses a typed event payload and goes through `quiz/src/infrastructure/events/eventBus.ts`.

## Context / Links
- Event bus: `quiz/src/infrastructure/events/eventBus.ts`
- Hub messages: `quiz/src/features/game/hubs/messages/index.ts`
- Optionally: `quiz/src/features/lobby/hubs/messages.ts`

## Implementation Notes 🔧
1. Add a dev-only wrapper in the hub connection code that publishes hub messages to `eventBus.publish({type: 'hub:message', name, payload})` when `process.env.NODE_ENV !== 'production'` or equivalent dev flag.
2. Ensure event interface types reflect the known hub messages to keep payloads typed.
3. Wire `useActivityLog` to subscribe to these dev-only events and append entries with `summary` = hub message name and `details` = payload.
4. Add tests to ensure events are emitted only in dev and that Activity Log displays them.

## Validation / How to verify ✅
- Manual: start frontend in dev, perform game play that triggers the named hub messages, and verify Activity Log shows entries with the message name and full payload.
- Unit tests: assert `eventBus.publish` is called in dev and not in production.

## Notes
- Keep this dev-only to avoid leaking payloads or cluttering production telemetry.
- Provide a feature flag or environment gating for quick toggling.