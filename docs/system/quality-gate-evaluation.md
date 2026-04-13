---
created: 2026-04-12
updated: 2026-04-12
category: system
status: current
doc_kind: node
id: quality-gate-evaluation
summary: Quality gate decision framework for routing validation layers and gating closure confidence.
tags: [validation, quality, pipeline, governance]
related: [validation-governance, testing-quality-governance, reviewer-lane-governance]
---

# Quality Gate Evaluation

## Purpose

Define the gate logic that connects validation layers into a pipeline. Each gate evaluates evidence from the previous layer before routing to the next. This prevents wasted effort (running integration on broken units) and ensures closure confidence reflects actual evidence.

## Gate Pipeline

```
Unit Gate → Integration Gate → E2E Gate → Closure
```

Each gate has an input condition, a pass/fail decision, and routing behavior.

## Gate Definitions

### Unit Gate

| Field | Value |
|---|---|
| **Input** | Completed code change with test suite |
| **Pass condition** | All targeted unit tests pass; no assertion count regressions; no dead tests detected by `@test-quality-reviewer` |
| **Fail behavior** | Block integration routing; return to implementation lane with failure evidence |
| **Skip condition** | Change is docs-only, config-only, or has no unit-testable behavior |
| **Output** | `unit_gate: PASS | FAIL | SKIPPED` with evidence summary |

### Integration Gate

| Field | Value |
|---|---|
| **Input** | Unit gate PASS or SKIPPED; cross-boundary change or policy requirement |
| **Pass condition** | Integration tests pass for affected boundaries; no contract regressions |
| **Fail behavior** | Block E2E routing; return failure evidence to orchestrator |
| **Skip condition** | Change is purely in-process with no cross-boundary effects; repo policy does not require integration |
| **Output** | `integration_gate: PASS | FAIL | SKIPPED` with evidence summary |

### E2E Gate

| Field | Value |
|---|---|
| **Input** | Integration gate PASS or SKIPPED; browser-visible change or policy requirement |
| **Pass condition** | E2E validation passes for affected user journeys |
| **Fail behavior** | Closure confidence capped at `medium`; report gap |
| **Skip condition** | Change has no browser-visible effects; no E2E policy requirement |
| **Output** | `e2e_gate: PASS | FAIL | SKIPPED` with evidence summary |

## Confidence Mapping

| Gate Results | Closure Confidence |
|---|---|
| All gates PASS | `high` |
| All required gates PASS, optional gates SKIPPED | `high` |
| One gate FAIL but non-blocking (advisory) | `medium` — report gap |
| Required gate FAIL | `low` — block closure or close as incomplete |
| No validation ran | `unverified` — must not claim confidence |

## Integration with Existing System

- **`@o-validation-coordinator`**: Evaluates unit and integration gates. Uses this doc's gate logic to decide routing.
- **`@e2e-validator`**: Evaluates E2E gate when triggered by policy or coordinator.
- **`@test-quality-reviewer`**: Provides input to unit gate (dead test detection, assertion quality).
- **Closure summary**: Must include gate results per `docs/system/validation-governance.md` reporting contract.

## Orchestrator Responsibilities

The orchestrator (or its coordinator delegate) must:

1. Evaluate each gate in order before routing to the next layer.
2. Never skip a required gate without documenting the skip reason.
3. Include gate results in the closure summary.
4. Block closure when required gates fail, unless the user explicitly accepts the risk.

## Non-Goals

- This doc does not define test runner behavior (see runner agents).
- This doc does not define test quality rules (see `testing-quality-governance.md`).
- This doc does not override `validation-governance.md` — it implements its decision matrix as a sequential pipeline.
