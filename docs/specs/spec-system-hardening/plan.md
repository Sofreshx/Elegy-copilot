# Implementation Plan: Spec-Driven Development System Hardening

**Spec:** `specs/spec-system-hardening/spec.md`
**Created:** 2026-06-08
**Status:** draft

---

## Overview

This plan implements R1–R10 of the spec-system-hardening spec. The goal is to make the spec-driven development system trustable and enforceable: CI gates and pre-commit hooks prevent invalid specs from landing, the spec index becomes a reliable manifest, cross-spec relationships are validated, stale specs generate warnings, shared validator code is extracted into DRY library modules, superseded specs are cleaned up, and all agents and documentation are updated to reflect the hardened pipeline.

The work is ordered into 6 phases. Phase 1 (deduplication) must come first because all subsequent validator extensions build on the shared modules. Phase 2 (extensions to `validate-specs.js --strict`) follows. Phase 3 creates the enforcement surface (CI + pre-commit) that runs the Phase 2 checks. Phases 4 and 5 (cleanup + docs) are independent of each other and can run in parallel. Phase 6 is final validation.

**Cross-spec coordination:** This spec shares implementation files with `verifiable-acceptance-criteria` (`scripts/validate-specs.js`, `catalog-assets/shared-skills/spec-review/SKILL.md`, `catalog-assets/shared-skills/spec-authoring/SKILL.md`, `opencode-assets/agents/spec.md` (deleted during lane restructuring)). This plan assumes `verifiable-acceptance-criteria` lands first, OR the two are implemented sequentially (not concurrently) to avoid merge conflicts on the shared files.

---

## Implementation Order

```
Phase 1: Foundation (R6 — Deduplicate Validators)
    → Extract shared lib modules (spec-collector.js, spec-headings.js,
      spec-path-heuristics.js, spec-yaml.js)
    → Rewrite all 4 scripts to import from shared modules
    → Run existing tests to ensure no regression
    → This must be FIRST because all subsequent validator extensions
      build on clean shared code

Phase 2: Validator Extensions (R3 + R4 + R5 + R7)
    → R3: Index integrity checks in validate-specs.js --strict
    → R4: Cross-spec integrity (supersedes resolution, circular chain
      detection, bidirectional check)
    → R5: Freshness warnings (90-day draft, 180-day implemented,
      freshness:ignore opt-out)
    → R7: plan.md requirement check (5+ requirements without plan.md → warning)
    → These are all additions to validate-specs.js --strict mode
    → They share the same file but are independent features — implement in order

Phase 3: Gates (R1 + R2)
    → R1: CI gate — add validate:specs step to repo-ci.yml
    → R2: Pre-commit hook — create validate-specs-precommit.mjs and
      install-spec-hooks.mjs
    → These create the enforcement surface for all the checks built in Phase 2

Phase 4: Content Cleanup (R8)
    → R8: Mark align-elegy-db-assets and planning-explorer-view as superseded
    → Add supersedes to planning-visibility-canonicalization
    → Regenerate index

Phase 5: Agent & Docs (R9 + R10)
    → R9: Update opencode-assets/agents/spec.md (MOOT — agent file was deleted; work absorbed into skills)
    → R10: Update spec-driven-development.md, spec-review SKILL.md,
      spec-authoring SKILL.md, AGENTS.md
    → Can run in parallel with Phase 4

Phase 6: Final Validation
    → Run validate-specs.js --strict on all specs
    → Run existing test suites (validate-specs.test.js, etc.)
    → Run ci:local
    → Manual: test pre-commit hook with a broken spec
```

---

## Step-by-Step with Estimates

**Note:** Step numbers are logical guides, not sequence locks. Steps within a phase are ordered; phases have explicit dependency rules.

### Phase 1 — Deduplicate Validators (45 min)

1. **Create `scripts/lib/spec-yaml.js`** (10 min)
   - Extract `parseFrontmatterYaml` and `parseInlineList` from `validate-specs.js`
   - Export both functions
   - Keep the original function signatures identical so callers are unaffected

