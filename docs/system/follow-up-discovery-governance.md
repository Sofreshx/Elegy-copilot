---
created: 2026-03-13
updated: 2026-04-03
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
4. Route structured Repository Backlog carryover through a backlog-writing lane such as `@backlog-planner`.
5. Keep research additive; do not introduce a separate research-scout lane until the upgraded
   `research-ideation` contract proves insufficient.
6. When carryover context is present, distinguish active-session continuation from non-active carryover so stale goals are not reintroduced as zombie follow-ups.

## Persistent Discovery Surfaces

The goal/discovery governance surface uses these persistent docs for cross-session carryover:

- `docs/backlogs/*.md` (primary per-session Repository Backlog carryover family)
- `docs/backlog.md` (legacy Repository Backlog compatibility surface)
- `docs/issues/planning-ideas-log.md`
- `docs/issues/out-of-scope-findings.md`

These paths are approved targets, but this document does not require immediate creation.

## References

- `docs/system/search-execute-workflow.md`
- `docs/system/reviewer-lane-governance.md`
- `docs/system/project-conventions-governance.md`
- `docs/system/goal-contract-governance.md`
- `engine-assets/agents/remaining-work.agent.md`
- `engine-assets/agents/research-ideation.agent.md`
