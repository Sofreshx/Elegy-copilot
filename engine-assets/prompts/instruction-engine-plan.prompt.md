---
name: instruction-engine-plan
description: Create an implementation plan (with risks + validation) and use the environment-appropriate review path before coding.
---

Create a concrete implementation plan for the task I’m asking about.

Before proceeding, apply `core-guardrails` safety constraints (especially terminal/background-process rules).
Anchor planning and review behavior in `docs/system/calibrated-questioning-and-depth-governance.md`, `docs/system/planning-backlog-roadmap-contract.md`, `docs/system/search-execute-workflow.md`, `docs/system/planpack-spec.md`, and `docs/system/reviewer-lane-governance.md`.

Requirements:
- Include: goals, assumptions, explicit scope boundaries, phased steps, risks, validation, and rollback.
- Add an explicit **High-Level Goals** bullet list for intended outcomes before decomposition.
- Use canonical goal completion wording only: `complete`, `partial`, `not-complete` (default new planning goals to `not-complete`).
- Narrow candidate constraints to the minimum hard constraints needed for the active plan and keep open questions separate.
- If the plan introduces a key architectural, workflow-authority, trust-boundary, or long-lived contract decision, call out ADR follow-up explicitly.
- Keep the plan actionable (file-level where possible).
- Do not write code yet.

Then choose the review path that matches the runtime:
- **Copilot CLI**: rely on Rubber Duck for the secondary-model challenge. Do not manually invoke reviewer agents.
- **VS Code / other environments**: request plan review from BOTH:
  - @reviewer-sonnet-4-6
  - @reviewer-gpt-5-4

Manual review loop rules (non-CLI path):
- Reviewers MUST return a strict line: `Verdict: APPROVED | NEEDS_REVISION | BLOCKED`.
- Revise the plan until both reviewers return `Verdict: APPROVED`.
- Before asking the user, apply the calibrated ladder: answer from canonical docs or repo evidence when deterministic; carry a recommended assumption when strong evidence makes the remaining branch non-outcome-changing; ask only for the smallest set of outcome-changing unknowns.
- If a reviewer returns `Verdict: BLOCKED`, use `vscode/askQuestions` only for the smallest set of clarifying questions needed to unblock when the unresolved branch materially changes scope, architecture, validation, or plan safety, then revise.
- Complexity alone does not justify a question barrage.
- Use `vscode/askQuestions` rather than a plain-text end-of-plan question when a blocking clarification or explicit proceed-anyway decision is still required.