2. **Create `scripts/lib/spec-collector.js`** (5 min)
   - Extract `collectSpecFiles` from `validate-specs.js`
   - Export the function with the same signature: `collectSpecFiles(specsDir)`

3. **Create `scripts/lib/spec-headings.js`** (5 min)
   - Extract `extractH2Sections` and `matchFrontmatter` from `validate-specs.js`
   - Export both functions

4. **Create `scripts/lib/spec-path-heuristics.js`** (5 min)
   - Extract `looksLikeFilePath` and `KNOWN_SOURCE_DIRS` from `validate-specs.js`
   - Export the function and the constant

5. **Rewrite `validate-specs.js`** (5 min)
   - Remove inline copies of the extracted functions
   - Add `require(...)` imports from the four new lib modules
   - Verify the module still runs: `node scripts/validate-specs.js specs/`

6. **Rewrite `validate-specs-artifact-liveness.js`** (5 min)
   - Replace inline duplicates with imports from shared lib modules
   - Verify: `node scripts/validate-specs-artifact-liveness.js specs/`

7. **Rewrite `validate-doc-graph.js`** (5 min)
    - Replace inline duplicates with imports from shared lib modules
    - **Divergence note:** `validate-doc-graph.js`'s `parseFrontmatterYaml` has extra numeric-value handling (`/^-?\d+$/`) not present in `validate-specs.js`. The shared canonical parser from `spec-yaml.js` will NOT include this numeric handling. `validate-doc-graph.js` must keep a thin wrapper around the shared parser that adds the numeric check before falling through to the shared function. The wrapper should be local to `validate-doc-graph.js`, not in the shared module.
    - Verify: `node scripts/validate-doc-graph.js`

8. **Rewrite `spec-readiness-report.js`** (5 min)
   - Replace inline duplicates with imports from shared lib modules
   - Verify: `node scripts/spec-readiness-report.js specs/`

9. **Update `generate-spec-index.js`** (5 min)
   - Replace its simplified YAML parser with `require('scripts/lib/spec-yaml.js').parseFrontmatterYaml`
   - Verify: `node scripts/generate-spec-index.js`

10. **Run regression tests** (5 min)
    - `node scripts/validate-specs.js specs/` → exit 0
    - `node scripts/validate-specs.test.js` → all pass
    - `node scripts/validate-specs-artifact-liveness.js specs/` → exit 0
    - `node scripts/validate-doc-graph.js` → exit 0
    - `node scripts/spec-readiness-report.js specs/` → exit 0

**Gate:** All regression tests pass. No script behaves differently after the refactor.

---

### Phase 2 — Validator Extensions (90 min)

**Pre-check:** Before adding new `--strict` checks, confirm all current specs pass the existing `--strict` validator (to establish a clean baseline): `node scripts/validate-specs.js --strict specs/`. Fix any pre-existing failures before proceeding. Since `package.json:21` already runs `--strict` in `validate:specs`, the new checks will fire immediately in CI — this step prevents surprise CI failures.

#### R3 — Index Integrity (20 min)

11. **Add index drift detection to `validate-specs.js --strict`** (20 min)
    - Read `specs/index.md`, parse its markdown table to extract listed spec paths
    - **Parsing strategy:** The `generate-spec-index.js` controls the index format (pipe-delimited table with 6 columns: Spec, Status, Type, Updated, Intent). Parse the table rows: skip header and separator rows, extract the first column's markdown link path (e.g., `[title](slug/spec.md)` → `slug/spec.md`). Hard-code column positions since the generator is the canonical writer. If parsing fails (unrecognized format), warn loudly rather than silently skipping — the index format should only change when `generate-spec-index.js` changes.
    - Build a Set of known spec files from `collectSpecFiles(specsDir)`
    - Compare both directions:
      - Index entries that don't have a corresponding file → error
      - Spec files that don't have an index entry → error
    - Report each mismatch as `[ERROR]   index drift: ...`
    - Use `--strict` guard so this only runs with the flag
    - Exit code 1 on any mismatch (R3.2)

#### R4 — Cross-Spec Integrity (30 min)

