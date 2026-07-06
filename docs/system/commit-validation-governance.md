---
created: 2026-06-04
updated: 2026-07-06
category: system
status: current
doc_kind: node
id: commit-validation-governance
summary: "Canonical authority for commit-validation setup: discovery, configuration, umbrella run, and deterministic scoring across TypeScript and Rust workspaces."
tags: [validation, testing, governance, commit, pre-commit, quality]
related: [testing-quality-governance, validation-governance, repo-setup-governance, testing-and-e2e, check-taxonomy-governance, git-checkpoint-governance]
---

# Commit Validation Governance

## Purpose

Define the canonical contract for commit-validation tooling: self-contained repo-local CLI scripts (`commit-check-discover`, `commit-check-setup`, `commit-check-run`, and shared defaults) plus shipped governance/setup skills. The goal is a single umbrella command per repo that proves the selected local gate is safe to commit, without running heavy integration or E2E suites by default.

This doc owns the narrow **commit / merge gate** portion of the check taxonomy. See
`docs/system/check-taxonomy-governance.md` for the broader class/determinism/gate-strength model.
Use `docs/system/git-checkpoint-governance.md` for when agent sessions should create, offer, or
defer atomic commits.

## What It Covers

| Lane | Purpose | Default weight | Gate |
|------|---------|----------------|---------|
| `test` | Unit tests pass | 0.30 | Blocking in `commit` when configured |
| `lint` | Static analysis passes | 0.20 | Blocking in `commit` when configured |
| `format` | Code formatting check | 0.10 | Blocking in `commit` when configured |
| `typecheck` | Type-check gates | 0.25 | Blocking in `commit` when configured |
| `ci-local` | Local mirror of push-to-main CI | optional | Blocking in `ci-local` |
| `docs-pages` | Docs Pages local mirror | 0.05 | Blocking in `ci-local` when configured |
| `coverage` | Test coverage thresholds | optional | Advisory by default |

## Repo-Local Script Contract

### 1. `scripts/commit-check-defaults.mjs`

Shared runtime defaults and config validation for the repo-local scripts. Owns:

- config schema version: `3`
- discovery schema version: `1`
- default profile: `commit`
- default profiles, groups, weights, lane metadata, and lane normalization

### 2. `scripts/commit-check-discover.mjs [repo-root]`

Read-only scan of a workspace root. Defaults to `cwd()` if no path is given. Detects:

- **TypeScript/Node.js**: `package.json` scripts, test frameworks (vitest/jest), lint tools (eslint), formatters (prettier), typecheck (tsc), coverage config, Docs Pages when `docs:build` and `scripts/validate-doc-graph.js` exist
- **Rust**: `Cargo.toml` workspace members, cargo test, cargo clippy, cargo fmt, cargo check, coverage tools (cargo llvm-cov, cargo tarpaulin)
- **Existing config**: whether `.copilot/commit-checks.json` already exists

Output: JSON to stdout with discovery `schemaVersion`, `configSchemaVersion`, lane detection results, and commands.

### 3. `scripts/commit-check-setup.mjs [repo-root] [--force] [--no-script]`

Generates or merges `.copilot/commit-checks.json`. Reads discovery output, writes a deterministic config with detected commands and shipped default weights.

Optional `--force` overwrites an existing config instead of merging. Optional `--no-script` suppresses the auto-add of the `commit-check` npm script (useful for Rust-only repos or manual script wiring).

If a root `package.json` exists and the name `commit-check` is free in its `scripts` field, the script adds `"commit-check": "node scripts/commit-check-run.mjs"`.

### 4. `scripts/commit-check-run.mjs [repo-root] [--config path] [--repo path] [--json]`

Reads `.copilot/commit-checks.json` (or `--config` override), runs all enabled lanes, computes composite score, and exits:

- exit 0 if every selected blocking lane passes
- exit 1 otherwise

With `--json`, outputs full result JSON to stdout. The `<repo-root>` positional arg and `--repo` are equivalent; both default to `cwd()`. Without `--profile`, the runner uses the `commit` profile. Use `--all` to run every enabled lane.

## Scoring Algorithm

### Composite formula

```
compositeScore = sum(lane.weight * lane.score for found, enabled lanes)
              / sum(lane.weight for found, enabled lanes)
```

Missing or disabled lanes are excluded from both numerator and denominator.

### Per-lane scoring

