---
name: commit-validation-governance
description: "Audit/propose-only governance for setting up umbrella commit-validation checks in a repo. Scans for existing test/lint/format/typecheck/coverage tooling, proposes config, and guides agents to run the umbrella check before commit. Triggers on: commit validation, pre-commit check, umbrella check, commit check setup, commit validation governance, prepare for commit, validate before commit."
tags: [governance, validation, testing, commit, pre-commit, quality]
---

# Commit Validation Governance

## Purpose

Evaluate a target repo's commit-validation setup and propose the smallest missing resources so the repo has a single umbrella command (`node scripts/commit-check-run.mjs`) that proves commit readiness.

## Required Inputs

- target open workspace root, or enough context to select one deterministically
- request mode: `audit` or `propose`

## Runtime Sources

- canonical doc authority: `docs/system/commit-validation-governance.md`
- authoritative machine-readable baseline source: `engine-assets/skills/commit-validation-governance/baseline.definition.json`
- runtime projection: `engine-assets/skills/commit-validation-governance/baseline.json`
- default weights: `engine-assets/skills/commit-validation-governance/default-weights.json`

## Modes

### Audit

1. Confirm the target open workspace root.
2. Run `node scripts/commit-check-discover.mjs <root>` to scan the repo.
3. Compare observed lanes against `baseline.json` normative set.
4. Classify findings as `found`, `missing`, `partial`, or `unknown`.
5. Report what the composite score would be if the configured lanes ran now (estimated).
6. Stop at findings.

### Propose

1. Everything from audit mode.
2. Propose the smallest missing resources:
   - commands to add if a lane is missing
   - config to create or merge at `.copilot/commit-checks.json`
   - tooling to install (e.g., `eslint`, `prettier`, `cargo llvm-cov`)
3. If `package.json` exists and `commit-check` script name is free, propose adding it.
4. Stay read-only; no mutation.

## Normative Minimum Lane Set

- `test` — unit test command
- `lint` — static analysis command
- `format` — formatting check command
- `typecheck` — type-checking command
- `coverage` — coverage check (recommended, not required)

## Output Contract

Return this exact structure:

```text
COMMIT_VALIDATION_GOVERNANCE
- mode: audit|propose
- target_repo:
- canonical_sources:
  - <path>
- runtime_baseline:
  - engine-assets/skills/commit-validation-governance/baseline.json
- findings:
  - <found|missing|partial|unknown + evidence>
- estimated_score:
  - <0-100 or 'unknown'>
- proposed_resources:
  - <path or action + reason>
- mutation:
  - gated-unavailable
```

If a section has no items, write `- none`.

## Operating Rules

- default to `audit/propose-first`
- support only explicit open workspace roots
- fail closed when repo facts are unknown or contradictory
- do not mutate the target repo
- when `commit-check-discover.mjs` fails, report the failure reason under `findings`

## Canonical References

- `docs/system/commit-validation-governance.md`
- `docs/system/validation-governance.md`
- `docs/system/testing-quality-governance.md`
- `docs/system/repo-setup-governance.md`
