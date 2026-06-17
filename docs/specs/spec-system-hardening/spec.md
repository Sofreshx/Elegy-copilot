---
spec_id: spec-system-hardening
title: Spec-Driven Development System Hardening
status: draft
type: workflow
updated: 2026-06-08
---

# Spec-Driven Development System Hardening

## Intent

The spec-driven development system produces durable requirements artifacts but the surrounding pipeline — CI gates, pre-commit hooks, index integrity, cross-spec relationships, freshness tracking, shared libraries, and agent instructions — has known gaps that allow inconsistent specs to be committed, stale indexes to drift, supersedes chains to break silently, and duplicate code to rot independently. This spec hardens the entire system around the file-based spec contract so that every inconsistency produces a loud failure or warning, no invalid spec can be committed without detection, and the shared machinery is DRY and trustable.

## Context Evidence

- `scripts/validate-specs.js` (592 lines) — flat synchronous pipeline with 11 structural checks; `--strict` enables file-path liveness checks; exports internal functions for other scripts
- `.github/workflows/repo-ci.yml` — runs validate-manifest, validate-doc-graph, validate-ci-lockfiles; does NOT run `validate-specs.js --strict`
- `scripts/generate-spec-index.js` — generates `specs/index.md` but must be run manually; no CI check for staleness; uses a simplified YAML parser that cannot handle block-list values
- `scripts/validate-specs-artifact-liveness.js` — duplicates `collectSpecFiles`, `extractH2Sections`, `matchFrontmatter`, `looksLikeFilePath` from `validate-specs.js` (~150 lines of copy-paste)
- `docs/system/spec-driven-development.md` — defines 90-day draft staleness and 180-day implemented staleness advisory policy but no code enforces or warns
- `docs/specs/planning-visibility-canonicalization/spec.md` (status: draft) — `supersedes` field could reference superseded specs but no validation exists for cross-spec ID resolution
- `docs/specs/align-elegy-db-assets/spec.md` (status: draft) — effectively superseded by `planning-visibility-canonicalization` but not marked as such
- `docs/specs/planning-explorer-view/spec.md` (status: draft) — effectively superseded by `planning-visibility-canonicalization` but not marked as such
- `opencode-assets/agents/spec.md` — (deleted in agentic-lanes-quality-v2; spec authoring now handled by `spec-authoring` skill and `project-workflow` skill)
- `docs/specs/verifiable-acceptance-criteria/spec.md` (status: draft) — this spec builds on verifiable-acceptance-criteria's `→ verify:` format (R1), shares the same validator file (`scripts/validate-specs.js`), and modifies overlapping skill/agent files (`catalog-assets/shared-skills/spec-review/SKILL.md`, `catalog-assets/shared-skills/spec-authoring/SKILL.md`). Implementation ordering must coordinate to avoid merge conflicts on the shared files.

## Requirements

### R1 — CI Gate

Wire `node scripts/validate-specs.js` into all CI and local validation paths so no invalid spec can land on the default branch.

- R1.1: `.github/workflows/repo-ci.yml` MUST include `validate:specs` as a CI step that runs `node scripts/validate-specs.js --strict specs`
- R1.2: `npm run ci:local` MUST continue to include `validate:specs` and MUST continue to exit 0 after this spec's changes are implemented
- R1.3: If the `validate:specs` step exits non-zero, the CI run MUST fail (the default behavior of `run:` in GitHub Actions when the command exits non-zero)

### R2 — Pre-Commit Hook

Add a pre-commit validation gate that runs spec validation when spec files are staged.

- R2.1: New script `scripts/validate-specs-precommit.mjs` that detects staged `docs/specs/*/spec.md` files via `git diff --cached --name-only --diff-filter=ACMR`, then runs `node scripts/validate-specs.js --strict docs/specs` on the full `docs/specs/` directory. Running on the full directory ensures multi-file checks (R3 index drift, R4 cross-spec integrity) produce correct results.
- R2.2: The pre-commit hook MUST NOT block commits that do not touch any spec files
- R2.3: When validation fails, the hook MUST exit non-zero with the validator's error output identifying all failing spec files
- R2.4: New script `scripts/install-spec-hooks.mjs` that installs the pre-commit gate: if no `.git/hooks/pre-commit` exists, write it directly; if one exists, append a clearly-delimited block that runs `scripts/validate-specs-precommit.mjs`. The installer is idempotent — running it twice does not duplicate the validation block. If the existing hook has a non-trivial structure (contains conditional logic or traps), warn the user and require manual installation instead of blindly appending.
- R2.5: Document the hook installation step in `docs/system/spec-driven-development.md` and repo `AGENTS.md`

