---
created: 2026-07-06
updated: 2026-07-31
category: system
status: current
doc_kind: node
id: git-checkpoint-governance
summary: Canonical contract for atomic commits, reviewable pull requests, and checkpoints during agent sessions.
tags: [git, commit, checkpoint, goals, planning, governance]
related: [goal-contract-governance, commit-validation-governance, project-conventions-governance, harness-asset-flow]
---

# Git Checkpoint Governance

## Purpose

Keep long-running agent work from accumulating large dirty trees by defining when agents should
checkpoint work into atomic commits.

## Contract

| Session type | Commit behavior |
|---|---|
| Goal session | Auto-commit at validated work-unit boundaries when the approved goal, roadmap, or plan already authorizes the work |
| Durable planning session | Auto-commit at validated `elegy-planning` work-point or plan boundaries under the approved goal/roadmap/plan |
| Non-goal session | Pause at natural boundaries, summarize the diff, and offer an atomic commit |

A **goal session** is an explicit `/goal` flow or an active durable `elegy-planning`
goal/roadmap/plan/work-point run.

User approval of a goal, roadmap, or plan authorizes only atomic commits inside that bounded scope.
It does not authorize push, merge, branch deletion, protected-branch promotion, or dirty worktree
force removal.

## Atomic Boundary

Commit after each completed work point or after a coherent implementation slice when the next slice
would mix unrelated changes.

Before any commit:

- inspect the diff
- run the narrowest relevant validation
- stage only intended session-owned files
- exclude pre-existing user changes unless the goal explicitly owns them
- use a message that states the delivered slice

Never use bulk `git add -A` for agent-authored commits. Stage exact paths or reviewed pathsets only.

If validation fails, do not auto-commit. Continue fixing, record the failed evidence, or block with
the failure summary.

If the diff cannot be separated into an atomic commit, pause and ask rather than making a mixed
commit.

## Pull-request handoff

A pull request is ready for review only when it has one coherent purpose, a
clean diff, meaningful commit boundaries, and recorded validation. Its
description should state:

- the problem and user-visible outcome
- the approach and important scope decisions
- acceptance criteria and validation commands/results
- known limitations, follow-up work, and any reviewer focus areas

Keep unrelated cleanup, generated files, and formatting churn out of the PR.
Use a draft PR while implementation or required checks are incomplete; mark it
ready only after the main agent has reconciled review findings and verified the
acceptance criteria. Creating a PR does not authorize merge, auto-merge, or
protected-branch promotion.

## Validation

Use `docs/system/commit-validation-governance.md` for the narrow "safe to commit" gate.

`commit-check --profile commit` is the preferred commit boundary proof when configured. If no
repo-local commit-check exists, use the smallest repo-local validator that covers the changed slice
and report what was run.

## Boundaries

- Auto-commit is allowed only for goal or durable planning sessions with a clean atomic boundary.
- Non-goal sessions offer commits but do not create them without user approval.
- Agents never auto-push, auto-merge, delete branches, promote protected branches, or force-remove
  dirty worktrees.
- Worktree cleanup remains separate: dirty cleanup requires explicit user approval and must not use
  auto-commit as a hidden cleanup step.

## References

- `docs/system/goal-contract-governance.md`
- `docs/system/commit-validation-governance.md`
- `docs/system/project-conventions-governance.md`
