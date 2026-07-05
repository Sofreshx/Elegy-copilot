---
name: rubberduck-plan-review
description: "Adversarial Rubberduck plan review. Use before implementing complex plans, migrations, refactors, repo setup changes, or architectural decisions; also use when the user asks to rubberduck, critique, challenge, stress-test, or review a plan."
license: Apache-2.0
---

# Rubberduck Plan Review

## Purpose

Stress-test a plan before edits begin. Preserve momentum, but make weak assumptions visible early.

## Inputs

- User goal and constraints.
- Proposed plan or inferred next steps.
- Relevant repo instructions, docs, and code evidence.
- Known validation commands or acceptance criteria.

## Review Steps

1. Restate the plan in one compact paragraph.
2. Identify assumptions that are not yet proven by repo evidence.
3. Check whether the plan is the smallest safe change that satisfies the goal.
4. Look for missing sequencing, rollback, migration, compatibility, permission, or validation steps.
5. Check whether the plan narrowed candidate constraints to the minimum hard set needed for the active slice instead of forwarding a noisy rule dump.
6. Check whether any key architectural, trust-boundary, workflow-authority, or long-lived contract decision should be captured in an ADR rather than only in the plan.
7. Challenge whether any proposed new abstraction, agent, skill, script, dependency, or doc surface is actually needed.
8. For non-trivial behavior, ask which edge input, invalid state, ordering/timing, or dependency
   failure would most likely invalidate the plan's success claim.
9. Decide whether the plan is ready, needs a small edit, or needs user clarification before implementation.

## Output Contract

Use this format:

```text
RUBBERDUCK_PLAN_REVIEW
- verdict: ready | revise | blocked
- strongest_part:
  - <what is sound>
- risks:
  - <high-signal risk or none>
- uncertainty:
  - missing_context: <biggest thing that may be missing or none>
  - least_confident: <least confident point or none>
- plan_edits:
  - <specific edit or none>
- adr_follow_up:
  - <needed adr or none>
- clarification_needed:
  - <question or none>
- validation_required:
  - <command/evidence or none>
```

Keep findings concrete. Do not turn the review into a full alternate plan unless the current plan is unsafe or materially incomplete.