### R3 — Index Integrity

Make the spec index trustable by detecting drift between the filesystem and the index.

- R3.1: `scripts/validate-specs.js --strict` MUST check that every `docs/specs/*/spec.md` file has a corresponding entry in `docs/specs/index.md`, and every index entry has a real file — report "index drift" errors when mismatched
- R3.2: As part of CI, the `validate:specs` step MUST detect index staleness (index entries missing from filesystem, or spec files missing from index) and fail with a non-zero exit code
- R3.3: Replace the index generator's simplified YAML parser with a shared import from `scripts/lib/spec-yaml.js` (extracted from the validator's `parseFrontmatterYaml`) to eliminate the dual-parser problem

### R4 — Cross-Spec Integrity

Validate that spec relationship fields reference real, resolvable spec IDs and do not form circular chains.

- R4.1: `scripts/validate-specs.js --strict` MUST verify that `supersedes` and `superseded_by` values reference `spec_id` values that exist in other spec files in the repo
- R4.2: `scripts/validate-specs.js --strict` MUST detect circular supersedes chains (A supersedes B supersedes A) — report "circular supersedes chain" error
- R4.3: When a spec is `superseded`, the validator MUST check that the superseding spec's `supersedes` field lists it back (bidirectional validation)

### R5 — Freshness Warnings

Implement the advisory freshness policy as non-blocking warnings under `--strict`.

- R5.1: `scripts/validate-specs.js --strict` MUST warn when a `draft` spec's `updated` date is older than 90 days from today — "stale draft (N days since last update)"
- R5.2: `scripts/validate-specs.js --strict` MUST warn when an `implemented` spec's `updated` date is older than 180 days — "stale implemented spec (N days, consider reviewing for drift)"
- R5.3: Both freshness checks are warnings, not errors — they do not cause exit code 1. They appear in the output as informational lines.
- R5.4: A spec can opt out of freshness warnings by adding `freshness: ignore` to its frontmatter (a new optional key, not previously in the spec contract). The validator skips freshness checks for that spec. R10.1 must document this new key in the spec-driven-development contract's frontmatter section.

### R6 — Deduplicate Validators

Extract shared logic from all spec-related scripts that duplicate the same parsing and collection functions.

- R6.1: Extract `collectSpecFiles` → `scripts/lib/spec-collector.js`
- R6.2: Extract `extractH2Sections` and `matchFrontmatter` → `scripts/lib/spec-headings.js`
- R6.3: Extract `looksLikeFilePath` and `KNOWN_SOURCE_DIRS` → `scripts/lib/spec-path-heuristics.js`
- R6.4: Extract `parseFrontmatterYaml`, `parseInlineList` → `scripts/lib/spec-yaml.js`
- R6.5: All scripts that currently copy-paste this logic MUST import from the shared modules. At minimum: `validate-specs.js`, `validate-specs-artifact-liveness.js`, `validate-doc-graph.js`, and `spec-readiness-report.js`.
- R6.6: All four scripts MUST still work with their existing contracts (standalone invocation, same exit codes, same output shapes)

### R7 — Plan.md Requirement Check

Warn when a complex spec lacks a companion implementation plan.

- R7.1: `scripts/validate-specs.js --strict` MUST warn when a spec with `status: draft` or `status: approved` has 5+ requirement bullets in its `## Requirements` section but no sibling `plan.md` exists — "complex spec without plan.md (N requirements)"
- R7.2: The requirement count MUST use the same bullet-counting logic already used for Acceptance Checks (`countBulletItems`)

### R8 — Clean Up Existing Specs

Mark the two specs that are effectively superseded by `planning-visibility-canonicalization` and update the superseding spec.