12. **Build spec_id resolution map** (5 min)
    - In the `--strict` block, after collecting spec files, parse each file's frontmatter
    - Build a `Map<spec_id, filepath>` from all spec files

13. **Add supersedes/superseded_by reference validation** (10 min)
    - For each spec, check that every value in `supersedes` array exists as a `spec_id` in the map
    - For each spec, check that `superseded_by` (single value) exists as a `spec_id` in the map
    - Error format: `[ERROR]   spec <id>: supersedes references unknown spec_id "<value>"`
    - Error format: `[ERROR]   spec <id>: superseded_by references unknown spec_id "<value>"`

14. **Add circular chain detection** (10 min)
    - For each spec with `supersedes`, walk the chain: A supersedes B supersedes C ...
    - When `supersedes` is an array (e.g., `[B, C]`), follow each element independently as a separate chain
    - If any spec_id appears twice in a chain walk, report: `[ERROR]   circular supersedes chain: <id> -> <id2> -> ... -> <id>`
    - Use a visited-set per chain to detect cycles
    - Example: `A supersedes [B]`, `B supersedes [C]`, `C supersedes [A, D]` → walking A→B→C→A detects the A-B-C-A cycle even though C's supersedes is an array

15. **Add bidirectional supersedes validation** (5 min)
    - If spec A has `supersedes: [B]`, verify that spec B has `superseded_by: A`
    - If spec B has `superseded_by: A`, verify that spec A has `supersedes` containing B
    - Error format: `[ERROR]   spec <id>: supersedes <other_id> but <other_id> does not have superseded_by back-reference`

#### R5 — Freshness Warnings (20 min)

16. **Add freshness warnings to `--strict`** (15 min)
    - For each spec, parse `updated` date from frontmatter
    - Calculate days since `updated` from today
    - If `status: draft` and days > 90: `[WARN]    stale draft (N days since last update)`
    - If `status: implemented` and days > 180: `[WARN]    stale implemented spec (N days, consider reviewing for drift)`
    - Respect `freshness: ignore` in frontmatter — skip freshness checks entirely for that spec
    - Warnings only — never cause exit code 1 (R5.3)

17. **Add tests for freshness edge cases** (5 min)
    - Edge: `freshness: ignore` with stale date → no warning
    - Edge: spec exactly 90 days old → no warning (must be > 90)
    - Edge: spec exactly 180 days old → no warning (must be > 180)
    - Edge: no `updated` date → skip freshness check, no error

#### R7 — Plan.md Requirement Check (20 min)

18. **Add plan.md check to `--strict`** (15 min)
    - Use `countBulletItems` (existing) to count `- R` bullets in the `## Requirements` section
    - If count >= 5 and status is draft or approved:
      - Check if `plan.md` exists as a sibling file to `spec.md`
      - If not: `[WARN]    complex spec without plan.md (N requirements)`
    - Warning only — does not cause exit code 1
    - Must not fire for `implemented` or `superseded` specs

18b. **Self-test R7 on this spec** (2 min)
    - After implementing the plan.md check, run `node scripts/validate-specs.js --strict specs/spec-system-hardening/spec.md`
    - **Verify:** NO "complex spec without plan.md" warning fires for `spec-system-hardening` (it has 10 requirements AND a `plan.md` — the check must correctly recognize the sibling file)
    - This is a critical self-test: if the counting logic is wrong or the sibling check is broken, our own spec will false-warn on itself

19. **Add tests for all new checks in `validate-specs.test.js`** (5 min)
    - Index drift: temp spec file without index entry → exit 1
    - Cross-spec: temp spec with bad supersedes reference → exit 1
    - Freshness: temp old draft spec → exit 0 with "stale draft" in output
    - Plan.md: temp spec with 6 reqs, no plan.md → exit 0 with "complex spec without plan.md" in output

**Gate:** `node scripts/validate-specs.test.js` passes with new tests added.

---

### Phase 2.5 — Portable Paths & Liveness Exclusion (R11) (30 min)

#### R11 — Portable Paths (30 min)

