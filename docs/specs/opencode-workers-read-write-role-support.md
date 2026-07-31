---
spec_id: opencode-workers-read-write-role-support
title: OpenCode Workers Read/Write Role Support
status: implemented
type: feature
updated: 2026-07-16
---

# OpenCode Workers Read/Write Role Support

## Intent

OpenCode Workers can be configured per role for exploration, research, review,
validation, and implementation. Write-capable workers are opt-in: the global
write setting and the role write setting must both be enabled before a worker
role is considered read/write.

## Canonical Contract

The runtime contract is owned by the external `elegy-opencode-workers` plugin.
This is an OpenCode-only dashboard projection: Codex no longer starts or
relays OpenCode Worker jobs, and Codex delegation uses its native agents plus
the Elegy plugin marketplace. The plugin's
`docs/write-capable-worker-design.md` in that repository is the authority, and
its `README.md` ("Guarded Implementation") is the usage summary. This spec is
the dashboard-side projection.

Shipped contract facts the dashboard relies on:

- Role `implementation` runs only when all four gates pass: config
  `writeEnabled`, config `roleWrite.implementation`, spawn `writeEnabled`, and
  a non-empty exact `allowedFiles` list.
- Default config keeps `writeEnabled: false`; read-only roles are unchanged
  and deny every permission fail-closed.
- Paid/direct model profiles require `allowPaidModels: true`; the resolved
  spawn model is pinned for the whole session.
- The worker edits a detached git worktree under the worker state root; the
  caller checkout never changes. Only `edit`/`write`/`apply_patch` requests on
  exact allowlisted files are approved, always `allow_once`.
- The job journal lives outside the repository
  (`~/.elegy/opencode-workers/jobs/<repo-hash>.jsonl`); the legacy
  `<repo>/.opencode-workers/jobs.jsonl` remains readable for old jobs.
- A completed job exposes `worktree {path, baseCommit, retainedUntil}`,
  `changes {files, insertions, deletions, bytes}`,
  `artifact {patchPath, sha256, manifestPath}`, `writeAttempts`, and the
  permission decision records. Terminal failures carry `signal` values such as
  `supervisor_lost` and `watchdog_timeout`.

## OpenCode-only Boundary

The dashboard exposes this configuration and evidence only from the OpenCode
settings/workspace surfaces. It is not a shared harness asset and it is not
available from Codex settings or the cross-harness Codex inventory.

## Safety Boundary

The dashboard exposes configuration and evidence for write-capable workers;
the external `elegy-opencode-workers` plugin enforces write-mode execution:

- rejects write mode when any gate disables it;
- runs implementation jobs only inside the managed worktree for the cwd/repo;
- surfaces permission requests and decisions;
- reports changed files, artifact hashes, and dirty git-state evidence;
- fails denied, unknown, or unmediated permission requests as
  `policy_violation`.

Codex remains responsible for requirements, approvals, patch application,
integration, validation, and final acceptance; the worker never runs shell,
never spawns subagents, and never commits or publishes.

## Validation

- `node copilot-ui/scripts/run-vitest.js tests/opencode-view.vitest.tsx tests/opencode-go-workspaces-routes.vitest.ts`
- `npm --prefix copilot-ui run ui:build`
- `npm run ui:check -- --target settings`