- R8.0: The two specs below are marked superseded because `planning-visibility-canonicalization` explicitly supersedes them: its Drift Notes state it "REPLACES the recreate approach" from `align-elegy-db-assets` with in-place repair (line 239 of that spec) and re-scopes the explorer work from `planning-explorer-view` into its own R5 (line 241). The superseded specs' remaining work is captured in the superseding spec's requirements.
- R8.1: `docs/specs/align-elegy-db-assets/spec.md`: change status to `superseded`, add `superseded_by: planning-visibility-canonicalization`
- R8.2: `docs/specs/planning-explorer-view/spec.md`: change status to `superseded`, add `superseded_by: planning-visibility-canonicalization`
- R8.3: `docs/specs/planning-visibility-canonicalization/spec.md`: add `supersedes: [align-elegy-db-assets, planning-explorer-view]` to frontmatter
- R8.4: After cleanup, run `node scripts/generate-spec-index.js` to regenerate the index with corrected statuses

### R9 — Spec Lane Agent Consistency

Update `opencode-assets/agents/spec.md` to align with the hardened system.

- R9.1: Phase 1.6 — Clarify that recording in elegy-planning is OPTIONAL; specs are standalone requirements artifacts
- R9.2: Phase 2.2 — Change `--strict` mention to integrated validation: "Run `node scripts/validate-specs.js --strict` on the spec and fix all errors before review." Verify current text is already correct and update if needed.
- R9.3: Phase 4.2 — Change to explicitly reference: "Run `→ verify:` commands from the spec's Acceptance Checks section and capture output as Validation Evidence."
- R9.4: Safety section — Add: "If the spec validator (`validate-specs.js --strict`) fails at any phase, stop and fix the spec before proceeding. Never bypass a failing validation gate."
- R9.5: Prerequisites — Reference the pre-commit hook: "Ensure `node scripts/install-spec-hooks.mjs` has been run once in this repo."
- R9.6: Add a CI expectation note: "Spec validation runs in CI on every push. Commits that break spec validation will be rejected."

### R10 — Documentation Updates

Update all related documentation to reference the new hardening mechanisms.

- R10.1: `docs/system/spec-driven-development.md` — Reference the new freshness warnings (R5), the pre-commit hook (R2), the CI gate (R1), and document the new optional frontmatter keys (`freshness: ignore`, `liveness_skip_paths`) in the contract's frontmatter section
- R10.2: `catalog-assets/shared-skills/spec-review/SKILL.md` — Check #12 (plan.md requirement) must reference the validator's automatic check (R7)
- R10.3: `catalog-assets/shared-skills/spec-authoring/SKILL.md` — Reference the pre-commit hook installation as a setup step
- R10.4: Repo `AGENTS.md` — Mention the pre-commit hook for spec authors

### R11 — Portable Paths & Liveness Exclusion

Ensure the CI gate (R1) can pass on Linux by handling machine-local paths in existing specs.

- R11.1: Add `liveness_skip_paths` as a new optional frontmatter key (list of strings). The validator's `--strict` liveness check MUST skip any backtick-quoted path in Context Evidence or Implementation Links that matches a pattern in the spec's `liveness_skip_paths` list. Patterns support: exact path strings, glob patterns (e.g., `C:\Users\*\...`), and the literal `~` for home-directory paths.
- R11.2: Fix `scripts/validate-specs.js` `looksLikeFilePath` regex — change `/^[A-Z]:\\/i` to `/^[A-Z]:[\\/]/i` to also catch forward-slash Windows paths (`C:/Users/...`). This prevents forward-slash Windows paths from slipping through the filter on Linux CI.
- R11.3: Add appropriate `liveness_skip_paths` entries to the two specs that contain machine-local paths:
  - `specs/planning-visibility-canonicalization/spec.md` — skip patterns for `C:\Users\*\...`, `C:/Users/*/...`, `~/.copilot/*`, `~/.elegy/*`
  - `specs/align-elegy-db-assets/spec.md` — skip patterns for `~/.copilot/*`, `~/.elegy/*`, `~/.codex/*`, `~/.config/*`
