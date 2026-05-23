---
name: superpowers-executing-plans
description: Use when you have a written implementation plan to execute in a separate session with review checkpoints
---

# Executing Plans

## Overview

Load plan, review critically, execute all tasks, route validation through the proper validation lane, and report when complete.

**Announce at start:** "I'm using the executing-plans skill to implement this plan."

**Note:** Tell your human partner that Superpowers works much better with access to subagents. The quality of its work will be significantly higher if run on a platform with subagent support (such as Claude Code or Codex). If subagents are available, use superpowers-subagent-driven-development instead of this skill.

## The Process

### Step 1: Load and Review Plan

1. Read plan file
2. Review critically - identify any questions or concerns about the plan
3. If concerns: Raise them with your human partner before starting
4. If no concerns: Create TodoWrite and proceed

### Step 2: Execute Tasks

For each task:

1. Mark as in_progress
2. Follow each step exactly (plan has bite-sized steps)
3. Determine the narrowest required validation layer using `docs/system/validation-governance.md`
4. Route that validation through the dedicated validation coordinator/runner flow and inspect the runner lane's returned evidence
5. If tests changed, apply `docs/system/testing-quality-governance.md` before treating the result as sufficient evidence
6. Mark as completed only when the required validation evidence is acceptable, or when any explicit gap/limitation is carried forward as unresolved

**Important:** Do not treat a raw generic test command run from the execution/controller lane plus green output as enough to close a task or the overall plan. A direct test command only counts when it is the validation lane's own narrow execution path and the returned evidence is consumed as such.

### Step 3: Complete Development

After all tasks complete and required validation coverage is explicit:

- Announce: "I'm using the finishing-a-development-branch skill to complete this work."
- **REQUIRED SUB-SKILL:** Use superpowers-finishing-a-development-branch
- Hand that skill the validation requirements, dedicated validation evidence, and any coverage gaps/limitations
- Follow that skill to present options, execute choice, and keep closure aligned with validation governance

## When to Stop and Ask for Help

**STOP executing immediately when:**

- Hit a blocker (missing dependency, test fails, instruction unclear)
- Plan has critical gaps preventing starting
- You don't understand an instruction
- Verification fails repeatedly
- Required validation cannot be routed through the appropriate coordinator/runner flow to obtain runner evidence

**Ask for clarification rather than guessing.**

## When to Revisit Earlier Steps

**Return to Review (Step 1) when:**

- Partner updates the plan based on your feedback
- Fundamental approach needs rethinking

**Don't force through blockers** - stop and ask.

## Remember

- Review plan critically first
- Follow plan steps exactly
- Don't skip verifications
- Keep validation lane boundaries intact
- Passing tests are evidence, not the objective
- Reference skills when plan says to
- Stop when blocked, don't guess
- Never start implementation on main/master branch without explicit user consent

## Integration

**Required workflow skills:**

- **superpowers-using-git-worktrees** - REQUIRED: Set up isolated workspace before starting
- **superpowers-writing-plans** - Creates the plan this skill executes
- **superpowers-finishing-a-development-branch** - Complete development after all tasks
