---
name: instruction-engine-review
description: Compatibility broad-review entrypoint for /diff + /review. Route through the canonical code-reviewer contract and current testing/validation governance.
---

Review the current changeset before commit.

Before proceeding, apply `core-guardrails` safety constraints (especially terminal/background-process rules).

This prompt is a compatibility entrypoint, not a separate or looser review path. Treat broad review requests as the canonical `code-reviewer` lane and anchor on:

- `engine-assets/agents/code-reviewer.agent.md`
- `docs/system/calibrated-questioning-and-depth-governance.md`
- `docs/system/reviewer-lane-governance.md`
- `docs/system/testing-quality-governance.md`
- `docs/system/validation-governance.md`

Canonical routing:
- Broad review of a diff or changeset -> `code-reviewer`
- "Did this match the request/plan/spec?" -> `impl-reviewer`
- "Does the validation still prove this works?" -> `working-reviewer`

Review contract:
- Report only high-confidence, high-signal issues with file:line references and canonical citations when relevant.
- Challenge the strongest assumptions and missing evidence first, but escalate open questions only when they materially affect the verdict or a required revision.
- Treat passing tests as evidence, not the goal.
- Flag test changes only when they materially reduce confidence, including green-by-weakening, lost hard-case or failure-path coverage, relaxed assertions without replacement coverage, or shallow coverage that mainly makes failures disappear.
- If mandatory validation is missing, bypassed, or no longer sufficient under current governance, call the gap out explicitly rather than implying confidence.
- Avoid speculative concerns, generic style nits, or low-value noise.
- Preserve the standard review checks for correctness, scope, safety, and compatibility.

Use `/diff` and `/review` style output: summarize only real issues, give a concise ready-to-merge verdict, and conclude with exactly one status: `APPROVED`, `NEEDS_REVISION`, or `FAILED`.
