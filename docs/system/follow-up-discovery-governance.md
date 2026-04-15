---
created: 2026-03-13
updated: 2026-04-15
category: system
status: current
doc_kind: node
id: follow-up-discovery-governance
summary: Canonical contract for discovering remaining work, gaps, and research follow-ups, including the single orchestrator-only GPT research lane.
tags: [follow-up, research, governance, routing]
related: [reviewer-lane-governance, search-execute-workflow, project-conventions-governance, goal-contract-governance]
---

# Follow-Up Discovery Governance

## Purpose

Define the canonical contract for discovering remaining work, missing validation, carryover, and
research-worthy follow-ups after planning, implementation, or review.

## Context

This workflow now has two responsibilities:

- the orchestrator owns remaining-work judgment, session-close follow-up discovery, and durable carryover routing
- `@deep-researcher` is the single orchestrator-only research lane for questions that need evidence, options, or adoption framing before more implementation should be planned

There is no separate shipped `remaining-work` or `final-reviewer` lane.

## Primary Responsibilities

The orchestrator is responsible for:

- identifying remaining work after execution or review
- finding missing docs, tests, validation, rollout, or persistence steps
- converting reviewer findings into concrete next tasks
- separating immediate continuation work from durable backlog or roadmap carryover
- applying unresolved-goal carryover rules from `docs/system/goal-contract-governance.md`
- prioritizing blockers, active-goal gaps, and missing validation ahead of speculative polish

The research lane is responsible for:

- exploring promising ideas or gaps that need evidence before implementation
- evaluating adoption risks, integration points, and acceptance checks
- returning outputs that can feed planning instead of remaining loose notes

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

## Durable Handoff Decision

Instruction Engine still does not add a dedicated issue ledger. Durable follow-up routes through the
existing Repository Backlog family and approved `~/.copilot/backlogs/{repo-name}/issues/*` surfaces.

| Output or condition | Canonical durable surface | Notes |
| --- | --- | --- |
| unfinished active-goal scope | `~/.copilot/backlogs/{repo-name}/backlogs/<session-slug>.md` under `backlog_carryover.work_not_done` | primary per-session carryover surface |
| accepted `defect`, `rule_drift`, or `authority_gap` carryover | `~/.copilot/backlogs/{repo-name}/backlogs/<session-slug>.md` under `backlog_carryover.issues` | use queued backlog carryover unless explicitly outside current scope |
| accepted `improvement` carryover | `~/.copilot/backlogs/{repo-name}/backlogs/<session-slug>.md` under `backlog_carryover.suggestions` | use for real queued repo work rather than loose notes |
| planning-worthy idea or research outcome not yet accepted as queued work | `~/.copilot/backlogs/{repo-name}/issues/planning-ideas-log.md` | use after `DEEP_RESEARCH` when the result should persist as future planning input |
| explicitly deferred item outside approved current scope | `~/.copilot/backlogs/{repo-name}/issues/out-of-scope-findings.md` | use for deliberate scope deferral |
| unresolved high-level goal that is no longer active | `~/.copilot/backlogs/{repo-name}/issues/unresolved-goals.md` | reserved for `partial` / `not-complete` goal state |
| recurring implementation friction discovered during delivery | `~/.copilot/backlogs/{repo-name}/issues/implementation-friction-log.md` | use only for repeated delivery pain points |

## Routing

Use deterministic routing when intent is explicit:

- "what remains?", "find follow-up tasks", "identify gaps", "what docs/tests are still missing?" -> orchestrator closure
- "research this future capability", "explore options before we implement" -> `@deep-researcher`

Fast workspace, git, or session-state scans may still be used inside the orchestrator as evidence, but
they do not define a separate shipped lane.

## Output Contracts

Use this structure for orchestrator-produced follow-up discovery:

```text
FOLLOW_UP_DISCOVERY
- current_state:
  - <done items>
- session_backlog_path:
  - ~/.copilot/backlogs/{repo-name}/backlogs/<session-slug>.md | NONE
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

Use this structure when `@deep-researcher` is serving the research lane:

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

1. Use orchestrator closure for concrete gap finding tied to current work.
2. Use research when a gap cannot be responsibly closed without additional investigation.
3. Feed validated follow-up outputs into planning workflows instead of leaving them as narrative-only notes.
4. Normalize review findings through the category set in `docs/system/reviewer-lane-governance.md` before assigning carryover homes.
5. Route Repository Backlog or roadmap persistence through orchestrator-owned planning-surface selection and explicit writing lanes such as `@doc-writer`; do not hand persistence authority to dedicated planner agents.
6. Keep research concentrated in the single orchestrator-only GPT lane.

## Persistent Discovery Surfaces

The goal/discovery governance surface uses these persistent docs for cross-session carryover:

- `~/.copilot/backlogs/{repo-name}/backlogs/*.md`
- `~/.copilot/backlogs/{repo-name}/issues/unresolved-goals.md`
- `~/.copilot/backlogs/{repo-name}/issues/planning-ideas-log.md`
- `~/.copilot/backlogs/{repo-name}/issues/out-of-scope-findings.md`
- `~/.copilot/backlogs/{repo-name}/issues/implementation-friction-log.md`

## References

- `docs/system/search-execute-workflow.md`
- `docs/system/reviewer-lane-governance.md`
- `docs/system/project-conventions-governance.md`
- `docs/system/goal-contract-governance.md`
- `engine-assets/agents/deep-researcher.agent.md`
