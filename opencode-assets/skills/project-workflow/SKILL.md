---
name: project-workflow
description: "Project lane workflow reference. Load at the start of a project session to get the full phase-by-phase execution guide: setup, plan, execute, complete. Covers elegy-planning lifecycle, worktree management, evidence chains, and review gates."
triggers:
  - project workflow
  - project phase
  - project lane
  - roadmap workflow
  - elegy-planning workflow
---

# Project Workflow Reference

This skill provides the full phase-by-phase workflow for the project lane.
Load it when the project lane agent begins a session or when it needs the
complete execution guide.

## Autonomous Continuation Policy

The project lane may continue without re-confirmation for:
- Exploration of codebases
- Implementation steps within a work point
- Validation retries
- Moving to the next already-authorized work point in the plan

The user's prior authorization of the goal, roadmap, and plan is the permission
to keep going within these bounds.

**Git checkpoint policy:**
- `git commit` — auto-commit validated atomic work-unit checkpoints inside the
  approved goal/roadmap/plan scope
- non-goal or out-of-scope commits — propose the commit with a diff summary and
  wait for user approval
- `git merge` — propose the merge; wait for approval
- `git branch -d` — confirm with user before deleting
- `git push` — never push without explicit user request
- `worktree_delete` with pending changes — if the worktree is clean, deletion
  is automatic at session end. If pending changes exist, ask the user.

Follow the evidence-bound questioning ladder: answer from evidence, carry a
recommended assumption, or ask the user — in that order.

Pause for user input only when one of these is true:
- A clarification would change scope, architecture, or acceptance criteria and
  cannot be inferred from evidence
- A blocking issue was discovered (plan/work point status: blocked, validation
  failure with no obvious fix, missing input only the user can supply,
  destructive operation needed, or unresolved review verdict: blocked)
- The full roadmap is complete — present the validation summary and ask the user
  about next steps
- The user explicitly asked to pause

Keep questions focused and concrete; prefer one blocking question over a
questionnaire.

## Phase 0: Setup

1. Load `planning-tools` skill
2. Run `planning_health()` — confirm DB is initialized
3. Confirm goal and roadmap exist: `planning_goal_list()`,
   `planning_roadmap_show(roadmapId: "<id>")`
4. If no roadmap exists, create one via `planning_roadmap_create`
5. **Accept spec handoff:** If this project was handed an approved spec,
   confirm the `exact:primary:docs/specs/<spec-slug>/spec.md` file-scope
   selector is present on the work point. Record the handoff acceptance:
   `planning_insight_record(insightType: 'spec-link', entityType: 'plan',
   entityId: '<plan-id>', content: 'Accepted handoff from spec
   docs/specs/<slug>/spec.md')`.

## Phase 1: Plan

1. **Suggest:** Find the next runnable work point:
   `planning_work_point_next_runnable()`. Inspect work points, respecting
   dependency ordering.
2. **Announce:** State the candidate work point — title, description,
   dependencies (and their status), expected validation — and proceed.
3. **Plan:** Create a plan for the work point:
   `planning_plan_create(id: "<id>", roadmapId: "<id>", title: "...",
   effortTier: "balanced")`
4. **Worktree:** Load `worktree` skill. Create a dedicated project worktree
   using `worktree_create` with appropriate branch name from the plan ID.
   One worktree is created per project session and reused across work points.

## Phase 2: Execute

0. **Claim lease:**
   `planning_project_run_claim(goalId, roadmapId, workPointId, repo, branch,
   worktree, session, profile)`
1. **Plan review** (optional, user-gated): Ask user: "Review this plan before implementing, or proceed directly?" If user requests review, load
   `rubberduck-plan-review` and delegate to `reviewer` for plan review before
   starting. Otherwise skip to implementation.
2. **Implement:** Delegate to `impl` in the worktree. Pass clear, bounded
   work unit descriptions. Review results between implementation steps.
2a. **Activate run:**
    `planning_project_run_activate(runId, worktreePath)`
