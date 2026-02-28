---
name: instruction-engine-plan
description: Create an implementation plan (with risks + validation) and require cross-model review approvals before coding.
---

Create a concrete implementation plan for the task I’m asking about.

Before proceeding, apply `core-guardrails` safety constraints (especially terminal/background-process rules).

Requirements:
- Include: goals, assumptions, explicit scope boundaries, phased steps, risks, validation, and rollback.
- Keep the plan actionable (file-level where possible).
- Do not write code yet.

Then request plan review from BOTH:
- @reviewer-opus-4-6
- @reviewer-gpt-5-3-codex

Review loop rules:
- Reviewers MUST return a strict line: `Verdict: APPROVED | NEEDS_REVISION | BLOCKED`.
- Revise the plan until both reviewers return `Verdict: APPROVED`.
- If a reviewer returns `Verdict: BLOCKED`, ask the user the smallest set of clarifying questions (batch via `vscode/askQuestions`) to unblock — then revise.
- If the plan is not 100% confident (missing info, tradeoffs, risky assumptions), ask the user whether to proceed anyway, rather than looping forever.
