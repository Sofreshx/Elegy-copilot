---
name: implementation-review
description: "Implementation review for code, docs, skills, agents, and configuration changes. Use after edits when checking correctness, scope, regressions, and validation sufficiency before handoff."
---

# Implementation Review

## Inputs

- User request and any accepted plan.
- Current diff or touched files.
- Applicable `AGENTS.md`, repo docs, and nearby code patterns.
- Validation output or an explicit reason validation was skipped.

## Review Steps

1. Compare the diff against the user request and plan.
2. Check for behavioral regressions, data loss, security issues, broken contracts, stale docs, and accidental broadening.
3. Check tests and validation evidence. Passing tests are evidence, not proof.
4. Look for user changes in the worktree and confirm the implementation did not overwrite or revert them.
5. Verify new instructions or skills are concise, scoped, and not duplicating what the runtime can already handle directly.
6. Check ADR posture: missing ADR coverage for a key architectural or workflow-authority decision is a real finding, while ADRs for purely local choices are also drift.
7. Decide whether the work can be handed off or needs revision.

## Output Contract

Use this format:

```text
IMPLEMENTATION_REVIEW
- verdict: pass | revise | blocked
- findings:
  - [severity: critical|high|medium|low] <file:line> — <description>
  - [severity: critical|high|medium|low] <file:line> — <description>
  - (repeat for each finding, or "none" if clean)
- scope_check:
  - matches request | scope drift: <drift description>
- validation:
  - evidence: <what was validated and how>
  - gap: <what was not validated and why>
- handoff_notes:
  - <remaining risk, follow-up items, or none>
```

### Finding Severity

- **critical**: Data loss, security breach, broken auth, unrecoverable state. Blocks handoff.
- **high**: Behavioral regression, broken contract, missing validation for changed behavior. Requires revision.
- **medium**: Stale docs, missing test for edge case, accidental broadening. Should fix before merge.
- **low**: Naming drift, minor style hiding maintainability risk, optional cleanup. Fix if time allows.

### Rules

- Lead with defects. List critical/high findings first.
- Skip style-only comments unless they hide correctness or maintainability risk.
- Every finding must reference a file and line when available.
- If findings exist, verdict must be `revise` (or `blocked` for critical).
- A `pass` verdict requires `findings: none`.
