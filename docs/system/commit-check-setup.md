---
created: 2026-06-09
updated: 2026-07-20
category: system
status: current
doc_kind: node
id: commit-check-setup
summary: "Executable skill contract for bootstrapping and updating commit-check infrastructure in target repos. Sub-node under commit-validation-governance."
tags: [setup, validation, commit, quality, bootstrap]
related: [commit-validation-governance, repo-setup-governance, validation-governance]
---

# Commit Check Setup

## Purpose

Define the executable `commit-check-setup` skill contract. A bundled coordinator owns mutation; the model-facing skill only invokes it and interprets its JSON result.

## Authority

This doc is a sub-node under `commit-validation-governance`. The repo-local script contract, config format, and pass/fail algorithm are defined there — this doc covers only the setup/update workflow.

## Coordinator

Run from the installed skill directory:

```text
node scripts/commit-check-bootstrap.mjs --repo <absolute-repo-root>
```

The coordinator requires an explicit git repository root. `--dry-run` returns the inferred plan without mutation. `--mode` exists for diagnostics; normal skill use leaves mode selection on `auto`.

| Inferred mode | Repository state | Behavior |
|---|---|---|
| `bootstrap` | No config or runtime scripts | Install runtime and create config |
| `update` | Config and all runtime scripts exist | Preserve runtime and merge config |
| `repair` | Partial infrastructure exists | Install only missing runtime and merge or create config |

## Mutation Contract

- Copy bundled runtime files byte-for-byte only when the target file is missing.
- Preserve every existing runtime file.
- Back up an existing config to `.copilot/commit-checks.json.bak` before generation.
- Snapshot every affected file and restore it when copying, config generation, or runner protocol validation fails.
- Add the npm script through the repo-local setup runtime when `package.json` permits it.
- Return all planned and completed mutations as JSON.

The four repo-local runtime files remain `commit-check-{defaults,discover,setup,run}.mjs`. The coordinator is skill-only and is not copied into target repositories.

## Result Contract

Keep infrastructure success separate from repository health:

- `setupSucceeded: false`: infrastructure mutation failed and rollback was attempted. Exit 2.
- `setupSucceeded: true`, `repositoryChecksPassed: false`: installation is valid, but one or more selected blocking lanes fail. Exit 0 from the coordinator.
- Both true: installation and selected repository checks pass. Exit 0.

The coordinator accepts runner exits 0 and 1 only when stdout is valid JSON containing boolean `overallPass`. Any other runner result is an infrastructure failure and triggers rollback.

## Acceptance Checks

- [ ] Auto mode selects bootstrap, update, and repair from repository state
- [ ] All five runtime scripts exist after bootstrap or repair (includes `setup-git-hooks.mjs`)
- [ ] `.githooks/pre-commit` and `.githooks/pre-push` exist after bootstrap or repair
- [ ] `core.hooksPath` is set to `.githooks` after bootstrap or repair
- [ ] `.copilot/commit-checks.json` is valid JSON, `schemaVersion: 3`
- [ ] Update merges new lanes without overwriting user customizations
- [ ] Existing runtime scripts remain byte-identical during update
- [ ] Hook files are overwritten from bundled templates on update and repair
- [ ] Existing config is backed up before update
- [ ] `prepare` npm script is injected when `package.json` permits
- [ ] Infrastructure failures restore affected files (scripts, hooks, config, package.json)
- [ ] Failing repository checks do not misreport setup failure

## Canonical References

- `docs/system/commit-validation-governance.md` — parent authority
- `docs/system/validation-governance.md` — validation decision matrix
- `docs/system/repo-setup-governance.md` — analogous setup governance pattern
