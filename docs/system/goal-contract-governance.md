---
created: 2026-03-15
updated: 2026-06-30
category: system
status: current
doc_kind: node
id: goal-contract-governance
summary: Canonical high-level goal contract for planning and review workflows, including completion states, carryover persistence, and authority boundaries.
tags: [goals, planning, review, governance]
related: [planpack-spec, session-state-artifacts, reviewer-lane-governance, follow-up-discovery-governance, planning-backlog-roadmap-contract]
---

# Goal Contract Governance

## Purpose

Define the canonical contract for high-level goals as a planning intent surface and end-of-execution
review outcome surface.

## Context

Planning and execution already have canonical artifacts for decomposition (`plan.md`/Plan Pack),
session runtime state (`docs/system/session-state-artifacts.md`), and durable planning authority
(`elegy-planning`, as summarized in `docs/system/planning-backlog-roadmap-contract.md`). This goal
contract adds a stable cross-workflow outcome layer and now explicitly drives workflow behavior in
orchestrator and persisted session-state execution.

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

### End-of-Execution Goal Strategy

High-level goal completion is orchestrator-owned:

- the orchestrator decides whether each goal is `complete`, `partial`, or `not-complete`
- `@code-reviewer` and `@test-runner` provide evidence, but they do not own goal closure
- an explicit docs-writing lane performs any required `~/.elegy/backlogs/{repo-name}/issues/unresolved-goals.md` updates when carryover should persist

### Goal Closure Workflow Enforcement

Execution workflows must treat the orchestrator's goal assessment as authoritative for goal closure:

1. `complete` allows final closure to continue.
2. `partial` or `not-complete` means one or more active goals still need execution, replan work, or carryover.
3. If evidence is insufficient to judge closure, the workflow must pause final closure until unblocked.

Carryover persistence/removal is routed separately from the closure judgment:

1. The orchestrator should emit explicit sync instructions (`unresolved_goals_path`, `session_backlog_path`, `carryover_goals`, `resolved_goals_to_remove`) when durable follow-up is needed.
2. Workflows should pass an explicit carryover owner when one is known. If no stronger owner is available, use a deterministic fallback such as `workflow-orchestrator` rather than leaving Owner undefined.
3. If a compatibility workflow still needs a carryover file target, `session_backlog_path` should prefer `~/.elegy/backlogs/{repo-name}/backlogs/<session-slug>.md`. `docs/backlog.md` is a deprecated legacy compatibility target only.
4. The workflow routes unresolved-goal sync and any compatibility carryover-file persistence through an explicit docs-writing lane.
5. No workflow should let reviewer or validation lanes write `~/.elegy/backlogs/{repo-name}/issues/unresolved-goals.md` or legacy backlog docs directly.

### Unresolved Goal Persistence Contract

Canonical carryover file path:

- `~/.elegy/backlogs/{repo-name}/issues/unresolved-goals.md`

Persistence rules:

1. Only unresolved goals (`partial` or `not-complete`) that are no longer active in the current
   execution context should be written to `~/.elegy/backlogs/{repo-name}/issues/unresolved-goals.md`.
2. Active goals in an in-flight plan/session should remain in active planning/session artifacts and
   should not be duplicated into unresolved-goals during active execution.
3. Resolved goals must be removed from `~/.elegy/backlogs/{repo-name}/issues/unresolved-goals.md`.
4. No archive file is required for removed/resolved goals.
5. When `GOAL_REVIEW.unresolved_goals_path = ~/.elegy/backlogs/{repo-name}/issues/unresolved-goals.md`, the workflow should
   sync that file so it contains exactly the current unresolved, non-active goals and removes any
   entries now complete or active again.
6. When `GOAL_REVIEW.unresolved_goals_path = NONE`, the workflow should either:
   - perform a removal-only clean-up if `resolved_goals_to_remove` is non-empty, or
   - no-op and leave the file untouched if both carryover and removal lists are `NONE`.

### Compatibility Carryover File Path Contract

Compatibility carryover file path family:

- `~/.elegy/backlogs/{repo-name}/backlogs/<session-slug>.md`

Legacy compatibility path (deprecated):

- `docs/backlog.md`

Path rules:

1. When end-of-session closure still needs a file-backed compatibility carryover target, workflows should provide or preserve an explicit `session_backlog_path`.
2. New compatibility carryover should target `~/.elegy/backlogs/{repo-name}/backlogs/<session-slug>.md`.
3. `docs/backlog.md` may remain in play only for legacy compatibility flows that already depend on it.
4. Path selection does not create a new backlog ID family; carryover continues to use stable `RB-*` IDs or references.

### Workflow Coverage Target

This goal contract is canonical for:

- default `/plan` workflow
- host-native plan-first workflow
- explicit persisted session-state planning/execution workflows

### Additional Persistent Goal/Discovery Docs

The following issue-doc paths are canonical persistent supporting surfaces:

- `~/.elegy/backlogs/{repo-name}/issues/planning-ideas-log.md`
- `~/.elegy/backlogs/{repo-name}/issues/out-of-scope-findings.md`

Compatibility backlog carryover files remain available under `~/.elegy/backlogs/{repo-name}/backlogs/*.md`, with
legacy compatibility support at `docs/backlog.md` (deprecated).

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
