---
created: 2026-03-13
updated: 2026-04-09
category: system
status: current
doc_kind: node
id: follow-up-discovery-governance
summary: Canonical contract for discovering remaining work, gaps, and research follow-ups, including the upgraded research-ideation posture.
tags: [follow-up, research, governance, routing]
related: [reviewer-lane-governance, search-execute-workflow, project-conventions-governance, goal-contract-governance]
---

# Follow-Up Discovery Governance

## Purpose

Define the canonical contract for finding remaining work, gaps, missing validation, and research
opportunities after planning, implementation, or review.

## Context

This family is intentionally split into two cooperating responsibilities:

- a follow-up discovery lane for actionable gaps and next tasks
- an upgraded `research-ideation` lane for deeper exploration when an idea needs evidence, options,
  and adoption framing

The approved plan explicitly prefers **upgrading `research-ideation` before adding a separate
research agent**.

## Primary Responsibilities

The follow-up discovery lane is responsible for:

- identifying remaining work after execution or review
- finding missing docs, tests, validation, or rollout steps
- converting reviewer findings into concrete next tasks
- separating immediate follow-up work from deeper research threads
- normalizing durable Repository Backlog carryover into explicit categories for session-close sync: work not done, issues, and suggestions
- applying the unresolved-goal carryover rule from [[goal-contract-governance]]
  [docs/system/goal-contract-governance.md](docs/system/goal-contract-governance.md) when goals are `partial` or `not-complete`
- prioritizing blockers, active-goal gaps, and missing validation ahead of speculative polish

The research lane is responsible for:

- exploring promising ideas or gaps that need evidence before implementation
- evaluating adoption risks, integration points, and acceptance checks
- returning outputs that can feed later planning instead of remaining loose notes

## Relationship to Existing Assets

- `remaining-work` remains the fastest best-effort signal for working-tree, manifest, and session
  state drift.
- The follow-up discovery lane consumes `remaining-work`, reviewer outputs, validation evidence, and
  governance findings.
- `research-ideation` remains the canonical research surface for V1 and should be upgraded in
  behavior/contract before a new research-specific agent is introduced.

## Normalized Finding Intake

The project-audit/static-analysis family defined in
`docs/system/reviewer-lane-governance.md` feeds this lane through an additive normalization
overlay. Native reviewer and scanner outputs stay unchanged, but each accepted finding should be
reduced to exactly one category before follow-up routing.

| Category | Meaning | Default follow-up home |
| --- | --- | --- |
| `defect` | confirmed or strongly supported correctness, security, runtime, or high-signal quality problem | `immediate_next_tasks` when it blocks active work; otherwise `defer_or_backlog` and durable `backlog_carryover.issues` when carryover is needed |
| `rule_drift` | implementation/docs/naming/structure drift against a canonical rule or stable repo convention | `immediate_next_tasks` when required for the current slice; otherwise `backlog_carryover.issues` |
| `authority_gap` | missing, contradictory, or hard-to-discover canonical rule or entrypoint | `gaps` when it blocks the current step; otherwise `backlog_carryover.issues` routed to conventions or documentation governance |
| `research_thread` | topic needing comparative analysis, outside evidence, or adoption framing before planning | `research_threads` |
| `improvement` | non-blocking maintainability or quality suggestion that is not yet a defect, rule drift, or authority gap | `defer_or_backlog` or `backlog_carryover.suggestions` |

`work_not_done` remains reserved for already-committed active-goal scope that was not completed in
the current session, regardless of which normalized category originally exposed the gap.

`deferred issue` is not a separate intake category in V1. Deferral is a routing decision made after
normalization.

## V1 Durable Handoff Decision

Instruction Engine does **not** add a dedicated issue ledger in V1. The existing Repository Backlog
family plus the approved `docs/issues/*` surfaces are sufficient for durable issue-to-plan handoff
once routing is explicit. The minimal additive extension for this first pass is therefore a tighter
mapping contract, not a new persistence surface.

