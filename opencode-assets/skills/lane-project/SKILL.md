---
name: lane-project
description: "Multi-session roadmap work. Requires Elegy Planning goal/roadmap/work point, dedicated worktree, claim/lease, evidence, and review."
triggers:
  - project
  - roadmap
  - multi-session
  - work point
  - lane project
  - claim work
---

# Lane: Project

Multi-session roadmap work. Uses Elegy Planning as the durable authority for goal → roadmap → work point → plan/todo/review/evidence.

## When To Use

- A task spans multiple sessions
- The work is tracked in an Elegy Planning roadmap
- Changes require a dedicated isolated worktree
- Work has explicit validation expectations and review gates
- Multiple work points have dependencies on each other

## When NOT To Use

- Single-session scoped feature → `lane-standard`
- Trivial fix → `lane-quick`
- Pure spec work without implementation → `lane-spec`

## Model Role

- **Exploration and execution:** `small` (DeepSeek V4 Flash)
- **Gates and review:** `review` role (defaults to `big`, DeepSeek V4 Pro)
- **Escalation triggers:**
  - Work point plan review → use `review`
  - Validation evidence review → use `review`
  - Handoff between work points → use `review`
  - Architectural decisions spanning work points → use `review`

## Prerequisites

1. Load `lane-project` skill
2. Load `elegy-planning` skill (durable planning authority)
3. Load `roadmap-planning` skill (roadmap workflow)
4. Load `worktree` skill (isolated workspace)
5. Load `implementation-review` skill (post-edit review)
6. An active Elegy Planning goal and roadmap

## Workflow

### Phase 0: Setup

1. Ensure Elegy Planning DB is initialized (`elegy-planning health --json`)
2. Goal and roadmap exist for this body of work
3. Work points are defined with dependencies and validation expectations
4. Check for active leases on the target work point

### Phase 1: Claim

1. **Suggest workflow:** Find next runnable work point from the roadmap
2. **Confirm:** Present candidate work point with dependencies and validation expectations
3. **Claim:** Create a project run lease (bound to work point, branch, worktree, session)
4. **Worktree:** Create a dedicated worktree for the claimed work point

### Phase 2: Execute

1. **Plan:** Create a plan/todos for the work point
2. **Implement:** Execute in the isolated worktree using `Build`
3. **Validate:** Run validation expectations defined in the work point
4. **Record evidence:** Log implementation refs, warnings/questions, validation findings
5. **Review:** Use `review` model role for gate review

### Phase 3: Complete

1. **Commit:** Stage and commit changes in the worktree (manual, not auto-committed)
2. **Release:** Release the project run lease
3. **Clean up:** Remove the worktree (no auto-commit; use `commitBeforeDelete: true` only when explicitly committing)
4. **Update roadmap:** Mark work point evidence and status

## Validation Standard

- Full evidence chain required:
  - Validation expectations defined in work point metadata
  - Implementation run refs (what was attempted)
  - Warning/question records (ambiguities found during work)
  - Validation finding refs (test/lint/typecheck results)
  - Review point ref (gate review outcome)
  - Commit SHA (if committed)
- Run `elegy-planning validate all --json` before marking work point complete

## Worktree Behavior

For project lane work:
- Always use `worktree_create` for each work point
- `worktree_delete` does NOT auto-commit by default
- Use `commitBeforeDelete: true` only when you explicitly want to commit before cleanup
- Commits in the worktree are manual and deliberate

## Output Contract

At completion:
- **Work point:** [ID + title]
- **Lease:** [run ID, duration]
- **Worktree:** [path, branch]
- **Changes:** [file:line, commit SHA if committed]
- **Evidence:** [validation results, review findings, warnings]
- **Next:** [next work point candidate or done]

## Safety

- Never claim a work point that has incomplete dependencies
- Never skip validation gates
- Never auto-commit or auto-push — merges are human-gated
- If interrupted, release the lease with status `interrupted` so another session can reclaim
- Keep evidence even on failure — failed validation is valid evidence
