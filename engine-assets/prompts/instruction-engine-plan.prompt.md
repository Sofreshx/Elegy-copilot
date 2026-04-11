---
name: instruction-engine-plan
description: Create an implementation plan (with risks + validation) and use the environment-appropriate review path before coding.
---

Create a concrete implementation plan for the task I’m asking about.

Before proceeding, apply `core-guardrails` safety constraints (especially terminal/background-process rules).

Requirements:
- Include: goals, assumptions, explicit scope boundaries, phased steps, risks, validation, and rollback.
- Add an explicit **High-Level Goals** bullet list for intended outcomes before decomposition.
- Use canonical goal completion wording only: `complete`, `partial`, `not-complete` (default new planning goals to `not-complete`).
- Keep the plan actionable (file-level where possible).
- Do not write code yet.

Then choose the review path that matches the runtime:
- **Copilot CLI**: rely on Rubber Duck for the secondary-model challenge. Do not manually invoke reviewer agents.
- **VS Code / other environments**: request plan review from BOTH:
  - @reviewer-opus-4-6
  - @reviewer-gpt-5-4

Manual review loop rules (non-CLI path):
- Reviewers MUST return a strict line: `Verdict: APPROVED | NEEDS_REVISION | BLOCKED`.
- Revise the plan until both reviewers return `Verdict: APPROVED`.
- If a reviewer returns `Verdict: BLOCKED`, use `vscode/askQuestions` to ask the smallest set of clarifying questions needed to unblock, then revise.
- If the plan is not 100% confident (missing info, tradeoffs, risky assumptions), use `vscode/askQuestions` to ask whether to proceed anyway rather than falling back to a plain-text end-of-plan question.
