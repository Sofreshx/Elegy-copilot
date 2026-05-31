---
name: code-review
description: "Compatibility broad-review entrypoint. Prefer `code-reviewer` for default review, `impl-reviewer` for spec fit, and `working-reviewer` for validation sufficiency. If used, follow the canonical reviewer/testing/validation contracts."
---

# Code Review Skill (Compatibility Entry Point)

This skill exists to preserve older generic "review this" entrypoints. It is not a separate or looser review standard.

## Canonical Routing
- Broad diff or changeset review -> `code-reviewer`
- Implementation vs request/plan/spec fit -> `impl-reviewer`
- Validation sufficiency / "does this actually work?" -> `working-reviewer`

Prefer those canonical lanes for new routing. If this skill is loaded anyway, apply the same contract as `engine-assets/agents/code-reviewer.agent.md`.

## Authority Order
1. `docs/system/reviewer-lane-governance.md`
2. `docs/system/testing-quality-governance.md` when tests or validation evidence changed
3. `docs/system/validation-governance.md` when validation sufficiency or missing coverage matters
4. Other maintained repo guidance
5. Code-local examples as supporting evidence only

## Inputs
- Code to review (file, diff, or PR)
- Relevant repo docs and conventions
- Existing issue notes, session context, or explicitly provided background

## Review Contract
- Keep the review high-signal: defects, regressions, security risks, and convention issues that are strongly supported by the code and repo guidance.
- Treat test edits as findings only when they materially reduce confidence in the changed behavior, such as green-by-weakening, lost hard-case or failure-path coverage, relaxed assertions without replacement coverage, or shallower coverage that mainly makes failures disappear.
- Treat passing tests as evidence, not the goal.
- If mandatory validation is missing or the current evidence is insufficient under `docs/system/validation-governance.md`, call that out explicitly rather than implying confidence.
- If the request is mainly about implementation-vs-spec fit or validation sufficiency, say so explicitly and recommend the sharper reviewer lane.
- Rate each issue 0-100 confidence and only report issues with confidence >= 80.

## Steps
1. Read repo docs, nearby code, and established conventions to understand expected behavior.
2. Determine whether the request should stay in the broad `code-reviewer` lane or be narrowed to `impl-reviewer` / `working-reviewer`.
3. Analyze the relevant changes for correctness, regressions, security, and authoritative convention fit.
4. When tests or validation evidence changed, check whether confidence was preserved under the testing-quality and validation-governance contracts.
5. Report only high-confidence findings that matter; skip low-signal style commentary and speculative concerns.

## Output Contract
- State clearly what was reviewed.
- Group findings by **Critical** and **Important**.
- For each finding, include: **Observed Defect** or **Inferred Risk**, confidence score, file:line reference, canonical reference when relevant, and a concrete fix suggestion.
- If no high-confidence issues exist, provide a brief approval summary.
- Conclude with exactly one status: `APPROVED`, `NEEDS_REVISION`, or `FAILED`.

## Output
- Review summary that follows the canonical `code-reviewer` contract.
- Optional follow-up notes in chat, host/session artifacts, or a user-requested tracking surface.

## Session Summary Format
- **Done**: [review completed]
- **Changes**: [none-review only]
- **New follow-ups**: [issues needing fixes]
- **Risks/notes**: [reviewer-lane, testing-quality, or validation-governance note if relevant]
- **Next**: [reroute to canonical lane, fix issues, or approve]