| Normalized output or condition | Canonical durable surface | Notes |
| --- | --- | --- |
| unfinished active-goal scope | `docs/backlogs/<session-slug>.md` under `backlog_carryover.work_not_done` | `docs/backlog.md` remains legacy compatibility only |
| accepted `defect`, `rule_drift`, or `authority_gap` carryover | `docs/backlogs/<session-slug>.md` under `backlog_carryover.issues` | use queued backlog carryover unless the item is explicitly outside approved scope |
| accepted `improvement` carryover | `docs/backlogs/<session-slug>.md` under `backlog_carryover.suggestions` | use when the idea is real queued repo work rather than a loose note |
| planning-worthy idea or research outcome not yet accepted as queued work | `docs/issues/planning-ideas-log.md` | use after `research_threads` / `RESEARCH_IDEATION` when the outcome should persist as future planning input |
| explicitly deferred item outside the approved current scope | `docs/issues/out-of-scope-findings.md` | use for deliberate scope deferral, not for every backlog decision |
| unresolved high-level goal that is no longer active | `docs/issues/unresolved-goals.md` | reserved for `partial` / `not-complete` goal state under [[goal-contract-governance]] [docs/system/goal-contract-governance.md](docs/system/goal-contract-governance.md) |
| recurring implementation friction discovered during delivery | `docs/issues/implementation-friction-log.md` | use only for repeated delivery pain points, not as a generic issue ledger |

Notes:

- `research_thread` first routes to `research_threads`; persist it in `docs/issues/planning-ideas-log.md`
  only when the result should survive as planning input and has not yet been accepted into backlog.
- `unresolved-goals` is a goal-state carryover surface, not a general issue bucket.
- `implementation-friction-log` is a specialized recurring-friction surface, not a replacement for
  Repository Backlog carryover.

## Routing

Use deterministic routing when intent is explicit:

- "what remains?" -> `remaining-work`
- "find follow-up tasks", "identify gaps", "what docs/tests are still missing?" -> follow-up discovery lane
- "research this future capability", "explore options before we implement" -> `research-ideation`

Escalate from follow-up discovery to research when:

- the next step is unclear without comparative analysis
- the task needs external evidence or option evaluation
- the outcome should propose a future capability, workflow, or integration path

## Output Contracts

Use this structure for follow-up discovery:

```text
FOLLOW_UP_DISCOVERY
- current_state:
  - <done items>
- session_backlog_path:
  - docs/backlogs/<session-slug>.md | docs/backlog.md | NONE
- gaps:
  - <missing docs/tests/validation/work>
- immediate_next_tasks:
  - <actionable next step>
- defer_or_backlog:
  - <non-blocking future work>
- backlog_carryover:
  - work_not_done | <planning-ready carryover or NONE>
  - issues | <problem, defect, or risk follow-up or NONE>
  - suggestions | <improvement idea or NONE>
- research_threads:
  - <topic needing research or NONE>
- blockers:
  - <blocker or NONE>
```

Use this structure when `research-ideation` is serving the upgraded research lane:

```text
RESEARCH_IDEATION
- topic:
- findings:
  - <evidence>
- options:
  - <option with tradeoff>
- recommendation:
  - <preferred direction or NONE>
- acceptance_checks:
  - <what would make the idea ready>
- adoption_risks:
  - <risk>
- proposed_follow_ups:
  - <planning-ready tasks>
```

## Handoff Rules

1. Use follow-up discovery for concrete gap finding tied to current work.
2. Use research when a gap cannot be responsibly closed without additional investigation.
3. Feed validated follow-up outputs into planning workflows instead of leaving them as narrative-only
   notes.
4. Normalize project-audit/static-analysis findings through the category set in
   `docs/system/reviewer-lane-governance.md` before assigning carryover homes.
5. Route structured Repository Backlog carryover through a backlog-writing lane such as `@backlog-planner`.
6. Keep research additive; do not introduce a separate research-scout lane until the upgraded
   `research-ideation` contract proves insufficient.
7. When carryover context is present, distinguish active-session continuation from non-active carryover so stale goals are not reintroduced as zombie follow-ups.
8. Do not add or imply a separate V1 issue-ledger artifact; use the Repository Backlog plus approved
   `docs/issues/*` surfaces above.

## Persistent Discovery Surfaces

The goal/discovery governance surface uses these persistent docs for cross-session carryover:

- `docs/backlogs/*.md` (primary per-session Repository Backlog carryover family)
- `docs/backlog.md` (legacy Repository Backlog compatibility surface)
- `docs/issues/unresolved-goals.md`
- `docs/issues/planning-ideas-log.md`
- `docs/issues/out-of-scope-findings.md`
- `docs/issues/implementation-friction-log.md`

These paths are approved targets, but this document does not require immediate creation.

## References

- `docs/system/search-execute-workflow.md`
- `docs/system/reviewer-lane-governance.md`
- `docs/system/project-conventions-governance.md`
- `docs/system/goal-contract-governance.md`
- `engine-assets/agents/follow-up-finder.agent.md`
- `engine-assets/agents/remaining-work.agent.md`
- `engine-assets/agents/research-ideation.agent.md`