- R11.4: Document `liveness_skip_paths` in `docs/system/spec-driven-development.md` frontmatter section alongside `freshness: ignore` (covered by R10.1)

## Non-Goals

- Changing the spec file format or adding new required headings
- Integrating specs with elegy-planning database
- Adding a `type`-to-template correspondence validation
- Adding ADR cross-reference validation
- Adding `→ verify:` command execution (executing the commands, not just checking file existence)
- Adding pagination or search to the spec index
- Changing how specs relate to plan-packs or roadmaps
- Adding a spec dashboard or UI
- Merging specs and elegy-planning — they remain separate working models
- Replacing the file-based spec system
- Auto-converting machine-local paths to portable paths in existing specs — `liveness_skip_paths` provides a skip mechanism; full path portability is a separate concern

## Acceptance Checks

- [ ] CI step `validate:specs` exists in `.github/workflows/repo-ci.yml` and runs `node scripts/validate-specs.js --strict specs`
  → verify: `rg "validate:specs" .github/workflows/repo-ci.yml` returns at least 1 match with `--strict` flag
  → verify: `rg "validate-specs" package.json | Select-String "ci:local"` confirms the npm script includes the validator
- [ ] Pre-commit hook scripts exist and detect staged spec file changes
  → verify: `Test-Path "scripts/validate-specs-precommit.mjs"` returns True
  → verify: `Test-Path "scripts/install-spec-hooks.mjs"` returns True
  → verify: `Get-Content "scripts/validate-specs-precommit.mjs" -Raw` includes `git diff --cached` and `validate-specs.js --strict`
- [ ] Validator with `--strict` detects index drift between spec files and `specs/index.md`
  → verify: Add a temp spec file without an index entry, run `node scripts/validate-specs.js --strict specs`, confirm exit code 1 with message containing "index drift"
- [ ] Validator with `--strict` validates cross-spec `supersedes`/`superseded_by` references resolve to real `spec_id` values
  → verify: Create a temp spec referencing a non-existent `spec_id` in `supersedes`, run `node scripts/validate-specs.js --strict` on it, confirm exit code 1 with message containing "references unknown spec_id"
- [ ] Validator with `--strict` warns on stale draft specs (90+ days) and stale implemented specs (180+ days) without exiting non-zero
  → verify: Create a temp spec with `status: draft` and `updated: 2025-01-01`, run `node scripts/validate-specs.js --strict` on it, confirm output contains "stale draft" and exit code 0
- [ ] Shared library modules exist under `scripts/lib/` and are imported by both validators
  → verify: `Test-Path "scripts/lib/spec-collector.js"` returns True
  → verify: `Test-Path "scripts/lib/spec-headings.js"` returns True
  → verify: `Test-Path "scripts/lib/spec-path-heuristics.js"` returns True
  → verify: `Test-Path "scripts/lib/spec-yaml.js"` returns True
  → verify: `rg "require.*spec-collector" scripts/validate-specs.js scripts/validate-specs-artifact-liveness.js` returns 2 matches
- [ ] Validator with `--strict` warns on complex draft/approved specs (5+ requirements) missing a `plan.md`
  → verify: Create a temp spec with `status: draft` and 6 requirement bullets but no sibling `plan.md`, run `node scripts/validate-specs.js --strict` on it, confirm output contains "complex spec without plan.md"
- [ ] Superseded specs are cleaned up with correct cross-references
   → verify: `rg "superseded_by: planning-visibility-canonicalization" docs/specs/align-elegy-db-assets/spec.md` returns at least 1 match
   → verify: `rg "superseded_by: planning-visibility-canonicalization" docs/specs/planning-explorer-view/spec.md` returns at least 1 match
   → verify: `rg "supersedes:.*align-elegy-db-assets" docs/specs/planning-visibility-canonicalization/spec.md` returns at least 1 match
   → verify: `rg "supersedes:.*planning-explorer-view" docs/specs/planning-visibility-canonicalization/spec.md` returns at least 1 match
