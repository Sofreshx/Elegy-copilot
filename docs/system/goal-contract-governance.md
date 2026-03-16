---
created: 2026-03-15
updated: 2026-03-15
category: system
status: current
doc_kind: node
id: goal-contract-governance
summary: Canonical high-level goal contract for planning and review workflows, including completion states, carryover persistence, and authority boundaries.
tags: [goals, planning, review, governance]
related: [planpack-spec, session-state-artifacts, reviewer-lane-governance, follow-up-discovery-governance, planning-backlog-roadmap-contract, unresolved-goals, planning-ideas-log, out-of-scope-findings]
---

# Goal Contract Governance

## Purpose

Define the canonical contract for high-level goals as a planning intent surface and end-of-execution
review outcome surface.

## Context

Planning and execution already have canonical artifacts for decomposition (`plan.md`/Plan Pack),
session runtime state (`docs/system/session-state-artifacts.md`), and portfolio planning
(`docs/backlog.md` plus `docs/roadmaps/*.md`). This goal contract adds a stable cross-workflow
outcome layer and now explicitly drives workflow behavior in orchestrator and persisted
session-state execution.

## Details

### High-Level Goal Intent Surface

Plans should include an explicit high-level goal bullet list that states intended outcomes before
work-unit decomposition.

- The list is human-readable planning intent, not a replacement for `WU-*` execution tracking.
- Goal bullets should remain stable enough for end-of-execution outcome review.

### Goal Completion States

Each high-level goal uses exactly one canonical completion state:

- `complete` — goal outcome delivered as intended
- `partial` — some intended outcome delivered, but meaningful scope remains
- `not-complete` — goal outcome not delivered

These states are for outcome reporting and carryover decisions.

### End-of-Execution Review Strategy

The end-of-execution reviewer split is additive:

- `@goal-reviewer` is the dedicated high-level goal completion assessor.
- `@final-reviewer` remains the requested-vs-delivered summary gate.
- `@goal-reviewer` stays read-only; a documentation lane such as `@doc-writer` performs any required `docs/issues/unresolved-goals.md` updates.

This does not deprecate existing reviewer lanes.

### `GOAL_REVIEW` Workflow Enforcement

Execution workflows must treat `GOAL_REVIEW.status` as authoritative for goal closure:

1. `APPROVED` allows final closure to continue.
2. `NEEDS_REVISION` means one or more active goals still need execution or replan work and the run must not be treated as done.
3. `BLOCKED` means the goal review lacks enough evidence/context to judge closure; the workflow must pause final closure until unblocked.

Carryover persistence/removal is routed separately from the review lane:

1. `@goal-reviewer` emits read-only sync instructions (`unresolved_goals_path`, `carryover_goals`, `resolved_goals_to_remove`), including the provenance needed by the unresolved-goals doc schema.
2. The workflow routes those instructions through `@doc-writer` or another explicit docs-writing lane.
3. No workflow should let `@goal-reviewer` write `docs/issues/unresolved-goals.md` directly.

### Unresolved Goal Persistence Contract

Canonical carryover file path:

- `docs/issues/unresolved-goals.md`

Persistence rules:

1. Only unresolved goals (`partial` or `not-complete`) that are no longer active in the current
   execution context should be written to `docs/issues/unresolved-goals.md`.
2. Active goals in an in-flight plan/session should remain in active planning/session artifacts and
   should not be duplicated into unresolved-goals during active execution.
3. Resolved goals must be removed from `docs/issues/unresolved-goals.md`.
4. No archive file is required for removed/resolved goals.
5. When `GOAL_REVIEW.unresolved_goals_path = docs/issues/unresolved-goals.md`, the workflow should
   sync that file so it contains exactly the current unresolved, non-active goals and removes any
   entries now complete or active again.
6. When `GOAL_REVIEW.unresolved_goals_path = NONE`, the workflow should either:
   - perform a removal-only clean-up if `resolved_goals_to_remove` is non-empty, or
   - no-op and leave the file untouched if both carryover and removal lists are `NONE`.

### Workflow Coverage Target

This goal contract is canonical for:

- default `/plan` workflow
- `@orchestrator + @o-planner` workflow
- explicit persisted session-state planning/execution workflows

### Additional Persistent Goal/Discovery Docs

The following issue-doc paths are canonical persistent supporting surfaces:

- `docs/issues/planning-ideas-log.md`
- `docs/issues/out-of-scope-findings.md`

Use these docs for cross-session carryover context that should not be mixed into active in-flight
session execution artifacts.

### Authority Boundaries

| Surface | Canonical authority | Not authoritative for |
| --- | --- | --- |
| High-level goal intent/completion/carryover rules | This goal contract | Work-unit decomposition details or runtime session reconciliation |
| Repo backlog/roadmap prioritization and cross-plan portfolio state | `docs/system/planning-backlog-roadmap-contract.md` | Session execution state or per-session artifact lifecycle |
| Session artifact layout, plan/proposition/handoff/verification guide shape | `docs/system/session-state-artifacts.md` | Repo backlog/roadmap prioritization |

## References

- `docs/system/planpack-spec.md`
- `docs/system/session-state-artifacts.md`
- `docs/system/reviewer-lane-governance.md`
- `docs/system/follow-up-discovery-governance.md`
- `docs/system/planning-backlog-roadmap-contract.md`
