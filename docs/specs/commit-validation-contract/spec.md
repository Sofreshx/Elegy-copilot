---
spec_id: commit-validation-contract
title: Commit Validation Contract
status: draft
type: contract
updated: 2026-06-30
---

# Commit Validation Contract

## Intent

Define the authoritative contract for pre-commit validation, commit-check tooling, and CI gate integration. Every commit validation hook, check script, and CI step MUST conform to this contract.

## Context Evidence

- `docs/system/commit-validation-governance.md` — currently the canonical doc for commit validation governance. This spec will become the normative authority.
- `scripts/validate-specs-precommit.mjs` — pre-commit spec validation gate.
- `scripts/install-spec-hooks.mjs` — idempotent hook installer/updater.
- `scripts/validate-doc-graph.js` — doc graph validation (CI and pre-commit).
- `scripts/validate-manifest.js` — manifest validation.
- `scripts/validate-ci-lockfiles.js` — CI lockfile validation.
- `.github/workflows/repo-ci.yml` — CI pipeline wiring all validation steps.
- `engine-assets/skills/commit-validation-governance/SKILL.md` — skill-level commit validation guidance.
- No existing `docs/specs/` artifact defines the commit validation contract normatively.

## Requirements

### Allowed Behavior

#### R1 — Pre-Commit Hook Contract

- R1.1: Pre-commit hooks MUST gate on staged files only — detect changes via `git diff --cached --name-only --diff-filter=ACMR`.
- R1.2: Hooks MUST NOT block commits that do not touch files in their domain.
- R1.3: Hooks MUST exit non-zero on validation failure with output identifying failing files.
- R1.4: Hooks MUST support a bypass mechanism via environment variable (e.g., `SKIP_SPEC_CHECK=1`).
- R1.5: Hook installation MUST be idempotent — running the installer twice MUST NOT duplicate validation blocks.

#### R2 — CI Gate Contract

- R2.1: Every validator that runs as a pre-commit hook MUST also run in CI on push/PR to the default branch.
- R2.2: CI MUST run validators with their strictest mode (e.g., `--strict` flag).
- R2.3: CI failure on any validation step MUST block merge (exit non-zero).

#### R3 — Commit-Check Format

- R3.1: Commit-check configurations live at `.copilot/commit-checks.json`.
- R3.2: The configuration defines lanes (check groups) with ordered steps.
- R3.3: Each step references a script path and optional arguments.
- R3.4: Lanes are selected via configuration or command-line flag (e.g., `ci:local`).

#### R4 — Validator Minimum Contract

- R4.1: Every validator MUST exit non-zero on failure, zero on success.
- R4.2: Validators MUST write errors to stderr, informational output to stdout.
- R4.3: Validators MUST support a `--json` mode for machine-readable output.
- R4.4: Validators MUST accept a target path as their primary argument.

### Forbidden Behavior

- A pre-commit hook MUST NOT block commits that don't touch its domain files.
- A pre-commit hook MUST NOT silently skip validation — skipping MUST be explicit (env var or flag).
- A CI step MUST NOT allow merge when its associated pre-commit hook would have blocked.
- A validator MUST NOT produce different results in CI vs local for the same input.

## Non-Goals

- Defining specific check content for each validator — check details are in domain-specific specs and docs.
- Defining how commit-check configurations are generated or updated — that belongs to commit-check-setup skill.
- Defining the full `.github/workflows/` CI structure — only the validation step contract.
- Defining how hooks interact with git internals beyond the standard hook interface.

## Acceptance Checks

- The spec itself passes spec validation
  → verify: run spec validator against this file
- All 4 requirements with sub-requirements are present
  → verify: count `#### R[1-4]` headings — at least 4
- Forbidden Behavior covers at least 3 prohibitions
  → verify: count `MUST NOT` prohibitions — at least 3
- Commit validation governance doc references this spec
  → verify: search for `commit-validation-contract` in the governance doc

## Implementation Links

- `docs/specs/commit-validation-contract/spec.md` — this file
- `docs/system/commit-validation-governance.md` — thinned to reference this spec
- `scripts/validate-specs-precommit.mjs` — spec pre-commit gate
- `scripts/install-spec-hooks.mjs` — hook installer
- `.github/workflows/repo-ci.yml` — CI pipeline

## Validation Evidence

- Pending implementation.

## Drift Notes

- None yet.
