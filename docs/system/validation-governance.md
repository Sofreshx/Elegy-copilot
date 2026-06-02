---
created: 2026-04-03
updated: 2026-04-15
category: system
status: current
doc_kind: node
id: validation-governance
summary: Canonical validation-governance rules for mandatory unit, integration, and E2E coverage; browser-tooling split; and closure confidence handling.
tags: [validation, testing, e2e, governance]
related: [testing-and-e2e, testing-quality-governance, e2e-setup-guide, planpack-spec, session-state-artifacts, orchestration-and-agents]
---

# Validation Governance

This document defines when validation is mandatory, which tool path applies, and how validation
coverage must be selected, reported, and persisted.

Test-quality expectations for any validation artifact are governed by
`docs/system/testing-quality-governance.md`.

## Core Rules

1. Validation is policy-driven, not only user-request-driven.
2. The default orchestration loop is lean and risk-based: run the narrowest validation proof that
   closes the active risk instead of stacking unit, integration, and E2E checks by habit.
3. `@orchestrator` may still require integration or E2E validation when repo policy, risk, or current
   coverage gaps make a lower layer insufficient, even when the user did not explicitly ask for it.
4. Mandatory validation is triggered when repo policy, risk, or current coverage gaps make a lower
   validation layer insufficient.
5. Missing mandatory validation must remain explicit. It lowers closure confidence and may block a
   confident `done` outcome.

## Default Selection Posture

Default validation should be the smallest useful proof:

- Prefer one targeted command or runtime proof that exercises the changed behavior.
- Do not run broader integration or browser coverage merely because it exists.
- Escalate to a broader layer only when the narrow layer cannot close the active risk, repo policy
  requires the broader layer, or prior evidence is missing/inconclusive.
- When a broader layer is not required, report it as not required rather than as an unrun gap.
- If a mandatory broader layer is skipped, keep that gap explicit and lower closure confidence.

## Decision Matrix

| Layer | Mandatory when | Default route/tool | If required coverage is missing |
| --- | --- | --- | --- |
| Unit | Behavior-affecting code changes where the changed logic can be verified narrowly in-process | `@test-runner` by default. If a direct unit command is needed, it stays inside the consolidated testing lane as the runner's narrow deterministic execution path. | Closure confidence must not be `high`; report the gap explicitly |
| Integration | Cross-boundary behavior, storage/network/API contract changes, new features with weak unit-only coverage, auth/session coupling, or repo policy requiring broader confirmation | `@test-runner` by default. Any fallback integration command must remain inside the consolidated testing lane. | Keep the gap explicit; do not imply unit coverage alone closed the risk |
| E2E | Browser-visible or stateful user journeys, auth/login/logout flows, risky UI/API behavior changes, new or untested UI surfaces, or cases where only a real browser confirms the behavior | `@test-runner` chooses the correct browser path. Agent-driven validation uses `agent-browser` CLI; durable scripted suites use Playwright CLI/test runner. | Closure must call out the missing browser coverage and any resulting limitation or inconclusive outcome |

## Routing Boundary

- Validation routes through the consolidated `@test-runner` lane by default; implementation lanes must not bypass that boundary by self-running generic test commands as their validation claim.
- `@test-runner` should select the narrowest required layer first and add layers only when the added
  coverage changes closure confidence for the active risk.
- A direct test command is only acceptable when `@test-runner` uses it as its own narrow execution mechanism.
- Those direct-command exceptions inherit the same timeout controls, scope discipline, evidence capture, and closure-reporting requirements as runner-mediated validation.

## Typical E2E Triggers

E2E is not part of the default proof stack. It is commonly mandatory when one or more of these are
true:

- the change adds a new user-facing flow that lacks durable coverage
- the change affects auth, session state, redirects, or protected navigation
- the change spans UI plus server behavior in a way unit/integration checks cannot fully prove
- the change modifies risky forms, browser workflows, or stateful journeys
- repo policy explicitly requires browser confirmation for the touched surface

## Browser Tooling Split

Instruction Engine intentionally keeps two browser-testing paths separate inside the single testing lane:

### Agent-driven browser validation

- Route: `@test-runner`
- Tool: `agent-browser` CLI selected by the testing lane
- Use for: active coding-session validation, smoke checks, risky browser confirmation, and policy-driven
  E2E coverage during execution
- Execution rule: keep it serial; do not overlap E2E with active write work

### Durable scripted browser suites

- Tool: Playwright CLI/test runner
- Use for: committed regression suites, CI gates, durable repeatable coverage, and project-owned test
  suites
- Do not silently substitute this path for the agent-driven browser path or vice versa

### Not the default path

- Playwright MCP is not the default browser-validation route for Instruction Engine workflows

## Closure Rules

When mandatory validation was required:

- the closure summary must say what was required
- the closure summary must say what actually ran
- the closure summary must say what remains uncovered or limited
- the closure summary should distinguish `not required` broader layers from required-but-unrun gaps
- mandatory requirements without an explicit validation layer or capacity label remain unresolved and
  must be treated as missing mandatory validation
- confidence must reflect the evidence actually available
- if the missing coverage materially affects correctness, the run should pause or close as incomplete
  rather than implying a confident success

## Persistence And Reporting Contract

When a persisted verification guide exists, it should preserve validation reporting using these simple
H2 headings when applicable:

- `Validation Requirements`
- `Tested Coverage`
- `Coverage Gaps`

These headings remain optional for backward compatibility, but when present their entries must be
explicit and machine-derivable:

- each bullet starts with `<layer-or-capacity>:`
- recognized labels include `unit`, `integration`, `e2e`, `browser`, `playwright`, and `manual`
- mandatory unlabeled entries count as unresolved mandatory validation rather than satisfied coverage

Examples:

- `unit: Required because the parser behavior changed.`
- `integration: Not run; API boundary coverage is still missing.`
- `browser: Manual verification did not run in this session.`

`copilot-ui` structured state should expose these additive fields when derivable:

- `meta.intentFrame.validationRequirements`
- `meta.closureSummary.validationRequirements`
- `meta.closureSummary.validationCoverage`
- `meta.closureSummary.coverageGaps`

Existing evidence and limitation fields remain valid and should continue to be used:

- `meta.closureSummary.validationEvidence`
- `meta.closureSummary.limitations`
- `meta.closureSummary.whereToVerify`

For agent-driven E2E results, the validation output must also capture:

- requirement basis
- tool used
- coverage performed
- gaps or limitations
- evidence summary
- `PASS` / `FAIL` / `INCONCLUSIVE`