43. **Fix `looksLikeFilePath` regex** (5 min)
    - In `scripts/validate-specs.js`, change the Windows-path filter regex from `/^[A-Z]:\\/i` to `/^[A-Z]:[\\/]/i`
    - This catches both `C:\Users\...` and `C:/Users/...` patterns
    - Verify: `rg "\[A-Z\]:\[\\\\\\\\/\]" scripts/validate-specs.js` returns 1 match

44. **Add `liveness_skip_paths` frontmatter support** (10 min)
    - In `scripts/validate-specs.js`, add `parseSkipPaths(frontmatter)` that extracts the `liveness_skip_paths` array
    - In `checkLiveness()`, before checking a path with `fs.existsSync()`, check if it matches any skip pattern
    - Pattern matching: support exact strings, and simple globs using `minimatch` (already a repo devDependency) — `C:\Users\*\...` and `~/*` patterns
    - If a path matches a skip pattern, skip the existence check for that path
    - Verify: create a temp spec with `liveness_skip_paths: ["nonexistent-file.db"]`, reference that file in Context Evidence, run `--strict`, confirm exit 0

45. **Add `liveness_skip_paths` to `planning-visibility-canonicalization/spec.md`** (5 min)
    - Add `liveness_skip_paths` to frontmatter with patterns covering:
      - `C:\Users\*\...` (any user profile paths)
      - `C:/Users/*/...` (forward-slash variants)
      - `~/.elegy/*`, `~/.elegy/*` (home-directory paths)
    - Verify: `node scripts/validate-specs.js --strict specs/planning-visibility-canonicalization/spec.md` exits 0

46. **Add `liveness_skip_paths` to `align-elegy-db-assets/spec.md`** (5 min)
    - Add `liveness_skip_paths` to frontmatter with patterns covering:
      - `~/.elegy/*`, `~/.elegy/*`, `~/.codex/*`, `~/.config/*`
    - Verify: `node scripts/validate-specs.js --strict specs/align-elegy-db-assets/spec.md` exits 0

47. **Add liveness_skip_paths tests** (5 min)
    - In `scripts/validate-specs.test.js`, add tests:
      - Spec with `liveness_skip_paths: ["nonexistent.db"]` and a reference to `nonexistent.db` in Context Evidence → `--strict` exits 0
      - Spec without `liveness_skip_paths` and a reference to a nonexistent file → `--strict` exits 1
      - Spec with `liveness_skip_paths` using glob pattern → path matches, skipped

**Gate:** `node scripts/validate-specs.test.js` passes with new liveness_skip_paths tests. Both `planning-visibility-canonicalization` and `align-elegy-db-assets` pass `--strict` on any platform.

---

### Phase 3 — Gates (30 min)

#### R1 — CI Gate (10 min)

20. **Add `validate:specs` step to `.github/workflows/repo-ci.yml`** (10 min)
    - Add a job step after existing validation steps:
      ```yaml
      - name: Validate specs
        run: node scripts/validate-specs.js --strict specs
      ```
    - Confirm `package.json` already includes `validate:specs` in the `ci:local` script; if not, add it
    - Verify: `rg "validate:specs" .github/workflows/repo-ci.yml` returns at least 1 match

#### R2 — Pre-Commit Hook (20 min)

21. **Create `scripts/validate-specs-precommit.mjs`** (10 min)
    - Use `child_process.execSync` to run `git diff --cached --name-only --diff-filter=ACMR`
    - Filter results to only `specs/*/spec.md` files
    - If no spec files are staged, exit 0 (R2.2)
    - If spec files are staged, run `node scripts/validate-specs.js --strict specs` on the FULL `specs/` directory (R2.1). Running full-directory ensures multi-file checks (R3 index drift, R4 cross-spec integrity) produce correct results — single-file mode would miss cross-spec relationships.
    - If the validator exits non-zero, propagate the exit code and error output (R2.3)

