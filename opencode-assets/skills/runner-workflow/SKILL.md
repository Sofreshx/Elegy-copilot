---
name: runner-workflow
description: "Runner lane workflow reference. Load at the start of a runner session for the full phase-by-phase execution guide: parse, review, execute, complete."
triggers:
  - runner workflow
  - runner phase
  - text plan execution
---

# Runner Workflow Reference

Phase-by-phase execution guide for `runner` and `runner-flash` lanes.

## Autonomous Continuation Policy

Continue without re-confirmation for:
- Task execution within the plan
- Validation retries
- Moving to the next authorized task

The user's prior authorization of the plan is permission to keep going.

**Git checkpoint policy:**
- `git commit` — propose diff summary and wait for approval unless this runner
  session is explicitly operating under an approved goal or durable planning
  run
- `git merge` — propose merge; wait for approval
- `git push` — never push without explicit request
- `worktree_delete` with pending changes — ask user

Pause for user input only when:
- A clarification would change scope, architecture, or acceptance criteria
- Blocking issue (review verdict: blocked, or changes-requested after 2 retries, validation failure with no obvious fix)
- All tasks complete — present summary, ask for next steps
- User explicitly asked to pause

## Phase 0: Accept & Parse

1. Receive plan text from user's prompt. Treat it as ready.
2. Parse into discrete tasks for execution delegation. Each task should have:
   - Title (short, descriptive)
   - Description (what to do, why)
   - File scope (specific files or globs)
   - Validation (command to verify correctness)
   - Dependencies (which tasks must complete first)
3. Present the parsed task list to the user.
4. Ask: "Review this plan before implementing, or proceed directly?"
5. If a task boundary is ambiguous when delegating, ask one clarifying question.
   If still ambiguous → `needs-reroute`.

## Phase 1: Plan Review (optional, user-gated)

1. Only invoke if the user explicitly requests plan review.
2. Delegate to `reviewer` (plan-review mode).
3. Load `rubberduck-plan-review` skill.
4. Provide the parsed task list with file scopes and dependencies.
5. Reviewer checks: feasibility, risk, ordering, dependency correctness,
   missing steps, task separation, scope overlap.
6. Address blocking findings, then proceed to execution.

## Phase 2: Execute

For each task in dependency order:

1. **Discovery** (if code area is unfamiliar):
   - Delegate to `explorer` with file scope and task description.
   - Use findings to refine the implementation brief.

2. **Implementation**:
   - Delegate to `impl-pro` (runner) or `impl` (runner-flash).
   - Provide a structured brief:
     ```
     TASK: <title>
     FILES: <exact paths>
     DO: <specific actions>
     DON'T: <anti-patterns to avoid>
     VERIFY:
       - [ ] <validation> → expected: pass
     ```
   - Impl must complete its Pre-Submission Checklist before returning `done`:
     validation gate, diff inspection, scope check.
   - Review `IMPL_RESULT`. If blocked or needs-clarification, escalate.

3. **Code Review** (per task):
   - Delegate to `reviewer` (code-review mode) with changed files.

4. **Review Verdict Handling**:
   | Verdict | Action |
   |---|---|
   | `approved` | Proceed to next task |
   | `changes-requested` | Re-delegate to impl with findings as explicit fix list. Max **2 retries**. After 2 retries, escalate to user. |
   | `blocked` | Escalate to user immediately. Do not retry. |

5. **Fix retry** (on `changes-requested`):
   - Pass reviewer findings as a numbered fix checklist to impl.
   - Impl must address each finding and report resolution status per finding.
   - After impl returns, re-submit to reviewer.
   - Track retry count per task.

## Phase 3: Complete

1. Run full validation (all tests, typecheck, lint).
2. Delegate to `reviewer` (evidence-review mode):
   - Verify all tasks have code review verdicts.
   - Verify validation covers stated expectations.
3. Present diff summary. Stage intended files.
4. Commit only with explicit user approval, unless this runner session is
   explicitly operating under an approved goal or durable planning run and the
   diff is a validated atomic checkpoint.
5. Clean up worktree if one was created.
6. If more tasks remain, advance without confirmation.

## Output Contract

Runner lane uses `RUNNER_RESULT`. Runner-flash uses `RUNNER_FLASH_RESULT`.

```
RUNNER_RESULT
- status: done|needs-reroute|blocked
- tasks: <N completed, M remaining>
- changes: <file:line, commit SHA if committed>
- evidence:
  - review: <plan review verdict or skipped, per-task code review, evidence review outcomes>
  - validation: <command + result summary>
  - issues: <blocking or notable issues encountered>
- next: <next task title or done>
```
