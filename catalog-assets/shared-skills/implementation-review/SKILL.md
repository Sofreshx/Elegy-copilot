---
name: implementation-review
description: "Implementation review for code, docs, skills, agents, and configuration changes. Use after edits when checking correctness, scope, regressions, and validation sufficiency before handoff."
---

# Implementation Review

## Purpose

Review completed edits for correctness, scope, regressions, and validation sufficiency before handoff.

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
  - <issue with file/line if available, or none>
- scope_check:
  - <matches request | scope drift>
- validation:
  - <evidence or gap>
- handoff_notes:
  - <remaining risk or none>
```

Lead with defects. Skip style-only comments unless they hide correctness or maintainability risk.