22. **Create `scripts/install-spec-hooks.mjs`** (10 min)
    - Check if `.git/hooks/pre-commit` exists
    - If it doesn't exist: write a minimal shell script with `#!/bin/sh` shebang that invokes `node scripts/validate-specs-precommit.mjs`
    - If it exists: read it, check if it already contains the spec validation block (idempotency, R2.4)
      - If the block is present, skip
      - If the block is not present, check the hook for non-trivial structure (conditional logic, traps)
        - If complex: print warning with the existing hook content and require manual installation (document the shell block users should add)
        - If simple: append a clearly-delimited shell block (with `# BEGIN spec-validation` / `# END spec-validation` markers)
    - **Important:** The `.git/hooks/pre-commit` file must be a shell script (`#!/bin/sh`), not a Node file. The Node logic lives in `validate-specs-precommit.mjs`. The hook shell-wraps the Node call.

**Gate:** `node scripts/install-spec-hooks.mjs` runs without error. Staging a broken spec and running `node scripts/validate-specs-precommit.mjs` exits non-zero.

---

### Phase 4.5 — Content Cleanup (R8) (10 min)

48. **Create and run `scripts/migrate-superseded-specs.mjs`** (8 min)
    - A one-shot script that performs all R8 changes atomically:
      - Reads `specs/align-elegy-db-assets/spec.md`, changes `status: draft` to `status: superseded`, adds `superseded_by: planning-visibility-canonicalization` to frontmatter
      - Reads `specs/planning-explorer-view/spec.md`, changes `status: draft` to `status: superseded`, adds `superseded_by: planning-visibility-canonicalization` to frontmatter
      - Reads `specs/planning-visibility-canonicalization/spec.md`, adds `supersedes: [align-elegy-db-assets, planning-explorer-view]` to frontmatter (if not already present)
      - Uses the shared `scripts/lib/spec-yaml.js` parser for frontmatter reading/writing (Phase 1 must be complete)
    - Runs `node scripts/generate-spec-index.js` after all edits
    - Is idempotent — re-running changes nothing
    - **New file:** `scripts/migrate-superseded-specs.mjs`
    - Verify: `node scripts/migrate-superseded-specs.mjs` runs without error, then `node scripts/validate-specs.js --strict specs/` exits 0

49. **Run validator to confirm clean state** (2 min)
    - `node scripts/validate-specs.js --strict specs/` → exit 0

**Gate:** All supersedes/superseded_by cross-references are bidirectional. Index reflects new statuses.

---

### Phase 5 — Agent & Docs (25 min)

#### R9 — Spec Lane Agent Updates (15 min)

28. **R9 MOOT — `opencode-assets/agents/spec.md` deleted** (0 min)
    - The spec lane agent file was removed during lane restructuring. R9 hardening work was absorbed into `spec-authoring` skill and `project-workflow` skill. No file to update.

34. **R9 MOOT — no verify needed** (0 min)
    - Spec lane agent was deleted; no file to verify against

#### R10 — Documentation Updates (10 min)

35. **Update `docs/system/spec-driven-development.md` — R10.1** (3 min)
    - Reference freshness warnings (R5): document `freshness: ignore` key in frontmatter section
    - Reference pre-commit hook (R2): add installation step
    - Reference CI gate (R1): note that spec validation runs in CI
    - Verify: `rg "pre-commit|freshness warning|validate:specs" docs/system/spec-driven-development.md` returns matches for all three terms

36. **Update `catalog-assets/shared-skills/spec-review/SKILL.md` — R10.2** (2 min)
    - Check #12 (plan.md requirement) — reference the validator's automatic check (R7)
    - Verify: `rg "validate-specs" catalog-assets/shared-skills/spec-review/SKILL.md` returns a match referencing plan.md check

37. **Update `catalog-assets/shared-skills/spec-authoring/SKILL.md` — R10.3** (2 min)
    - Reference pre-commit hook installation as a setup step
    - Verify: `rg "install-spec-hooks" catalog-assets/shared-skills/spec-authoring/SKILL.md` returns a match

38. **Update `AGENTS.md` — R10.4** (2 min)
    - Mention the pre-commit hook for spec authors
    - Verify: `rg "pre-commit" AGENTS.md` returns a match mentioning spec pre-commit hook