3. **Validate:** Ensure validation expectations defined in the plan are
   executed.
4. **Record evidence for ALL review gates (mandatory before completion):**
    - Plan review (only if performed): `planning_review_point_record(entityType: "plan",
      entityId: "<id>", decision: "approved|blocked|needs-changes",
      rationale: "...")`
    - Implementation review: same pattern
    - Evidence review: same pattern
5. **Record findings and concerns (mandatory before completion):**
   - Issues: `planning_issue_record(entityType: "plan", entityId: "<id>",
     title: "...", description: "...")`
   - Worries: same with `[WORRY]` prefix, severity: "low"
   - Insights: `planning_insight_record(insightType: 'observation',
     entityType: "plan", entityId: "<id>", content: "...")`
6. **Record validation summary (mandatory before completion):**
   - `planning_project_run_add_evidence(runId, evidenceType:
     "validation-summary", content: "...")`
7. **Record missed objectives:**
   - `planning_issue_record(entityType: "plan", entityId: "<id>",
     title: "[MISSED] ...", description: "...:reason", severity: "medium")`
8. **Record run evidence:** Append immutable evidence to the project run.
9. **Review:** Delegate to `reviewer`. Load `implementation-review` skill.
   Reviewer checks: correctness, spec-fit, quality, test coverage.
10. **Evidence review:** Delegate to `reviewer`. Review the full evidence
    chain. If any mandatory evidence is missing, the plan is NOT complete.
    Return to the missing step.

## Phase 3: Complete

1. **Commit checkpoint:** Ask `impl` for a diff summary. Stage intended
   session-owned files only. If validation passed and the diff is atomic inside
   the approved goal/roadmap/plan scope, run `git commit` and record the SHA as
   project-run evidence. If the diff is mixed, validation failed, or scope is
   unclear, pause with the diff summary instead of committing.
2. **Merge back:** Propose merging the topic branch into the user's active
   branch. Present the merge summary and wait for explicit user approval.
3. **Update plan:**
   `planning_plan_update_status(planId: "<id>", status: "completed")`
3a. **Release lease:**
    `planning_project_run_release(runId: "<id>")`
4. **Clean up:** Remove the worktree at session end using `worktree_delete`.
   The worktree_reuse pattern applies: create once per session, reuse across
   work points, delete once at end.
5. **Validate:** Run `planning_validate()` before marking work done.
6. **Proceed to next:** Advance to the next runnable work point without
   confirmation. Pause only if blocked, ambiguous, or out of work.

## Validation Standard

Full evidence chain required per plan:
- Validation expectations defined in plan metadata
- Implementation run refs (what was attempted)
- Warning/question records (ambiguities found during work)
- Validation finding refs (test/lint/typecheck results)
- Review point ref (gate review outcome)
- Commit SHA (if committed)
- Run `planning_validate()` before marking plan complete

## Reevaluation Policy

### Cheap frequent checks (run per edit or per implementation step)
- `planning_health()` — confirms DB is initialized and reachable
- Lint for changed files only: `npx eslint <changed-file>`
- Focused unit tests: `npx vitest run <test-file>`
- Narrow type check: `npx tsc --noEmit <changed-file>.ts`
- Do NOT rerun the full test suite or full typecheck on every small edit.

### Session-boundary validation (run once per plan, before marking complete)
- Full test suite: `npm run test:all` or `npm run ci:local`
- Full typecheck: `npx tsc --noEmit`
- Referential integrity: `planning_validate()`
- Evidence review gate (step 10 in Phase 2)

### Handling pre-existing `planning_validate()` findings
- Focus on findings that reference the current plan/work point/goal ID
- Do NOT block plan completion on pre-existing findings from unrelated scopes
- Record a tracked schema issue via `planning_issue_record()` when a
  pre-existing finding materially affects the current plan's validation
  reliability
- At session end, report: "Validation: N current-scope findings, M
  pre-existing findings (not blocking)" in the Output Contract
