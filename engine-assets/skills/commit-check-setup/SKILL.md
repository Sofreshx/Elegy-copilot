---
name: commit-check-setup
description: "Full bootstrap or update of commit-check setup for a target repo. Copies commit-check scripts, generates .copilot/commit-checks.json config, adds npm script, and smoke tests. Triggers on: commit check setup, setup commit checks, bootstrap commit checks, configure pre-commit checks, update commit checks, init commit checks."
tags: [setup, validation, commit, quality, bootstrap]
---

# Commit Check Setup

## Purpose

Bootstrap or update a target repo's commit-validation infrastructure so the Elegy Copilot UI can gate git actions on mandatory checks. This skill mutates the target repo — unlike governance skills which are read-only.

The bundled scripts (`commit-check-{defaults,discover,setup,run}.mjs`) are the authoritative copies. The same scripts exist at the elegy-copilot repo root (`scripts/`) for self-validation of this repo; the skill copies from its own bundled copies, not from the repo root.

## Required Inputs

- target open workspace root (explicit path, never inferred from cwd)
- request mode: `bootstrap` or `update`

## Runtime Sources

Canonical metadata (elegy-copilot repo paths — not resolvable in target repos):

- canonical doc authority: `docs/system/commit-validation-governance.md`
- setup sub-node: `docs/system/commit-check-setup.md`
- baseline: `engine-assets/skills/commit-check-setup/baseline.json`
- bundled scripts: `scripts/commit-check-{defaults,discover,setup,run}.mjs` (inside this skill directory)

## Modes

### Bootstrap

Full setup for a repo that has no commit-check infrastructure.

1. Confirm target workspace root exists and is a git repo.
2. Check for existing scripts at `<root>/scripts/commit-check-{defaults,discover,setup,run}.mjs`.
3. If any script is missing, copy all four from this skill's bundled `scripts/` directory into the target repo's `scripts/` directory.
4. If `.copilot/commit-checks.json` exists, back up to `.copilot/commit-checks.json.bak`.
5. Run `node scripts/commit-check-setup.mjs <root> --force` to generate config.
6. Run `node scripts/commit-check-run.mjs --json --repo <root>` as smoke test.
7. Report results: lanes detected, config path, composite score.

### Update

Refresh an existing setup — re-discover lanes, merge new lanes into config.

1. Confirm target workspace root exists.
2. Verify all four scripts exist in `<root>/scripts/`. If missing, tell user to run bootstrap first.
3. Run `node scripts/commit-check-discover.mjs <root>` to scan current state.
4. Run `node scripts/commit-check-setup.mjs <root>` (merge mode, no `--force`).
5. Run smoke test.
6. Report: new lanes added, stale lanes marked, composite score.

## Operating Rules

- Mutates the target repo — this is intentional and expected.
- Always back up existing `.copilot/commit-checks.json` before overwrite (to `.copilot/commit-checks.json.bak`).
- Fail closed if script copy or config generation fails.
- Require explicit workspace root — never infer from cwd.
- Do not modify the source scripts during copy (byte-for-byte copy).
- If target repo has no `package.json`, skip the npm script addition silently.
- If target repo has `package.json` but `commit-check` script already exists, skip addition silently.

## Output Contract

Return this exact structure:

```text
COMMIT_CHECK_SETUP
- mode: bootstrap|update
- target_repo:
- canonical_sources:
  - <path>
- scripts_installed:
  - <path or 'already present'>
- config_path:
  - .copilot/commit-checks.json
- lanes_detected:
  - <lane name>: <command>
- composite_score:
  - <0-100 or 'unknown'>
- smoke_test:
  - pass|fail
- mutation:
  - executed
```

If a section has no items, write `- none`.

## Acceptance Checks

- [ ] All four commit-check scripts exist in target repo after bootstrap
- [ ] `.copilot/commit-checks.json` is valid JSON with `schemaVersion: 3`
- [ ] `commit-check-run.mjs --json` exits 0 after bootstrap
- [ ] Update mode merges new lanes without overwriting user customizations

## Canonical References

elegy-copilot repo paths (not resolvable in target repos):

- `docs/system/commit-validation-governance.md`
- `docs/system/commit-check-setup.md`
- `docs/system/validation-governance.md`
- `docs/system/repo-setup-governance.md`
