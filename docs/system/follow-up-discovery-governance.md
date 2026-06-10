---
created: 2026-03-13
updated: 2026-04-27
category: system
status: current
doc_kind: node
id: follow-up-discovery-governance
summary: Canonical contract for discovering remaining work, gaps, and research follow-ups.
tags: [follow-up, research, governance, routing]
related: [reviewer-lane-governance, search-execute-workflow, project-conventions-governance, goal-contract-governance]
---

# Follow-Up Discovery Governance

## Purpose

Define the canonical contract for discovering remaining work, missing validation, carryover, and
research-worthy follow-ups after planning, implementation, or review.

## Context

This workflow has one responsibility:

- remaining-work judgment, session-close follow-up discovery, and durable carryover routing

There is no separate shipped `remaining-work` or `final-reviewer` lane.

## Primary Responsibilities

Responsibilities include:

- identifying remaining work after execution or review
- finding missing docs, tests, validation, rollout, or persistence steps
- converting reviewer findings into concrete next tasks
- separating immediate continuation work from durable backlog or roadmap carryover
- applying unresolved-goal carryover rules from `docs/system/goal-contract-governance.md`
- prioritizing blockers, active-goal gaps, and missing validation ahead of speculative polish

## Normalized Finding Intake

Accepted reviewer or governance findings should be reduced to exactly one category before follow-up routing:

| Category | Meaning | Default follow-up home |
| --- | --- | --- |
| `defect` | confirmed or strongly supported correctness, security, runtime, or high-signal quality problem | `immediate_next_tasks` when it blocks active work; otherwise carryover under backlog `issues` |
| `rule_drift` | implementation/docs/naming/structure drift against a canonical rule or stable repo convention | `immediate_next_tasks` when required for the current slice; otherwise carryover under backlog `issues` |
| `authority_gap` | missing, contradictory, or hard-to-discover canonical rule or entrypoint | `gaps` when it blocks the current step; otherwise backlog `issues` routed to conventions/docs governance |
| `research_thread` | topic needing comparative analysis, outside evidence, or adoption framing before planning | `research_threads` |
| `improvement` | non-blocking maintainability or quality suggestion | deferred carryover or backlog `suggestions` |

`work_not_done` remains reserved for already-committed active-goal scope that was not completed in the
current session, regardless of which normalized category originally exposed the gap.

## Intake from Calibrated Questioning

Challenged assumptions, evidence gaps, and blocking unknowns inherit from [docs/system/calibrated-questioning-and-depth-governance.md](docs/system/calibrated-questioning-and-depth-governance.md) and route here instead of creating a separate discovery surface.

- challenged assumptions or missing evidence that block the active slice -> `immediate_next_tasks`
- missing authority or other blocking unknowns for the current step -> `gaps`
- questions that need comparative analysis before planning or execution -> `research_threads`

## Durable Handoff Decision

Instruction Engine still does not add a dedicated issue ledger. Durable follow-up routes through the
existing Repository Backlog family and approved `~/.elegy/backlogs/{repo-name}/issues/*` surfaces.

| Output or condition | Canonical durable surface | Notes |
| --- | --- | --- |
| unfinished active-goal scope | `~/.elegy/backlogs/{repo-name}/backlogs/<session-slug>.md` under `backlog_carryover.work_not_done` | primary per-session carryover surface |
| accepted `defect`, `rule_drift`, or `authority_gap` carryover | `~/.elegy/backlogs/{repo-name}/backlogs/<session-slug>.md` under `backlog_carryover.issues` | use queued backlog carryover unless explicitly outside current scope |
| accepted `improvement` carryover | `~/.elegy/backlogs/{repo-name}/backlogs/<session-slug>.md` under `backlog_carryover.suggestions` | use for real queued repo work rather than loose notes |
| planning-worthy idea or research outcome not yet accepted as queued work | `~/.elegy/backlogs/{repo-name}/issues/planning-ideas-log.md` | use after `DEEP_RESEARCH` when the result should persist as future planning input |
| explicitly deferred item outside approved current scope | `~/.elegy/backlogs/{repo-name}/issues/out-of-scope-findings.md` | use for deliberate scope deferral |
| unresolved high-level goal that is no longer active | `~/.elegy/backlogs/{repo-name}/issues/unresolved-goals.md` | reserved for `partial` / `not-complete` goal state |
| recurring implementation friction discovered during delivery | `~/.elegy/backlogs/{repo-name}/issues/implementation-friction-log.md` | use only for repeated delivery pain points |

## Routing

Use deterministic routing when intent is explicit:

- "what remains?", "find follow-up tasks", "identify gaps", "what docs/tests are still missing?" -> coordinator closure
- "research this future capability", "explore options before we implement" -> host research lane or normal evidence-gathering workflow

Fast workspace, git, or session-state scans may still be used inside the coordinator as evidence, but
they do not define a separate shipped lane.

## Output Contracts

Use this structure for coordinator-produced follow-up discovery:

```text
FOLLOW_UP_DISCOVERY
- current_state:
  - <done items>
- session_backlog_path:
  - ~/.elegy/backlogs/{repo-name}/backlogs/<session-slug>.md | NONE
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

Use this structure when a research lane is serving the follow-up:

```text
DEEP_RESEARCH
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

1. Use coordinator closure for concrete gap finding tied to current work.
2. Use research when a gap cannot be responsibly closed without additional investigation.
3. Feed validated follow-up outputs into planning workflows instead of leaving them as narrative-only notes.
4. Normalize review findings through the category set in `docs/system/reviewer-lane-governance.md` before assigning carryover homes.
5. Route Repository Backlog or roadmap persistence through coordinator-owned planning-surface selection and explicit writing lanes; do not hand persistence authority to dedicated planner agents.
6. Keep research concentrated in the selected research lane or evidence-gathering workflow.

## Persistent Discovery Surfaces

The goal/discovery governance surface uses these persistent docs for cross-session carryover:

- `~/.elegy/backlogs/{repo-name}/backlogs/*.md`
- `~/.elegy/backlogs/{repo-name}/issues/unresolved-goals.md`
- `~/.elegy/backlogs/{repo-name}/issues/planning-ideas-log.md`
- `~/.elegy/backlogs/{repo-name}/issues/out-of-scope-findings.md`
- `~/.elegy/backlogs/{repo-name}/issues/implementation-friction-log.md`

## References

- `docs/system/search-execute-workflow.md`
- `docs/system/reviewer-lane-governance.md`
- `docs/system/project-conventions-governance.md`
- `docs/system/goal-contract-governance.md`
