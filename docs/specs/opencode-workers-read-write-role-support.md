---
spec_id: opencode-workers-read-write-role-support
title: OpenCode Workers Read/Write Role Support
status: draft
type: feature
updated: 2026-07-07
---

# OpenCode Workers Read/Write Role Support

## Intent

OpenCode Workers can be configured per role for exploration, research, review,
validation, and implementation. Write-capable workers are opt-in: the global
write setting and the role write setting must both be enabled before a worker
role is considered read/write.

## Contract

- Default config keeps `writeEnabled: false`.
- Role policies may set a profile and `writeEnabled` per role.
- `roleProfiles` remains backward-compatible and is derived from role policies.
- Paid/direct model profiles require `allowPaidModels: true`.
- Cwd-scoped usage reads `<repo>/.opencode-workers/jobs.jsonl` when a repo path
  is supplied; otherwise usage falls back to the global worker journal.
- Usage evidence records permission request counts, denials, write attempts,
  changed files, and dirty git state when the worker result provides them.

## Safety Boundary

The dashboard exposes configuration and evidence for write-capable workers, but
the external `elegy-opencode-workers` implementation must enforce write-mode
execution. Write-mode worker jobs are incomplete unless the plugin:

- rejects write mode when config disables it;
- runs only inside the provided cwd/repo scope;
- surfaces permission requests and decisions;
- reports changed files or git dirty-state evidence;
- fails denied, unknown, or unmediated permission requests.

Codex remains responsible for requirements, approvals, integration, validation,
and final acceptance.

## Validation

- `node --test copilot-ui/routes/codex-opencode-workers.test.js`
- `npm --prefix copilot-ui run ui:build`
- `npm run ui:check -- --target settings`
