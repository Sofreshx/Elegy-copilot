---
spec_id: docs-specs-knowledge-system
title: Docs / Specs Knowledge System Enhancement
status: implemented
type: migration
updated: 2026-06-30
liveness_skip_paths:
  - specs/docs-specs-knowledge-system/plan.md
  - docs/system/**
  - docs/*.md
  - docs/specs/**
  - specs/<spec-slug>/spec.md
  - specs/<slug>/spec.md
  - spec-dev/SKILL.md
  - spec-review/SKILL.md
  - opencode-assets/agents/spec.md
---

# Docs / Specs Knowledge System Enhancement

## Intent

Make `docs/` the canonical knowledge root for Elegy Copilot and bootstrapped repos. Move specs from root `specs/<slug>/spec.md` to `docs/specs/<slug>/spec.md`, keep instruction surfaces compact, enforce concision through `AGENTS.md` and validators, and aggressively prune stale or inaccurate docs/specs during migration.

## Context Evidence

- `docs/specs/` currently holds 8 active specs at repo root, with a generated `docs/specs/index.md` and `docs/specs/_templates/` directory
- `docs/system/` holds 60 canonical governance, architecture, workflow, and policy docs
- `docs/system/spec-driven-development.md` enforces a "No Collision Rule": specs never write into `docs/`, docs never write into `specs/` — this rule must be removed as part of this migration
- `docs/system/doc-graph-spec.md` defines `docs/system/` as canonical but reserves `docs/*.md` for redirect stubs only — `docs/specs/` needs to be declared as a governed non-doc-graph spec family
- `scripts/validate-specs.js` hardcodes default `targetPath` to the old `specs` directory
- `scripts/validate-specs-precommit.mjs` hardcodes grep pattern for old `specs/` paths
- `scripts/generate-spec-index.js` hardcodes default path to old `specs`
- `scripts/install-spec-hooks.mjs` hardcodes grep pattern for old `specs/` paths
- `scripts/lib/spec-path-heuristics.js` includes old `specs` in `KNOWN_SOURCE_DIRS`
- `.github/workflows/repo-ci.yml` runs spec validation against old `specs` path
- Four harness home files reference old `specs/<spec-slug>/spec.md` paths: `codex-assets/home/AGENTS.md`, `opencode-assets/home/AGENTS.md`, `antigravity-assets/home/GEMINI.md`
- `engine-assets/copilot-instructions.md` references old `specs/<spec-slug>/spec.md` path
- `catalog-assets/shared-skills/spec-authoring/SKILL.md`, `catalog-assets/shared-skills/spec-dev/SKILL.md`, `catalog-assets/shared-skills/spec-review/SKILL.md` are authoritative skill sources that reference old `specs/` paths
- `engine-assets/skills/repo-setup-governance/profile-definitions.json` references `docs/specs/index.md` in the `spec-driven` overlay profile
- `scripts/validate-repo-setup-profiles.js` hardcodes expected `docs/specs/index.md` in the spec-driven profile validation
- `AGENTS.md` lists `specs/` in the orientation table
- `package.json` script `validate:specs` delegates to `scripts/validate-specs.js --strict` which defaults to old `specs/`

## Requirements

### Allowed Behavior

- `docs/specs/<slug>/spec.md` as the canonical spec location
- Removing the No Collision Rule between specs and docs
- Declaring `docs/specs/**` as a governed spec family excluded from doc-graph validation
- Updating all tooling defaults to use `docs/specs/` paths
- Updating CI workflow, harness instructions, shared skills, governance docs, and setup profiles
- Physically migrating spec files from `specs/` to `docs/specs/` with redirect README
- Adding concise-by-default rules to `AGENTS.md` and governance docs
- Deleting obsolete, duplicated, or inaccurate prose during touch

### Forbidden Behavior

- Full concision validator with hard-gate enforcement (warn-only first pass in scope)
- Automated pruning of untouched docs
- Changing the `elegy-planning` SQLite authority
- VitePress site rebuild or doc-site publishing pipeline changes
- Changing the spec file format, frontmatter schema, or validation rules beyond path updates
- Adding new spec types or changing existing type contracts
- Concision enforcement for docs/specs not touched during migration
- Backward compatibility for pre-migration external consumers of `specs/` paths

### R1: Canonical spec location
- `docs/specs/<slug>/spec.md` is the only long-term canonical spec location
- `docs/specs/index.md` is the generated catalog
- `docs/specs/_templates/` carries spec type templates

### R2: Remove No Collision Rule
- Remove the "Specs and Docs Relationship" section from `docs/system/spec-driven-development.md`
- Replace with new rule: specs are a governed family under `docs/specs/**`
- Update all path references in that doc from `specs/` to `docs/specs/`

### R3: Doc-graph integration
- Declare `docs/specs/**` as a governed spec family in `docs/system/doc-graph-spec.md`
- Explicitly state that `docs/specs/**` is excluded from doc-graph validation rules (separate validator)
- Specs are not wiki-linked from docs; docs may reference specs by path
- `scripts/validate-doc-graph.js` MUST skip files under `docs/specs/` during its walk, since spec files use a different frontmatter schema (`spec_id`, `title`, `type`, `status`) that is incompatible with doc-graph validation (`doc_kind`, `category`, `created`)

### R4: Update all tooling defaults
- `scripts/validate-specs.js`: default `targetPath` to `docs/specs`
- `scripts/validate-specs-precommit.mjs`: update stage filter and invocation path
- `scripts/generate-spec-index.js`: default path to `docs/specs`, write to `docs/specs/index.md`
- `scripts/install-spec-hooks.mjs`: update stage filter grep pattern
- `scripts/lib/spec-path-heuristics.js`: update `KNOWN_SOURCE_DIRS`

### R5: Update CI and repo config
- `.github/workflows/repo-ci.yml`: change `--strict specs` to `--strict docs/specs`
- `package.json` scripts: no change needed (delegates to default); verify

### R6: Update all shipped harness instructions
- `codex-assets/home/AGENTS.md`: replace all `specs/<slug>/spec.md` with `docs/specs/<slug>/spec.md`
- `opencode-assets/home/AGENTS.md`: replace all `specs/<slug>/spec.md` with `docs/specs/<slug>/spec.md`
- `opencode-assets/agents/spec.md`: replace all `specs/<slug>/spec.md` with `docs/specs/<slug>/spec.md`, update hardcoded `--strict specs` to `--strict docs/specs` (NOTE: file was later deleted during lane restructuring — this was implemented before deletion)
- `antigravity-assets/home/GEMINI.md`: replace all `specs/<spec-slug>/spec.md` with `docs/specs/<spec-slug>/spec.md`
- `engine-assets/copilot-instructions.md`: replace `specs/<spec-slug>/spec.md` with `docs/specs/<spec-slug>/spec.md`

### R7: Update shared skill catalog
- `catalog-assets/shared-skills/spec-authoring/SKILL.md`: update default durable path
- `catalog-assets/shared-skills/spec-dev/SKILL.md`: update durable path references
- `catalog-assets/shared-skills/spec-review/SKILL.md`: update path references if present

### R8: Update repo root files
- `AGENTS.md`: update orientation table `specs/` to `docs/specs/`, add concision rule

### R9: Update canonical governance docs
- `docs/system/repo-setup-governance.md`: change `specs/` → `docs/specs/` in the spec-driven overlay profile section (lines 154-178), update `specs/index.md` → `docs/specs/index.md` in bootstrap resource paths
- `docs/system/skills-governance.md`: change line 56 from `specs/<spec-slug>/spec.md` to `docs/specs/<spec-slug>/spec.md`
- `docs/system/documentation-structure-governance.md`: add concise-by-default and prune-stale-content rules (see R12 and R13 for content)
- `docs/system/index.md`: update any specs path references from `specs/` to `docs/specs/`

### R10: Update repo setup profiles
- `engine-assets/skills/repo-setup-governance/profile-definitions.json`: update `specs/index.md` to `docs/specs/index.md` in the `spec-driven` overlay profile
- `scripts/validate-repo-setup-profiles.js`: update expected `specs/index.md` to `docs/specs/index.md`
- Regenerate `engine-assets/skills/repo-setup-governance/setup-profiles.json` via `node scripts/generate-repo-setup-profiles.mjs`

### R11: Physical file migration
- Move `specs/*/spec.md` (all spec directories) to `docs/specs/*/spec.md`
- Move `specs/_templates/` to `docs/specs/_templates/`
- Remove or replace root `specs/` directory with a short redirect `specs/README.md`: "Specs have moved to `docs/specs/`. See `docs/specs/index.md`."
- Regenerate `docs/specs/index.md` via `node scripts/generate-spec-index.js`

### R12: Concision enforcement
- Add explicit rule to `AGENTS.md`: future docs and specs must be concise, map-like, and scoped to their stated purpose (no tangential exposition, no duplicated policy)
- Add the same compact rule to harness home files (`codex-assets/home/AGENTS.md`, `opencode-assets/home/AGENTS.md`, `antigravity-assets/home/GEMINI.md`)
- Promote concise writing into canonical governance (`docs/system/documentation-structure-governance.md`)

### R13: Pruning policy
- While editing existing docs/specs, delete obsolete, duplicated, inaccurate, or compatibility-only prose instead of preserving it by default
- Replace stale detail with links to the current authority
- Keep redirects only when needed for inbound path compatibility

## Non-Goals

- Full concision validator with hard-gate enforcement (warn-only first pass is in scope; hard gate is future work)
- Automated pruning of untouched docs (manual pruning during touch only)
- Changing the `elegy-planning` SQLite authority — repo-file roadmaps remain non-authoritative
- VitePress site rebuild or doc-site publishing pipeline changes
- Changing the spec file format, frontmatter schema, or validation rules beyond path updates
- Adding new spec types or changing existing spec type contracts
- Concision enforcement for existing docs/specs not touched during migration
- Backward compatibility for pre-migration external consumers (installed agent files on user machines, CI configs in other repos, bookmarks) that reference `specs/` paths — the redirect `specs/README.md` only helps human visitors to the GitHub repo

## Acceptance Checks

- All existing specs validate under the new canonical location
  → verify: run spec validator against the new location
- The generated spec index lists all migrated specs
  → verify: generate the index and confirm it exists
- Root specs directory contains only a redirect README (or is removed)
  → verify: confirm only redirect remains
- Pre-commit hook validates staged specs under the new location
  → verify: stage a spec change, run the pre-commit hook, confirm it gates correctly
- CI passes with the new path
  → verify: CI workflow references the new path and exits 0
- No hardcoded old path remains in scripts, hooks, or CI
  → verify: search for old hardcoded path — zero results
- All four harness home files reference the new path
  → verify: search harness files for old path pattern — zero matches
- Repo setup profile validates with updated spec paths
  → verify: regenerate and validate profiles — exits 0
- Catalog shared skills reference the new path
  → verify: search shared skills for old path pattern — zero matches

## Implementation Links

- `docs/specs/docs-specs-knowledge-system/spec.md` (this spec)
- `docs/specs/docs-specs-knowledge-system/plan.md` (sibling plan, to be created)
- `docs/system/spec-driven-development.md`
- `docs/system/doc-graph-spec.md`
- `docs/system/documentation-structure-governance.md`
- `docs/system/repo-setup-governance.md`
- `docs/system/skills-governance.md`
- `docs/system/index.md`
- `scripts/validate-specs.js`
- `scripts/validate-specs-precommit.mjs`
- `scripts/generate-spec-index.js`
- `scripts/install-spec-hooks.mjs`
- `scripts/lib/spec-path-heuristics.js`
- `scripts/validate-repo-setup-profiles.js`
- `scripts/validate-doc-graph.js`
- `.github/workflows/repo-ci.yml`
- `AGENTS.md`
- `codex-assets/home/AGENTS.md`
- `opencode-assets/home/AGENTS.md`
- `opencode-assets/agents/spec.md` — deleted during lane restructuring; migration work was completed before deletion
- `antigravity-assets/home/GEMINI.md`
- `engine-assets/copilot-instructions.md`
- `engine-assets/skills/repo-setup-governance/profile-definitions.json`
- `catalog-assets/shared-skills/spec-authoring/SKILL.md`
- `catalog-assets/shared-skills/spec-dev/SKILL.md`
- `catalog-assets/shared-skills/spec-review/SKILL.md`

## Validation Evidence

- All 8 specs validate at `docs/specs/`: `node scripts/validate-specs.js docs/specs` exits 0
- `docs/specs/index.md` regenerated: `node scripts/generate-spec-index.js docs/specs` exits 0
- Root `specs/` contains only redirect README: verified with `node -e "..."`
- Pre-commit hook installed with `^docs/specs/` stage filter
- CI workflow updated: `.github/workflows/repo-ci.yml` references `docs/specs`
- All harness files updated: Codex, OpenCode, Antigravity, Copilot instructions
- All catalog shared skills updated: spec-authoring, spec-dev, spec-review
- Setup profiles regenerated and validated
- Doc-graph validator skips `docs/specs/` without errors
- 20+ additional files updated (test files, bootstrap scripts, UI routes, preflight checks)

## Drift Notes

- ADR consideration: Removing the No Collision Rule and extending the doc-graph to include `docs/specs/**` as a governed-but-excluded family is a material architectural change to the knowledge model. Evaluated ADR creation and deferred — the rationale is captured in this spec and the updated governance docs (`doc-graph-spec.md`, `spec-driven-development.md`, `documentation-structure-governance.md`). No separate ADR needed.
- Cross-spec relationships: The 8 existing specs (`agentic-lanes-quality`, `align-elegy-db-assets`, `asset-sync-truthfulness`, `opencode-model-profile-ux`, `planning-explorer-view`, `planning-visibility-canonicalization`, `spec-system-hardening`, `verifiable-acceptance-criteria`) are being physically relocated from `specs/` to `docs/specs/`. Their `spec_id` values do not change. This is a filesystem relocation, not a requirements replacement — migrated specs do not need `supersedes` or `superseded_by` frontmatter changes.
