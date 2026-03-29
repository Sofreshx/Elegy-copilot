---
created: 2026-03-21
updated: 2026-03-21
category: research
status: draft
doc_kind: node
id: runtime-modernization-progress
summary: Tracks implementation progress for runtime navigation stability, startup managed-asset reconciliation, execution redesign, sandbox integration, and planned stats observability.
tags: [copilot-ui, runtime, execution, sandbox, stats]
related: [copilot-ui-guide, skill-discovery-telemetry, skill-invocation-observability-contract]
---

# Runtime Modernization Progress

## Scope

This workstream covers five linked runtime improvements:

1. Stabilize the Home / Runtime sub-navigation so section switches do not shift the tab row.
2. Make managed asset sync automatic on application startup so deleted skills, agents, and prompts do not linger under user Copilot folders.
3. Redesign Execution around live session watching and streamed runtime activity instead of polling-heavy job management alone.
4. Fold sandboxing into runtime execution as a safe execution context instead of a standalone primary destination.
5. Add a dedicated Stats surface for skill, agent, search, invocation, and runtime usage observability.

## Confirmed Decisions

- Rollout is phased.
- Sandboxing should become an execution mode/context, not a permanent standalone runtime tab.
- Stats should be a top-level UI surface.
- Startup sync should use deterministic manifest plus install-state reconciliation instead of a continuous file watcher.
- Existing session and catalog telemetry remain the seed data model for the Stats tab.

## Implemented In This Pass

### Runtime tab stability

- Added stable scrollbar reservation in `copilot-ui/ui/src/styles/global.css`.
- Added a non-wrapping stable runtime workspace-nav variant in `copilot-ui/ui/src/app.css`.
- Opted the Home / Runtime primary and diagnostics sub-nav rows into that stable variant in `copilot-ui/ui/src/tabs/HomeRuntime/HomeRuntimeView.tsx`.
- Added a smoke assertion covering the new layout contract in `copilot-ui/tests/ui-react-smoke.test.js`.

### Startup managed-asset reconciliation

- Extended `copilot-ui/lib/assets.js` with managed install-state read/write and prune logic for:
  - stale skills under `skills/`
  - stale skill vault entries under `skills-vault/`
  - stale managed agents under `agents/`
  - stale managed prompts under `prompts/`
- Updated `syncAll()` to reconcile stale managed assets instead of only installing current manifest entries.
- Added `syncManagedInstall()` so server startup can reuse the same deterministic reconciliation path.
- Wired best-effort startup reconciliation into `copilot-ui/server.js` for unique `copilotHome` and `vscodeHome` roots.
- Added regression coverage in `copilot-ui/tests/assets-sync-missing-source.test.js` to prove stale managed assets are pruned and the install state is rewritten.

### Execution external-session observation

- Extended `copilot-ui/ui/src/tabs/Executor/executorStore.ts` to load merged session inventory via `/api/sessions?source=all&dedupe=on` alongside executor health, jobs, and runs.
- Kept external-session observation best-effort so executor core state still loads even if merged session inventory is temporarily unavailable.
- Added a read-only `Observed External Sessions` surface in `copilot-ui/ui/src/tabs/Executor/ExecutorView.tsx` showing recent CLI and VS Code sessions discovered outside executor-managed runs.
- Added smoke coverage in `copilot-ui/tests/ui-react-smoke.test.js` to anchor the new merged-session observation contract.

### Runtime overlay Sessions/Executor handoff

- Added a lightweight `Overlay Sessions` workspace to `Home / Runtime -> Sessions` using the existing `uiRuntimeOverlayStore` and overlay route family.
- Kept `Home / Runtime -> Executor` as the full overlay CRUD and queue surface instead of duplicating creation or mutation forms in Sessions.
- Added a `Resume overlay workflow` quick action to `Home / Runtime -> Overview` that reuses the selected/latest overlay session state and routes directly into `Executor` when possible.
- Added narrow source and component coverage for the new Sessions overlay workspace and Executor handoff path.

### Sandbox navigation consolidation

- Removed the standalone `Sandboxes` runtime section from the active Home / Runtime navigation.
- Routed sandbox quick actions through `Executor`, where sandbox lifecycle now appears as an embedded execution mode instead of a separate destination.
- Stabilized the Sessions mode toolbar so local/SDK toggles no longer reflow on section changes.

### Top-level Stats surface

- Added a top-level `Stats` tab to the application shell.
- Added `copilot-ui/ui/src/tabs/Stats/statsStore.ts` to aggregate existing runtime health, executor health, SDK health, catalog audit analytics, and merged session inventory from current APIs.
- Added `copilot-ui/ui/src/tabs/Stats/StatsView.tsx` as a read-only observability dashboard for runtime health, merged session coverage, catalog telemetry, top assets, and recent sampled agent/skill usage.
- Kept recent agent and skill rollups bounded by sampling only the most recent merged sessions rather than implying exhaustive historical usage.
- Updated source-level UI coverage and canonical docs so the new top-level Stats destination is part of the frozen shell contract.

## Remaining Slices

### Execution redesign

- Unify runtime session inspection so merged CLI and VS Code sessions can be opened from a consistent workflow, not just observed.
- Add authoritative executor/run streaming endpoints.
- Reuse the SDK EventSource client pattern for live execution watching.
- Shift the Execution UI from job-form-first to session/watch-first.

### Sandbox integration

- Move tracker token guidance into execution/runtime flows.
- Replace the standalone sandbox mental model with execution context selection and inline lifecycle affordances.

### Stats follow-through

- Evaluate whether authoritative token/request counters are available from bridge/runtime seams before surfacing them.
- Decide whether the recent sampled rollups should stay bounded to the newest sessions or grow into a broader historical aggregate once backend cost and authority are clear.

## Validation Notes

- Narrow validation for this pass should cover runtime UI smoke plus managed asset sync reconciliation.
- Broader runtime execution and stats validation is deferred until the corresponding slices land.