- [ ] Spec lane agent `opencode-assets/agents/spec.md` includes hardening gates
  → verify: `rg "fix all errors before review" opencode-assets/agents/spec.md` returns at least 1 match
  → verify: `rg "Never bypass a failing validation gate" opencode-assets/agents/spec.md` returns at least 1 match
  → verify: `rg "install-spec-hooks" opencode-assets/agents/spec.md` returns at least 1 match
  → verify: `rg "spec validation runs in CI on every push" opencode-assets/agents/spec.md` returns at least 1 match
- [ ] Documentation updates reference the new hardening mechanisms
  → verify: `rg "pre-commit|freshness warning|validate:specs" docs/system/spec-driven-development.md` returns matches for all three terms
  → verify: `rg "validate-specs" catalog-assets/shared-skills/spec-review/SKILL.md` returns at least 1 match referencing plan.md check
  → verify: `rg "install-spec-hooks" catalog-assets/shared-skills/spec-authoring/SKILL.md` returns at least 1 match
  → verify: `rg "pre-commit" AGENTS.md` returns at least 1 match mentioning spec pre-commit hook
- [ ] `looksLikeFilePath` regex catches both `C:\` and `C:/` Windows paths
  → verify: `rg "\[A-Z\]:\[\\\\\\\\/\]" scripts/validate-specs.js` returns at least 1 match confirming the regex was updated
- [ ] `liveness_skip_paths` frontmatter key is recognized by the validator and paths matching its patterns are skipped during liveness checks
  → verify: Create a temp spec with `liveness_skip_paths: ["C:/Users/test/nonexistent.db"]` and a Context Evidence path referencing that file, run `node scripts/validate-specs.js --strict` on it, confirm exit code 0 (path skipped)
- [ ] Machine-local paths in `planning-visibility-canonicalization/spec.md` and `align-elegy-db-assets/spec.md` do not cause liveness failures on CI
  → verify: `node scripts/validate-specs.js --strict specs/planning-visibility-canonicalization/spec.md` exits 0 (liveness paths skipped); `node scripts/validate-specs.js --strict specs/align-elegy-db-assets/spec.md` exits 0

## Implementation Links

- `scripts/validate-specs.js` — existing, extended with R3, R4, R5, R7
- `scripts/lib/spec-yaml.js` — new, extracted YAML parser
- `scripts/lib/spec-collector.js` — new, shared collectSpecFiles
- `scripts/lib/spec-headings.js` — new, shared extractH2Sections + matchFrontmatter
- `scripts/lib/spec-path-heuristics.js` — new, shared looksLikeFilePath
- `scripts/validate-specs-artifact-liveness.js` — rewritten to use shared modules (R6.5)
- `scripts/validate-doc-graph.js` — rewritten to use shared modules (R6.5)
- `scripts/spec-readiness-report.js` — rewritten to use shared modules (R6.5)
- `scripts/generate-spec-index.js` — updated to use shared YAML parser
- `scripts/validate-specs-precommit.mjs` — new pre-commit gate
- `scripts/install-spec-hooks.mjs` — new hook installer
- `.github/workflows/repo-ci.yml` — updated with spec validation step
- `docs/specs/align-elegy-db-assets/spec.md` — status changed to superseded
- `docs/specs/planning-explorer-view/spec.md` — status changed to superseded
- `docs/specs/planning-visibility-canonicalization/spec.md` — added supersedes
- `docs/specs/index.md` — regenerated after cleanup
- `opencode-assets/agents/spec.md` — R9 updates
- `docs/system/spec-driven-development.md` — R10.1 updates
- `catalog-assets/shared-skills/spec-review/SKILL.md` — R10.2
- `catalog-assets/shared-skills/spec-authoring/SKILL.md` — R10.3
- `AGENTS.md` — R10.4
- `scripts/validate-specs.js` — updated `looksLikeFilePath` regex (R11.2)
- `docs/specs/planning-visibility-canonicalization/spec.md` — added `liveness_skip_paths` (R11.3)
- `docs/specs/align-elegy-db-assets/spec.md` — added `liveness_skip_paths` (R11.3)

## Validation Evidence

- Pending implementation. Each acceptance check's `→ verify:` command serves as the validation method.

## Drift Notes

- None yet. This spec defines the hardening targets; drift from these targets will be captured here during implementation.
