---
spec_id: reviewer-lane-contract
title: Reviewer Lane Contract
status: draft
type: contract
updated: 2026-06-20
---

# Reviewer Lane Contract

## Intent

Define the authoritative contract for the reviewer lane: review checks, verdict rules, review gates, and output contracts. Every reviewer agent and review skill MUST conform to this contract.

## Context Evidence

- `docs/system/reviewer-lane-governance.md` — currently the canonical doc for reviewer lane governance. This spec will become the normative authority.
- `opencode-assets/agents/reviewer.md` — reviewer agent instructions, references spec-review mode.
- `opencode-assets/agents/impl-pro.md` — references review gates in implementation workflow.
- `catalog-assets/shared-skills/implementation-review/SKILL.md` — implementation review skill.
- `catalog-assets/shared-skills/spec-review/SKILL.md` — spec review skill (already references the normative spec-driven-development-contract).
- `catalog-assets/shared-skills/rubberduck-plan-review/SKILL.md` — adversarial plan review skill.
- `engine-assets/skills/security/SKILL.md` — focused security review skill.
- No existing `docs/specs/` artifact defines the reviewer lane contract normatively.

## Requirements

### Allowed Behavior

#### R1 — Reviewer Roles

- R1.1: The reviewer lane is a read-only review surface. Reviewers MUST NOT edit files.
- R1.2: Reviewer sub-types: `spec-review` (specs), `implementation-review` (code/docs/skills/config), `plan-review` (plans/roadmaps), `security-review` (vulnerabilities).
- R1.3: Reviewers MUST be invoked by lane primary agents (project, quick) via delegation, not directly by users.

#### R2 — Review Check Structure

- R2.1: Every review MUST check: correctness (matches intent), scope (within stated bounds), drift (no instruction/content drift), and evidence (validation artifacts present).
- R2.2: Additional domain-specific checks depend on review type:
  - **Spec review**: 16 checks per spec-review skill (conformance to normative spec contract, intent match, evidence strength, acceptance checks, cross-spec integrity, ADR promotion).
  - **Implementation review**: code quality, spec-fit, regression risk, validation sufficiency.
  - **Plan review**: feasibility, dependency ordering, risk coverage, effort estimation.
  - **Security review**: secrets in git, auth bypass, dependency confusion, path traversal, cookie security, IDOR.

#### R3 — Verdict Rules

- R3.1: Every review MUST produce one of three verdicts:
  - `pass`: ready to proceed. No blocking issues.
  - `revise`: useful but needs changes before proceeding.
  - `blocked`: critical evidence missing or unresolved contradictions make proceeding unsafe.
- R3.2: Reviewers MUST lead with defects — list failures before successes.

#### R4 — Output Contract

- R4.1: Every review MUST produce structured output in a consistent format.
- R4.2: The output format varies by review type but MUST include: verdict, gaps found, required revisions, and follow-up work.
- R4.3: Output blocks MUST use the designated format for that review type (e.g., `SPEC_REVIEW`, `IMPLEMENTATION_REVIEW`, `PLAN_REVIEW`, `SECURITY_REVIEW`).

#### R5 — Review Evidence

- R5.1: Review verdicts MUST cite evidence: specific file paths, line numbers, doc references, or validation outputs.
- R5.2: Reviewers MUST NOT produce verdicts based on assumptions without evidence.

#### R6 — Review Gates in Workflow

- R6.1: The project lane and quick lane MUST enforce review gates before completing work.
- R6.2: Review gates trigger at defined phase boundaries (post-implementation, pre-handoff).
- R6.3: A `blocked` verdict MUST prevent the lane from completing the current work point.

### Forbidden Behavior

- A reviewer MUST NOT edit any file in the workspace.
- A reviewer MUST NOT produce a `pass` verdict when blocking issues are present.
- A reviewer MUST NOT produce a verdict without citing evidence (file paths, line numbers, etc.).
- A reviewer MUST NOT be invoked without a clear review scope and domain.

## Non-Goals

- Defining specific review check content for each domain — check details are in domain-specific review skills.
- Defining how review skills are loaded or routed — that belongs to skills governance and agent routing.
- Defining review tooling or automation beyond the output contract.
- Defining CI-based automated review — that is operational infrastructure, not contract.

## Acceptance Checks

- The spec itself passes spec validation
  → verify: run spec validator against this file
- All 6 requirements with sub-requirements are present
  → verify: count `#### R[1-6]` headings — at least 6
- Forbidden Behavior covers at least 3 prohibitions
  → verify: count `MUST NOT` prohibitions — at least 3
- Reviewer governance doc references this spec
  → verify: search for `reviewer-lane-contract` in the governance doc

## Implementation Links

- `docs/specs/reviewer-lane-contract/spec.md` — this file
- `docs/system/reviewer-lane-governance.md` — thinned to reference this spec
- `opencode-assets/agents/reviewer.md` — reviewer agent instructions
- `catalog-assets/shared-skills/spec-review/SKILL.md` — spec review skill
- `catalog-assets/shared-skills/implementation-review/SKILL.md` — implementation review skill

## Validation Evidence

- Pending implementation.

## Drift Notes

- None yet.
