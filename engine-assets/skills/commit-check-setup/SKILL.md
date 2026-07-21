---
name: commit-check-setup
description: "Install, update, or repair repo-local commit-check infrastructure including git hooks after an explicit user request. Installs config, runtime scripts, and .githooks hooks with core.hooksPath. Do not use merely to run existing checks, validate changes, or discuss commit quality. Triggers on: setup commit checks, bootstrap commit checks, configure git hooks, setup pre-commit, update commit checks, repair commit checks."
---

# Commit Check Setup

Require an explicit repository root and mutation request. Run:

```text
node <skill-dir>/scripts/commit-check-bootstrap.mjs --repo <absolute-repo-root>
```

Use `--dry-run` only when the user requests a preview. Let auto mode infer bootstrap, update, or repair. Do not copy files, select modes, back up config, or roll back changes manually.

The coordinator installs `.copilot/commit-checks.json` config, `scripts/commit-check-*.mjs` runtime files, `.githooks/pre-commit` and `.githooks/pre-push` hook files, and a `prepare` npm script. It sets `core.hooksPath` to `.githooks` so hooks activate on `git commit` and `git push`. Pre-commit runs `--group commit` (lint, format, typecheck). Pre-push runs `--group push` (test, typecheck).

Interpret the JSON result:

- `setupSucceeded: false`: report the infrastructure error and rollback result.
- `setupSucceeded: true`, `repositoryChecksPassed: false`: setup succeeded; report the failing lanes and hook status without undoing setup.
- Both true: report the mode, mutations, config path, hook status, and composite score.
