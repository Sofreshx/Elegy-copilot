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

**Explicit approval required before ANY durable git mutation:**
- `git commit` — propose diff summary; wait for approval
- `git merge` — propose merge; wait for approval
- `git push` — never push without explicit request
- `worktree_delete` with pending changes — ask user

Pause for user input only when:
- A clarification would change scope, architecture, or acceptance criteria
- Blocking issue (review verdict: blocked, or changes-requested after 2 retries, validation failure with no obvious fix)
- All tasks complete — present summary, ask for next steps
- User explicitly asked to pause

## Phase 0: Parse

1. Receive plan text from user's prompt.
2. Parse into discrete tasks. Each task must have:
   - Title (short, descriptive)
   - Description (what to do, why)
   - File scope (specific files or globs)
   - Validation (command to verify correctness)
   - Dependencies (which tasks must complete first)
3. If plan lacks any required field, ask one clarifying question.
4. If still ambiguous → `needs-reroute`.

### Plan Quality Checks
- No overlapping file scopes between parallel tasks
- No circular dependencies
- Every task has explicit validation
- File scopes are specific, not `src/**` or the whole repo
- Task descriptions are concrete, not vague ("improve code" → reject)

## Phase 1: Plan Review

1. Delegate to `reviewer` (plan-review mode).
2. Load `rubberduck-plan-review` skill.
3. Provide the parsed task list with file scopes and dependencies.
4. Reviewer checks: feasibility, risk, ordering, dependency correctness,
   missing steps, task separation, scope overlap.
5. Blocked → fix issues. Approved → proceed.

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
4. Commit only with explicit user approval.
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
  - review: <plan review, per-task code review, evidence review outcomes>
  - validation: <command + result summary>
  - issues: <blocking or notable issues encountered>
- next: <next task title or done>
```
