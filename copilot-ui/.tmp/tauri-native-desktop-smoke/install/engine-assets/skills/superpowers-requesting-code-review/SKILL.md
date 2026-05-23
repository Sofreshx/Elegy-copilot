---
name: superpowers-requesting-code-review
description: Use when completing tasks, implementing major features, or before merging to verify work meets requirements
---

# Requesting Code Review

Dispatch the canonical reviewer lanes to catch issues before they cascade. Default to `code-reviewer` for broad diff review, add `impl-reviewer` for implementation-vs-plan/spec checks, and add `working-reviewer` when the main question is whether validation still proves the change. The reviewer gets precisely crafted context for evaluation — never your session's history. This keeps the reviewer focused on the work product, not your thought process, and preserves your own context for continued work.

**Core principle:** Review early, review often.

## When to Request Review

**Mandatory:**
- After each task in subagent-driven development
- After completing major feature
- Before merge to main

**Optional but valuable:**
- When stuck (fresh perspective)
- Before refactoring (baseline check)
- After fixing complex bug

## How to Request

**1. Get git SHAs:**
```bash
BASE_SHA=$(git rev-parse HEAD~1)  # or origin/main
HEAD_SHA=$(git rev-parse HEAD)
```

**2. Dispatch the right reviewer lane:**

Use the Task tool with:

- `code-reviewer` for the default broad review path
- `impl-reviewer` when you need an explicit check against the plan, task, or acceptance criteria
- `working-reviewer` when you need to judge whether existing validation evidence still proves the change works

Use the template at `code-reviewer.md` for the broad `code-reviewer` pass, then reuse the same git range and requirements context for any narrower follow-up lane.

Legacy note: if an older workflow still invokes `superpowers-code-reviewer`, treat it as a compatibility alias only. It must follow the same testing-quality expectations as `code-reviewer` and does not bypass `docs/system/testing-quality-governance.md`.

**Placeholders:**
- `{WHAT_WAS_IMPLEMENTED}` - What you just built
- `{PLAN_OR_REQUIREMENTS}` - What it should do
- `{VALIDATION_EVIDENCE}` - Dedicated validation-runner output or a concise evidence summary
- `{BASE_SHA}` - Starting commit
- `{HEAD_SHA}` - Ending commit
- `{DESCRIPTION}` - Brief summary

**3. Act on feedback:**
- Fix Critical issues immediately
- Fix Important issues before proceeding
- Note Minor issues for later
- Push back if reviewer is wrong (with reasoning)
- If tests changed, do not accept green output alone when assertions, hard cases, or failure paths became weaker without replacement coverage

## Example

```
[Just completed Task 2: Add verification function]

You: Let me request code review before proceeding.

BASE_SHA=$(git log --oneline | grep "Task 1" | head -1 | awk '{print $1}')
HEAD_SHA=$(git rev-parse HEAD)

[Dispatch code-reviewer subagent]
  WHAT_WAS_IMPLEMENTED: Verification and repair functions for conversation index
  PLAN_OR_REQUIREMENTS: Task 2 from docs/superpowers/plans/deployment-plan.md
  VALIDATION_EVIDENCE: unit runner output for recovery tests (5/5 passing) plus smoke-check summary
  BASE_SHA: a7981ec
  HEAD_SHA: 3df7661
  DESCRIPTION: Added verifyIndex() and repairIndex() with 4 issue types

[Subagent returns]:
  Evidence reviewed: unit runner output for recovery tests (5/5 passing) plus smoke-check summary
  Important: Missing progress indicators
  NEEDS_REVISION

You: [Fix progress indicators]
[Continue to Task 3]
```

## Integration with Workflows

**Subagent-Driven Development:**
- Review after EACH task
- Catch issues before they compound
- Fix before moving to next task

**Executing Plans:**
- Review after each batch (3 tasks)
- Get feedback, apply, continue

**Ad-Hoc Development:**
- Review before merge
- Review when stuck

## Red Flags

**Never:**
- Skip review because "it's simple"
- Ignore Critical issues
- Proceed with unfixed Important issues
- Argue with valid technical feedback
- Treat weaker-but-green tests as acceptable without equivalent replacement coverage

**If reviewer wrong:**
- Push back with technical reasoning
- Show code/tests that prove it works
- Request clarification

See template at: requesting-code-review/code-reviewer.md
