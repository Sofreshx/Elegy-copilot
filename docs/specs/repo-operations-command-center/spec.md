---
spec_id: repo-operations-command-center
title: Repo Operations Command Center
status: approved
type: feature
updated: 2026-08-08
---

# Repo Operations Command Center

## Intent

Make global repository maintenance safe and efficient across many repositories by separating harmless ref refresh, fast-forward updates, strict cleanup, evidence-backed cleanup, and agent-assisted merge repair.

## Context Evidence

- `docs/system/copilot-ui-guide.md` defines the existing Repo Operations safety boundary.
- `docs/system/repo-operations-safety-adr.md` records the v4 authority and deletion model.
- `copilot-ui/lib/repoOperationsService.js` owns scans, Git actions, and durable agent runs.
- `copilot-ui/ui/src/views/RepoOperations/RepoOperationsView.tsx` owns the global user workflow.

## Requirements

### Allowed Behavior

- The overview MUST order repositories by derived recent activity and expose local branches, remote branches, and worktrees as selectable entities.
- A confirmed fetch operation MAY run `git fetch --prune` for every configured remote without changing a checkout.
- Fast-forward updates MUST remain limited to clean, tracked, inactive current branches after a fresh-state recheck.
- Strict cleanup MAY remove only inactive, unprotected entities whose ref is merged into the default branch.
- Deterministic analysis MUST record ref identity, ancestry, unique commits, tree delta, PR state, managed activity, and protection state before offering analyzed cleanup.
- High-confidence analyzed cleanup MAY batch-delete selected content-equivalent branches only after confirmation and fresh exact-SHA rechecks.
- Merge repair MUST use a managed worktree, reject fork or otherwise unwriteable PR heads, merge the exact observed base SHA, preserve cancellation, clean terminal repair artifacts, and require distinct push and merge approvals.

### Forbidden Behavior

- The service MUST NOT auto-fetch on tab navigation or run scheduled network mutation.
- The service MUST NOT modify a primary worktree, push, merge, rebase, stash, or delete a branch without the operation-specific approval boundary.
- The service MUST NOT delete a remote branch when GitHub PR/protection evidence is unavailable.
- The interface MUST NOT hide partial failures or allow issue panels to grow beyond their bounded scroll container.

## Non-Goals

- Replacing the existing Workspace Git tab.
- Supporting remote cleanup for providers without GitHub PR/protection evidence.
- Background repository polling or scheduled maintenance.
- Auto-merging or auto-pushing agent-created repairs.

## Acceptance Checks

- The overview exposes sorted activity and typed cleanup entities with action capability state.
  → verify: `node copilot-ui/lib/repoOperationsService.test.js`
- Fetch, analysis, typed cleanup, and selected sync reject missing confirmation or stale state and return entity results.
  → verify: `node copilot-ui/lib/repoOperationsService.test.js && node copilot-ui/routes/repoOperations.test.js`
- The command-center UI supports selection, bounded detail panels, workspace navigation, and batch actions.
  → verify: `npm --prefix copilot-ui run test:vitest -- --run tests/repo-operations-view.vitest.tsx`
- API inventory and contract snapshots describe every v4 route.
  → verify: `UPDATE_API_SNAPSHOT=1 node copilot-ui/tests/api-contract.test.js && node copilot-ui/tests/api-contract.test.js`

## Implementation Links

- `docs/specs/repo-operations-command-center/plan.md`
- `docs/system/repo-operations-safety-adr.md`
- `copilot-ui/lib/repoOperationsService.js`
- `copilot-ui/routes/repoOperations.js`
- `copilot-ui/ui/src/views/RepoOperations/RepoOperationsView.tsx`

## Validation Evidence

- Pending implementation.

## Drift Notes

- v3 worktree-cleanup payloads remain accepted during the v4 migration.
