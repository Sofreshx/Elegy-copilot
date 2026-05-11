---
name: rubberduck-plan-review
description: "Adversarial Rubberduck plan review for OpenCode. Use before implementing complex plans, migrations, refactors, repo setup changes, or architectural decisions; also use when the user asks to rubberduck, critique, challenge, stress-test, or review a plan."
---

# Rubberduck Plan Review

## Purpose

Stress-test a plan before edits begin. Preserve momentum, but make weak assumptions visible early.

## When to Use

- Complex plans that touch multiple files, systems, or steps.
- Migrations, refactors, repo setup changes, or architectural decisions.
- When the user explicitly asks to rubberduck, critique, challenge, or stress-test a plan.
- Before committing to new abstractions, agents, skills, scripts, or dependencies.

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
5. Challenge whether any proposed new abstraction, agent, skill, script, dependency, or doc surface is actually needed.
6. Decide whether the plan is ready, needs a small edit, or needs user clarification before implementation.

## Output Contract

Use this format:

```text
RUBBERDUCK_PLAN_REVIEW
- verdict: ready | revise | blocked
- strongest_part:
  - <what is sound>
- risks:
  - <high-signal risk or none>
- plan_edits:
  - <specific edit or none>
- clarification_needed:
  - <question or none>
- validation_required:
  - <command/evidence or none>
```

Keep findings concrete. Do not turn the review into a full alternate plan unless the current plan is unsafe or materially incomplete.
