---
created: 2026-06-09
updated: 2026-06-24
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

Define the contract for the executable `commit-check-setup` skill that bootstraps or updates a target repo's commit-validation infrastructure. This is the mutating complement to the read-only `commit-validation-governance` skill.

## Authority

This doc is a sub-node under `commit-validation-governance`. The 3-script contract, config format, and scoring algorithm are defined there — this doc covers only the setup/update workflow.

## Modes

| Mode | Mutates repo | Copies scripts | Generates config | Force overwrite | Smoke test |
|------|-------------|----------------|-----------------|-----------------|------------|
| `bootstrap` | Yes | Yes | Yes (force) | Yes | Yes |
| `update` | Yes | No | Yes (merge) | No | Yes |

## Script Source and Copy Contract

Source scripts are bundled inside the skill directory at `scripts/commit-check-{discover,setup,run}.mjs`.

Copy rules:
- Byte-for-byte copy from skill's bundled `scripts/` dir, no modification during transfer
- If target `scripts/` dir doesn't exist, create it
- If script already exists at target, skip copy (bootstrap) or leave as-is (update)

## Config Generation Contract

Bootstrap runs: `node scripts/commit-check-setup.mjs <root> --force`

Update runs: `node scripts/commit-check-setup.mjs <root>` (merge mode)

Before overwrite in bootstrap mode:
- If `.copilot/commit-checks.json` exists, copy to `.copilot/commit-checks.json.bak`

Config output: `.copilot/commit-checks.json` per the schema in `commit-validation-governance.md`. The generated config now includes `profiles`, `groups`, lane-level `blocking`, and lane-level `requiresReasonOnSkip` fields.

## Smoke Test Contract

After config generation, always run:
```
node scripts/commit-check-run.mjs --json --repo <root>
```

Expected: exit 0 with valid JSON containing `overallPass` field. Report `compositeScore` and lane results.

## Edge Cases

- **No `package.json`**: Skip npm script addition silently.
- **`commit-check` script already exists in `package.json`**: Skip addition silently.
- **Config already exists in bootstrap mode**: Back up, then overwrite with `--force`.
- **Scripts exist but config missing**: Run setup (merge mode) instead of bootstrap.
- **Script copy fails**: Fail closed, report error, do not generate config.

## Acceptance Checks

- [ ] All three scripts exist in target after bootstrap
- [ ] `.copilot/commit-checks.json` is valid JSON, `schemaVersion: 3`
- [ ] `commit-check-run.mjs --json` exits 0 after bootstrap
- [ ] Update merges new lanes without overwriting user customizations
- [ ] Backup file created when overwriting existing config

## Canonical References

- `docs/system/commit-validation-governance.md` — parent authority
- `docs/system/validation-governance.md` — validation decision matrix
- `docs/system/repo-setup-governance.md` — analogous setup governance pattern
