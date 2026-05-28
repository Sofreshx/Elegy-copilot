---
created: 2026-04-27
updated: 2026-05-25
category: system
status: current
doc_kind: node
id: calibrated-questioning-and-depth-governance
summary: Canonical shared policy for evidence-bound questioning and depth calibration across planning and review.
tags: [governance, questioning, depth, planning, review]
related: [search-execute-workflow, orchestrator-user-guide, reviewer-lane-governance, follow-up-discovery-governance, planning-backlog-roadmap-contract, planpack-spec, progressive-constraint-narrowing, adr-governance, skills-governance, model-capability-profile]
---

# Calibrated Questioning and Depth Governance

## Purpose

This node owns the shared policy for calibrated questioning and depth across planning and review.

- It applies to orchestration, planner use, reviewer falsification posture, and follow-up intake.
- It is not a new routing hierarchy, not a new planner lane, not a new reviewer lane, and not a new persistence surface.
- Staged routing stays in [docs/system/search-execute-workflow.md](docs/system/search-execute-workflow.md), planning-surface authority stays in [docs/system/planning-backlog-roadmap-contract.md](docs/system/planning-backlog-roadmap-contract.md), and lane-specific outputs stay in their existing contracts.

## Default Evidence-Bound Questioning Ladder

Default questioning is evidence-first, assumption-second, and user-question-last.

| Step | When it applies | Required behavior |
| --- | --- | --- |
| Answer from evidence | Canonical docs or repo evidence deterministically answer the question | Answer directly from that evidence and keep moving. Do not ask the user for a branch that is already settled. |
| Carry a recommended assumption | Evidence is strong, but one minor branch remains open and it does not materially change the outcome | Name the recommended assumption, continue on that branch, and keep the assumption visible for later correction. |
| Ask the user | The unresolved branch would materially change scope, architecture, validation, verdict, or the proceed-anyway posture | Stop at that branch and ask the user before continuing with the dependent step. |

This ladder is the default for planning and review. Complexity alone is not a reason to ask more questions.

When a question resolves to a standing durable architectural or workflow-authority rule, do not keep
that rule trapped inside the current plan or prompt. Narrow the active constraint set for the current
step and promote the durable decision through the owning canonical doc or [[adr-governance]] [docs/system/adr-governance.md](docs/system/adr-governance.md) when needed.

## Route-First Depth Calibration

Depth calibration starts from the existing normalized planning fields rather than from generic complexity labels.

| Field | Calibration use |
| --- | --- |
| `planning_surface` | Decides whether active execution-planning or execution-review depth is even in play and keeps roadmap authority separate from plan-pack authority. |
| `session_horizon` | Shapes how much carryover and resumability questioning is needed once the route is already selected. |
| `execution_readiness` | Decides whether the current step should execute, stage, or stop for more input before deeper challenge continues. |
| `overlap_risk` | Raises scrutiny on validation, persistence, and bounded-overlap decisions once the route is already selected. |

Hard no-activate states for deep/grill overlay behavior:

- `planning_surface: none`
- `planning_surface: roadmap`
- `execution_readiness: not-ready`

When any hard no-activate state applies, use the default questioning ladder and the existing route outcome. Do not manufacture a deeper planning or review mode.

Classification, complexity, and type are secondary shaping signals only. They do not activate deep/grill mode by themselves.

## Deep/Grill Overlay Rules

Deep/grill mode is an overlay inside the existing route, not a new lane.

- It may activate only through explicit user opt-in or an explicit workflow/profile selection that is already allowed by canonical routing and profile policy.
- `balanced-default` must not auto-select deep/grill mode.
- No overlay may bypass the staged routing and canonical bootstrap posture in [docs/system/search-execute-workflow.md](docs/system/search-execute-workflow.md).
- Model capability profiles may influence which model handles an already-selected overlay, but they do not authorize the overlay by themselves. See [docs/system/model-capability-profile.md](docs/system/model-capability-profile.md).
- Skills or prompts may support an already-selected overlay, but they do not create a parallel routing hierarchy or a second default mode. See [docs/system/skills-governance.md](docs/system/skills-governance.md).

## Lane Application

Planner, reviewer, and follow-up lanes apply this policy locally without redefining their own contracts.

| Surface | Shared-policy application |
| --- | --- |
| Planner / orchestrator | Use the questioning ladder before asking the user, and calibrate challenge depth from the selected planning fields before stressing assumptions or validation gaps. |
| Reviewer | Apply evidence-bound falsification inside reviewer responsibilities and shared hard no-activate limits; do not turn deeper challenge into speculative defects or closure takeover. |
| Follow-up discovery | Route challenged assumptions, evidence gaps, and blocking unknowns into `immediate_next_tasks`, `gaps`, or `research_threads` under [docs/system/follow-up-discovery-governance.md](docs/system/follow-up-discovery-governance.md). |

## Output and Contract Boundaries

This policy changes questioning intensity, not output ownership.

- Plan-pack shape stays owned by [docs/system/planpack-spec.md](docs/system/planpack-spec.md).
- Reviewer outputs stay owned by [docs/system/reviewer-lane-governance.md](docs/system/reviewer-lane-governance.md).
- Follow-up output routing stays owned by [docs/system/follow-up-discovery-governance.md](docs/system/follow-up-discovery-governance.md).
- If richer plan-pack sections become required, update [docs/system/planpack-spec.md](docs/system/planpack-spec.md) first before prompts or agent assets redefine outputs.

## References

- [docs/system/search-execute-workflow.md](docs/system/search-execute-workflow.md)
- [docs/system/orchestrator/user-guide.md](docs/system/orchestrator/user-guide.md)
- [docs/system/reviewer-lane-governance.md](docs/system/reviewer-lane-governance.md)
- [docs/system/follow-up-discovery-governance.md](docs/system/follow-up-discovery-governance.md)
- [docs/system/planning-backlog-roadmap-contract.md](docs/system/planning-backlog-roadmap-contract.md)
- [docs/system/planpack-spec.md](docs/system/planpack-spec.md)
- [docs/system/skills-governance.md](docs/system/skills-governance.md)
- [docs/system/model-capability-profile.md](docs/system/model-capability-profile.md)