**Gate:** All 4 doc/skill files contain references to the new hardening mechanisms.

---

### Phase 6 — Final Validation (10 min)

39. **Full spec validation** (3 min)
    - `node scripts/validate-specs.js --strict specs/` → exit 0, no errors
    - Review any warnings (freshness, plan.md) for correctness

40. **Run all test suites** (3 min)
    - `node scripts/validate-specs.test.js` → all pass
    - `npm run test:all` → all pass (if applicable)

41. **Run ci:local** (2 min)
    - `npm run ci:local` → exit 0

42. **Run pre-commit hook integration tests** (3 min)
    - New test file: `scripts/validate-specs-precommit.test.js`
    - Test 1: No spec files staged → exit 0
      - Mock `git diff --cached` to return non-spec files
      - Run `node scripts/validate-specs-precommit.mjs` → assert exit 0
    - Test 2: Broken spec staged → exit non-zero
      - Create a temp spec with missing required heading, stage it (mock)
      - Run precommit script → assert exit non-zero, assert stderr contains the failing spec filename
    - Test 3: All specs valid → exit 0
      - Mock all staged spec files passing validation
      - Run precommit script → assert exit 0
    - Uses `child_process.execSync` to invoke the precommit script and assert exit codes
    - **New file:** `scripts/validate-specs-precommit.test.js`

---

## Risk Points

| Risk | Mitigation |
|------|-----------|
| Shared module extraction breaks existing imports | Phased: extract to new files, update imports one script at a time, run tests after each |
| `validate-doc-graph.js` has different function signatures | Verify function signatures match before extracting; if they differ, extract only the shared subset and keep script-specific wrappers |
| Pre-commit hook conflicts with existing git hooks | `install-spec-hooks.mjs` detects non-trivial hooks and warns; requires manual install in that case |
| Existing commit-check infrastructure (`scripts/commit-check-*.mjs`, `.copilot/commit-checks.json`) may conflict with new pre-commit hook | The spec pre-commit hook coexists: it only fires when spec files are staged, runs spec validation, and exits. It is orthogonal to the existing commit-check system. No integration needed — the two systems run independently at different commit stages. |
| Cross-spec validation slow with many specs | Only 6 specs currently; build `spec_id` map once and reuse |
| Index integrity check fragile if index format changes | Parse the markdown table robustly; if parsing fails, warn (not error) |
| R9/R10 files may have diverged from what the spec assumes | Verify current content of each file before editing; adapt edits to current reality |
| `spec-review/SKILL.md` #12 may use different numbering | Search by content (`plan.md` / `plan requirement`) not by number |
| Temp specs for testing pollute the validator run | Use a temp directory outside `specs/` for test specs, or pass individual files. Clean up temp files in test teardown. |
| Machine-local paths in existing specs break CI `--strict` liveness checks | `liveness_skip_paths` frontmatter key allows per-spec opt-out; `looksLikeFilePath` regex fixed to catch forward-slash `C:/` paths; affected specs updated in Phase 2.5 |

---

## Spec Coverage Map