| Lane | Score derivation |
|------|-----------------|
| `test` | 100 if exit code 0, 0 otherwise |
| `coverage` | `linePct*0.5 + branchPct*0.3 + functionPct*0.2`, clamped to [0, 100] |
| `lint` | 100 if exit code 0, 0 otherwise |
| `format` | 100 if exit code 0, 0 otherwise |
| `typecheck` | 100 if exit 0, 0 otherwise; blocks only when selected and `blocking: true` |

### Pass/fail and score

- Pass/fail authority: selected lanes with `blocking: true`
- Default selected profile: `commit`
- Score role: diagnostic/reporting evidence
- Default threshold: 70, retained for `passesThreshold` reporting
- Legacy `gates` is retained for compatibility and should be empty in new configs

## Baseline Config Format

`.copilot/commit-checks.json`:

```json
{
  "schemaVersion": 3,
  "configVersion": 1,
  "threshold": 70,
  "weights": {
    "test": 0.30,
    "lint": 0.20,
    "format": 0.10,
    "typecheck": 0.25
  },
  "gates": [],
  "profiles": {
    "commit": { "label": "Commit", "cost": "fast", "opensWindow": false },
    "ci-local": { "label": "CI Local", "cost": "medium", "opensWindow": false }
  },
  "lanes": {
    "test": {
      "enabled": true,
      "blocking": true,
      "required": true,
      "defaultProfiles": ["commit"],
      "commands": ["npm run test:unit"]
    },
    "typecheck": {
      "enabled": true,
      "blocking": true,
      "required": true,
      "defaultProfiles": ["commit"],
      "commands": ["npx tsc --noEmit"]
    },
    "docs-pages": {
      "enabled": true,
      "blocking": true,
      "required": true,
      "defaultProfiles": ["ci-local"],
      "ciWorkflow": "docs-pages.yml",
      "ciJob": "build",
      "commands": ["node scripts/validate-doc-graph.js", "npm run docs:build"]
    }
  }
}
```

## Determinism Guarantees

- Same repo files → same discovery output
- Same config + same lane exit codes → same selected lane statuses and composite score
- Tie-breaking: lexical sort of lane keys before summing weights
- Missing coverage tool → coverage score = 0 with a WARN status
- Missing coverage metric (e.g., no branch data) → that sub-metric is treated as 0

## Non-Goals

- Running integration or E2E tests (these belong in CI or the `@test-runner` lane)
- Setting up pre-commit git hooks (deferred to future slice)
- Code quality beyond lint/format (separate governance surface)
- Language support beyond TypeScript/Node.js and Rust (extensible via plugin config)
- Replacing spec-authored pre-implementation proof, broader validation routing, or reviewer evidence
  with commit-check lanes

## Boundary

- `commit-check --profile commit` should contain only fast, deterministic, low-friction checks that
  answer "safe to commit?".
- `commit-check --profile ci-local` should mirror deterministic push-to-main CI jobs and use explicit
  remote-only markers for jobs that cannot run locally.
- Spec-authored or generated proof artifacts may later feed commit-check, but only after they prove
  stable and non-disruptive as advisory or optional lanes first.
- Manual checks and review-only evidence do not belong in the narrow commit gate by default.

## Skill Mapping

The shipped skill (`commit-validation-governance`) performs two modes:

### Audit mode

1. Confirm target repo root
2. Run `commit-check-discover.mjs` against it
3. Report which lanes are found, missing, or partially configured
4. Compare against normative baseline
5. Report score estimate based on what would happen if run now

### Propose mode

1. Everything from audit mode
2. Propose the smallest config additions, lane setup, or tool installs needed
3. Stay read-only — no mutation

## Acceptance Checks

- [ ] `commit-check-discover.mjs` accurately detects TypeScript, Rust, and Docs Pages lanes in this repo
  → verify: run against elegy-copilot root, confirm test/coverage/lint/format/typecheck lanes are detected for JS/Rust and `docs-pages` is detected when docs validation exists
- [ ] `commit-check-setup.mjs` generates a valid `.copilot/commit-checks.json` that the runner can consume
  → verify: run setup, then run `commit-check-run.mjs --config .copilot/commit-checks.json --json`, confirm exit 0 and valid score JSON
- [ ] Scoring algorithm is deterministic: same config + same lane results → same composite score
  → verify: run the runner twice with a fixed mock config, confirm identical output
- [ ] Blocking lanes force failure regardless of composite score
  → verify: inject a failing blocking command in config, confirm overall FAIL with score ≥ threshold
- [ ] Missing lane is excluded from scoring (not scored as 0)
  → verify: disable all lanes but one, confirm composite equals that lane's score alone
