---
name: lane-spec
description: "Contract, workflow, API, or user-facing behavior changes. Requires spec-first or spec-anchored workflow. Pro for spec review and implementation plan."
triggers:
  - spec
  - contract
  - api change
  - user-facing
  - workflow change
  - lane spec
---

# Lane: Spec

Contract, workflow, API, or user-facing behavior changes. Requires spec-first or spec-anchored workflow.

## When To Use

- Adding or modifying a public API endpoint
- Changing user-facing behavior or UI flow
- Defining or modifying a cross-module contract
- Workflow automation or orchestration changes
- Any change where behavior should be documented before implementation

## When NOT To Use

- Internal refactoring with no contract change → `lane-standard`
- Exploratory prototyping → `lane-standard`
- Multi-session roadmap work → `lane-project`

## Model Role

- **Implementation:** `small` (DeepSeek V4 Flash)
- **Spec review:** `review` role (defaults to `big`, DeepSeek V4 Pro)
- **Plan review:** `review` role
- **Escalation triggers:**
  - Ambiguity in spec requirements → escalate to `review`
  - Trade-offs between correctness, performance, and maintainability → escalate to `review`
  - Final spec sign-off before implementation starts → always use `review`

## Prerequisites

1. Load `lane-spec` skill
2. Load `spec-dev` skill (for spec-first routing)
3. Load `spec-authoring` skill (for writing durable specs)
4. Load `spec-review` skill (for adversarial spec review)

## Workflow

### Phase 1: Spec

1. **Clarify:** Understand the contract boundary, user-facing behavior, or API surface
2. **Author spec:** Use `spec-authoring` to create or update `specs/<slug>/spec.md`
3. **Review spec:** Use `review` model role + `spec-review` skill for adversarial review
4. **Sign off:** User confirms spec is correct

### Phase 2: Plan

1. Derive implementation plan from spec
2. Review plan with `review` model role
3. Identify test expectations from spec

### Phase 3: Implement

1. Implement against spec in `Build`
2. Validate against spec assertions
3. Run spec validation if a validator exists (e.g., `node scripts/validate-specs.js`)

### Phase 4: Verify

1. Run focused tests covering spec requirements
2. Verify spec document still matches implementation
3. Present diff and spec coverage

## Validation Standard

- Spec validation (if validator exists)
- Tests covering spec-asserted behavior
- Lint and typecheck on changed code
- Manual verification of user-facing behavior if applicable

## Output Contract

At completion:
- **Spec:** `specs/<slug>/spec.md` (linked)
- **Changes:** [file:line references]
- **Tests:** [spec coverage + test results]
- **Review:** [spec review key findings]
- **Next:** [PR, follow-up, or nothing]

## Safety

- Never implement before spec is reviewed and signed off
- Spec and implementation must stay in sync — update spec if implementation reveals issues
- Do not silently deviate from spec; if spec is wrong, propose a spec update first