| Spec Requirement | Implemented In |
|-----------------|----------------|
| R1.1 | `.github/workflows/repo-ci.yml` — new `validate:specs` step |
| R1.2 | `package.json` — `ci:local` script includes `validate:specs` |
| R1.3 | GitHub Actions default behavior — non-zero exit fails the run |
| R2.1 | `scripts/validate-specs-precommit.mjs` — staged spec file detection |
| R2.2 | `scripts/validate-specs-precommit.mjs` — skip when no spec files staged |
| R2.3 | `scripts/validate-specs-precommit.mjs` — non-zero exit with file path |
| R2.4 | `scripts/install-spec-hooks.mjs` — hook installer with idempotency |
| R2.5 | `docs/system/spec-driven-development.md`, `AGENTS.md` — installation docs |
| R3.1 | `scripts/validate-specs.js` — `--strict` index drift check |
| R3.2 | `scripts/validate-specs.js` — exit code 1 on index drift |
| R3.3 | `scripts/lib/spec-yaml.js`, `scripts/generate-spec-index.js` — shared YAML parser |
| R4.1–4.3 | `scripts/validate-specs.js` — `--strict` cross-spec validation |
| R5.1–5.4 | `scripts/validate-specs.js` — `--strict` freshness warnings |
| R6.1–6.6 | `scripts/lib/*.js` (4 modules) + 4 updated scripts |
| R7.1–7.2 | `scripts/validate-specs.js` — `--strict` plan.md check |
| R8.0–8.4 | 3 spec files (`align-elegy-db-assets`, `planning-explorer-view`, `planning-visibility-canonicalization`) + regenerated index |
| R9.1–9.6 | `opencode-assets/agents/spec.md` — MOOT (agent file was deleted) |
| R10.1 | `docs/system/spec-driven-development.md` — freshness, pre-commit, CI |
| R10.2 | `catalog-assets/shared-skills/spec-review/SKILL.md` — plan.md reference |
| R10.3 | `catalog-assets/shared-skills/spec-authoring/SKILL.md` — pre-commit hook |
| R10.4 | `AGENTS.md` — pre-commit hook mention |
| R11.1 | `scripts/validate-specs.js` — `liveness_skip_paths` support |
| R11.2 | `scripts/validate-specs.js` — fixed `looksLikeFilePath` regex |
| R11.3 | `specs/planning-visibility-canonicalization/spec.md`, `specs/align-elegy-db-assets/spec.md` |
| R11.4 | `docs/system/spec-driven-development.md` — documented alongside `freshness: ignore` |

---

## Files Changed (Summary)

| File | Change Type | Phase |
|------|-------------|-------|
| `scripts/lib/spec-yaml.js` | **NEW** | 1 |
| `scripts/lib/spec-collector.js` | **NEW** | 1 |
| `scripts/lib/spec-headings.js` | **NEW** | 1 |
| `scripts/lib/spec-path-heuristics.js` | **NEW** | 1 |
| `scripts/validate-specs.js` | Modified | 1, 2 |
| `scripts/validate-specs-artifact-liveness.js` | Modified | 1 |
| `scripts/validate-doc-graph.js` | Modified | 1 |
| `scripts/spec-readiness-report.js` | Modified | 1 |
| `scripts/generate-spec-index.js` | Modified | 1 |
| `scripts/validate-specs.test.js` | Modified | 2 |
| `scripts/migrate-superseded-specs.mjs` | **NEW** | 4.5 |
| `scripts/validate-specs-precommit.mjs` | **NEW** | 3 |
| `scripts/install-spec-hooks.mjs` | **NEW** | 3 |
| `scripts/validate-specs-precommit.test.js` | **NEW** | 6 |
| `.github/workflows/repo-ci.yml` | Modified | 3 |
| `specs/align-elegy-db-assets/spec.md` | Modified | 4.5 |
| `specs/planning-explorer-view/spec.md` | Modified | 4.5 |
| `specs/planning-visibility-canonicalization/spec.md` | Modified | 4.5 |
| `specs/index.md` | Regenerated | 4.5 |
| `opencode-assets/agents/spec.md` | MOOT — deleted | 0 |
| `docs/system/spec-driven-development.md` | Modified | 5 |
| `catalog-assets/shared-skills/spec-review/SKILL.md` | Modified | 5 |
| `catalog-assets/shared-skills/spec-authoring/SKILL.md` | Modified | 5 |
| `AGENTS.md` | Modified | 5 |

---

## Dependencies Between Phases

```
Phase 1 (R6)
  ├── Phase 2 (R3, R4, R5, R7) — must have shared lib modules
  │     ├── Phase 2.5 (R11) — depends on validator extensions
  │     │     └── Phase 3 (R1, R2) — must have liveness skip for CI
  │     │             └── Phase 6 — must have gates + extensions + liveness
  │     │
  │     └── Phase 4.5 (R8) — independent, needs spec-yaml.js from Phase 1
  │             └── Phase 6 — must have cleanup done
  │
  └── Phase 5 (R9, R10) — independent, runs parallel with Phase 4.5
        └── Phase 6 — must have docs updated
```
