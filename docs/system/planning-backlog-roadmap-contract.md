---
created: 2026-03-14
updated: 2026-05-18
category: system
status: current
doc_kind: node
id: planning-backlog-roadmap-contract
summary: Canonical planning authority contract after the live cutover to `elegy-planning`, including entity semantics, route-selection fields, and retired repo-file boundaries.
tags: [planning, authority, roadmap, contracts]
related: [copilot-ui-guide, session-state-artifacts, workflow-planning-contract, orchestration-and-agents, goal-contract-governance, direct-sqlite-repair-for-planning-tags-adr]
---

# Planning Authority Contract

## Purpose

This file keeps the historical `planning-backlog-roadmap-contract.md` path for backlink stability.
The live contract no longer makes repo-file backlog or roadmap docs the primary planning authority.

Define the live planning authority, semantic rules, and compatibility boundaries for planning in
`elegy-copilot` / `elegy-copilot`.

## Live Posture

- `elegy-planning` is the mandatory durable planning authority for the live `copilot-ui` path.
- Repo-file planning bullets, backlog docs, and roadmap docs are retired from the live path.
- `elegy-memory` is additive recall only and must not replace planning durability.
- `plan.md` remains the session execution artifact.
- `~/.copilot/repo-state/<repoId>/tasks/` remains the durable task-board store.
- Projections, mirrors, and UI summaries are derived views, not alternate planning authorities.

## Canonical Planning Entities

| Entity | Meaning | Required rule |
| --- | --- | --- |
| Goal | Top-level durable planning objective | Every roadmap must have a parent goal |
| Roadmap | Durable multi-session planning structure under a goal | A roadmap never exists without a goal |
| Work point | Durable slice or roadmap item | The current workflow-artifact bridge derives it from `sliceId` when present |
| Plan | Durable planning artifact inside `elegy-planning` | The current elegy-copilot live UI does not expose full plan CRUD yet |
| Todo | Execution-oriented planning item | It may be standalone or plan-derived |
| Issue | Durable problem or follow-up record | It is first-class, not a second-class note |
| Review point | Attached review or evidence record | It attaches to another planning object and is not a top-level aggregate |
| Validation finding | Deterministic validation output | Validation should steer and repair authoring instead of blocking routine authoring by default |
| Planning event | Append-only planning history | Events are evidence and traceability, not a competing editable source of truth |

## Current elegy-copilot Integration

The live `elegy-copilot` planning bridge currently materializes a narrow subset of the full
authority model:

| Input surface | Live result |
| --- | --- |
| `POST /api/planning/workflow-artifacts` with artifact `roadmapId` | Verify or create `goal` and `roadmap` in `elegy-planning` |
| Same route with artifact `sliceId` | Verify or create `work-point` under the roadmap |
| Missing parent goal | Seed compatibility goal id `ie-goal-<roadmapId>` |
| `GET /api/planning/task-board` | Return the visible repo task-board projection from durable repo-state tasks |

Operational rules:

- Workflow-artifact persistence only succeeds when `elegyPlanningSync.status` is `synced`.
- Callers should inspect `elegyPlanningSync.validationStatus` from the bridged roadmap view.
- Missing, disabled, or unconfigured planning authority fails closed.
- `elegy-memory` may run additively, but it does not unblock failed planning durability.

## Semantic Rules

- Every roadmap requires a goal.
- Todo may exist without a roadmap, or may be derived from plan or roadmap work.
- Issue is a durable planning record, not just prose carryover.
- Review point must attach to a target entity rather than acting as a second portfolio hierarchy.
- Validation findings should guide correction and authoring quality without turning normal authoring
  into a blocked-only workflow.
- Projections, mirrors, and UI summaries must stay on-demand views over authoritative data.

## Planning-Surface Route Selection

The orchestrator and canonical docs continue to use these normalized fields:

| Field | Allowed values | Current interpretation |
| --- | --- | --- |
| `planning_surface` | `plan-pack` \| `roadmap` \| `both` \| `none` | Selects whether work should land in session artifacts, durable roadmap entities, both, or neither |
| `session_horizon` | `single-session` \| `multi-session` | Declares whether the ask closes inside one execution session or needs durable follow-up |
| `execution_readiness` | `ready` \| `stageable` \| `not-ready` | Declares whether execution can start now |
| `overlap_risk` | `low` \| `medium` \| `high` | Signals risk of mixing durable planning with active execution |

Interpretation rules:

- `planning_surface: roadmap` means durable work should land in `elegy-planning` roadmap and
  work-point space, not repo markdown roadmaps.
- `planning_surface: plan-pack` means the active execution artifact is
  `~/.copilot/session-state/<SESSION_ID>/plan.md`.
- `planning_surface: both` means durable roadmap framing happens first, then the selected slice moves
  into session execution artifacts.
- `planning_surface: none` means no durable planning artifact is required.

## Authority Boundaries

| Surface | Canonical authority | Not authoritative for |
| --- | --- | --- |
| `elegy-planning` goals, roadmaps, work points, plans, todos, issues, review points | Durable planning state | Live session runtime state |
| `~/.copilot/session-state/<SESSION_ID>/plan.md` and related session artifacts | Active-session execution | Durable roadmap portfolio state |
| `~/.copilot/repo-state/<repoId>/tasks/` and `tasks.archive/` | Durable task-board store | Goal or roadmap entity authority |
| Planning persistence records, suggestions, recaps, research notes, diagrams | Compatibility and admin planning store | Live roadmap authority |
| External Obsidian notes and representations | External and non-canonical context | Canonical planning writes |
| Repo-file bullets, backlog docs, roadmap docs | Retired live surfaces | Any current live planning authority |

## Retired Repo-File Planning Surfaces

The following API families are retired from the live path and return `410` with
`planning_repo_file_authority_retired`:

- `/api/planning/roadmaps*`
- `/api/planning/backlog*`
- `/api/planning/artifacts/bullets*`
- `/api/planning/artifacts/intake*`

The historical file families behind those routes are therefore not the supported live planning path:

- `~/.copilot/backlogs/{repo-name}/planning/bullets.md`
- `~/.copilot/backlogs/{repo-name}/backlogs/`
- `~/.copilot/backlogs/{repo-name}/roadmaps/`

Existing code, mirrors, or notes that still read those files are compatibility residue only.

## Remaining Compatibility Surfaces

| Surface | Current status |
| --- | --- |
| Planning records, search, compare, merge, suggestions, recaps | Mounted for compatibility and admin flows; not the primary Planning-tab authority |
| Record-scoped research notes and diagrams | Mounted via `planning-artifacts`; not the live durable planning authority |
| External Obsidian notes and representations | External and non-canonical compatibility surface |
| Session roadmap-sync and other residual file-backed reconciliation logic | Compatibility residue only; do not document as canonical live planning behavior |
| Repo-file bullets and intake route handlers still present in `planning-artifacts.js` | Centrally retired before dispatch in `server.js` |

## Validation And Evidence

- `copilot-ui/routes/planning.test.js`
- `copilot-ui/server.retired-planning-routes.test.js`
- `copilot-ui/scripts/validate-roadmap-workflow-e2e.js`
- `copilot-ui/tests/api-contract.test.js`
- `contracts/src/roadmapWorkflow.ts`
- `copilot-ui/lib/roadmapWorkflowPlanningBridge.js`

## References

- [docs/system/copilot-ui-guide.md](docs/system/copilot-ui-guide.md)
- [docs/system/session-state-artifacts.md](docs/system/session-state-artifacts.md)
- [docs/system/workflow-planning-contract.md](docs/system/workflow-planning-contract.md)
- [[goal-contract-governance]] [docs/system/goal-contract-governance.md](docs/system/goal-contract-governance.md)
- [copilot-ui/routes/_retiredPlanningAuthority.js](copilot-ui/routes/_retiredPlanningAuthority.js)
- [copilot-ui/lib/roadmapWorkflowPlanningBridge.js](copilot-ui/lib/roadmapWorkflowPlanningBridge.js)
