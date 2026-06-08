# Implementation Plan: Docs / Specs Knowledge System Enhancement

**Spec:** `specs/docs-specs-knowledge-system/spec.md`  
**Date:** 2026-06-08  
**Phases:** 6 ordered phases with validation gates

---

## Phase Dependency Graph

```
Phase A (Governance docs) ──┐
Phase B (Tooling code)    ──┼──→ Phase E (File migration) ──→ Phase F (CI/Hooks) ──→ Phase G (Final validation)
Phase C (Shipped assets)  ──┤
Phase D (Setup profiles)  ──┘
```

Phases A–D are independent and can run concurrently. Phase E requires the tooling code update from Phase B (for `generate-spec-index.js` default path). Phase F requires the files to be in `docs/specs/`. Phase G requires everything.

---

## Phase A: Governance Docs + Concision Rules

**Depends on:** nothing  
**Files changed:** 5 canonical docs  
**Spec coverage:** R2, R3, R9, R12, R13

### A1: Rewrite spec-driven-development.md (R2)
- **File:** `docs/system/spec-driven-development.md`
- Remove the "Specs and Docs Relationship" section (lines ~237-263) containing the No Collision Rule
- Replace with: "Specs live under `docs/specs/**` as a governed spec family. They are validated by `scripts/validate-specs.js`, not by the doc-graph validator."
- Update all remaining path references: `specs/<spec-slug>/spec.md` → `docs/specs/<spec-slug>/spec.md`
- Update the spec index path: `specs/index.md` → `docs/specs/index.md`
- Update pre-commit hook reference: `specs/` → `docs/specs/`

### A2: Update doc-graph-spec.md (R3)
- **File:** `docs/system/doc-graph-spec.md`
- In the directory layout section (line ~24), add: `docs/specs/**` — governed spec family; excluded from doc-graph validation (uses separate `validate-specs.js` validator)
- Clarify: specs are not wiki-linked from docs; docs may reference specs by path

### A3: Update validate-doc-graph.js (R3.x)
- **File:** `scripts/validate-doc-graph.js`
- In the `walkDir` or file collection logic, add a skip for paths starting with `docs/specs/`
- Spec files use incompatible frontmatter (`spec_id`, `title`, `type` vs `doc_kind`, `category`, `created`) and must not be validated by the doc-graph validator

### A4: Update documentation-structure-governance.md (R9, R13)
- **File:** `docs/system/documentation-structure-governance.md`
- Add "Concision Rule" section: docs and specs must be concise, map-like, and scoped to their stated purpose — no tangential exposition, no duplicated policy
- Add "Pruning Policy" section: when editing existing docs/specs, delete obsolete, duplicated, or inaccurate content instead of preserving it; replace stale detail with links to the current authority; keep redirects only when needed for inbound path compatibility
- Update any `specs/` path references to `docs/specs/`

### A5: Update remaining governance docs (R9)
- **File:** `docs/system/repo-setup-governance.md`
  - In the spec-driven overlay profile section (~lines 154-178), change `specs/` → `docs/specs/`, `specs/index.md` → `docs/specs/index.md`
- **File:** `docs/system/skills-governance.md`
  - Line ~56: `specs/<spec-slug>/spec.md` → `docs/specs/<spec-slug>/spec.md`
- **File:** `docs/system/index.md`
  - Update any `specs/` path references to `docs/specs/`

**Validation gate A:** `node scripts/validate-doc-graph.js` (expects `docs/specs/` to be excluded from errors)

---

## Phase B: Tooling Code Defaults

**Depends on:** nothing  
**Files changed:** 5 scripts  
**Spec coverage:** R4

### B1: Update validate-specs.js (R4)
- **File:** `scripts/validate-specs.js`
- Line ~125: Change default `targetPath` from `path.join(process.cwd(), 'specs')` to `path.join(process.cwd(), 'docs/specs')`
- Line ~739: Update `validateSpecsRoot` default path similarly
- The script still accepts an explicit path argument — only the *default* changes

### B2: Update generate-spec-index.js (R4)
- **File:** `scripts/generate-spec-index.js`
- Line ~121: Change default path from `path.join(process.cwd(), 'specs')` to `path.join(process.cwd(), 'docs/specs')`
- Line ~123: Output path is already `path.join(targetPath, 'index.md')` → will write to `docs/specs/index.md`

### B3: Update spec-path-heuristics.js (R4)
- **File:** `scripts/lib/spec-path-heuristics.js`
- Line ~18: Change `KNOWN_SOURCE_DIRS` from `['specs']` to `['docs/specs', 'specs']` (support both during transition)

### B4: Update install-spec-hooks.mjs (R4)
- **File:** `scripts/install-spec-hooks.mjs`
- Line ~27: Change stage filter regex from `/^specs\/[^/]*\/spec\\.md$/` to `/^docs\/specs\/[^/]*\/spec\\.md$/`
- The hook installs into `.git/hooks/pre-commit` — existing installed hooks on this machine will need reinstallation

### B5: Update validate-specs-precommit.mjs (R4)
- **File:** `scripts/validate-specs-precommit.mjs`
- Line ~44: Change stage filter from `/^specs\/[^/]+\/spec\.md$/` to `/^docs\/specs\/[^/]+\/spec\.md$/`
- Line ~53: Change invocation path from `specs` to `docs/specs`

**Validation gate B:** `node scripts/validate-specs.js --help` (confirm default path); `node scripts/generate-spec-index.js --help` (confirm default path)

---

## Phase C: Shipped Assets + Root Files

**Depends on:** nothing  
**Files changed:** 10 files  
**Spec coverage:** R6, R7, R8, R12

### C1: Update copilot instructions (R6)
- **File:** `engine-assets/copilot-instructions.md`
- Line ~116: `specs/<spec-slug>/spec.md` → `docs/specs/<spec-slug>/spec.md`
- Same change in `.github/copilot-instructions.md` (GitHub mirror — keep in sync)

### C2: Update Codex home instructions (R6)
- **File:** `codex-assets/home/AGENTS.md`
- Replace all occurrences of `specs/<spec-slug>/spec.md` with `docs/specs/<spec-slug>/spec.md`
- Replace all occurrences of `specs/<slug>/spec.md` with `docs/specs/<slug>/spec.md`

### C3: Update OpenCode home instructions (R6)
- **File:** `opencode-assets/home/AGENTS.md`
- Replace all occurrences of `specs/<spec-slug>/spec.md` with `docs/specs/<spec-slug>/spec.md`
- Replace all occurrences of `specs/<slug>/spec.md` with `docs/specs/<slug>/spec.md`

### C4: Update OpenCode spec lane agent (R6)
- **File:** `opencode-assets/agents/spec.md`
- Replace all `specs/<slug>/spec.md` → `docs/specs/<slug>/spec.md`
- Replace all `specs/<slug>/plan.md` → `docs/specs/<slug>/plan.md`
- Replace `--strict specs` → `--strict docs/specs` (lines ~48, 69, 76)

### C5: Update Antigravity home instructions (R6)
- **File:** `antigravity-assets/home/GEMINI.md`
- Line ~14: `specs/<spec-slug>/spec.md` → `docs/specs/<spec-slug>/spec.md`

### C6: Update shared skill catalog (R7)
- **File:** `catalog-assets/shared-skills/spec-authoring/SKILL.md`
  - Update default durable path from `specs/<spec-slug>/spec.md` to `docs/specs/<spec-slug>/spec.md`
  - Update `specs/index.md` → `docs/specs/index.md`
- **File:** `catalog-assets/shared-skills/spec-dev/SKILL.md`
  - Update `specs/<slug>/spec.md` → `docs/specs/<slug>/spec.md`
- **File:** `catalog-assets/shared-skills/spec-review/SKILL.md`
  - Update any `specs/` path references to `docs/specs/`

### C7: Update repo root files (R8)
- **File:** `AGENTS.md`
  - Orientation table: `specs/` → `docs/specs/`
  - Add concision rule (R12): "Future docs and specs must be concise, map-like, and scoped to their stated purpose (no tangential exposition, no duplicated policy)."
- **File:** `guidelines.md`
  - Line ~36: `specs/<slug>/spec.md + specs/index.md` → `docs/specs/<slug>/spec.md + docs/specs/index.md`

### C8: Add concision rules to harness home files (R12)
- **Files:** `codex-assets/home/AGENTS.md`, `opencode-assets/home/AGENTS.md`, `antigravity-assets/home/GEMINI.md`
- Add: "Keep instruction surfaces compact. Future specs and docs must be concise, map-like, and scoped to their stated purpose."

**Validation gate C:** `rg "specs/<" codex-assets/home/ opencode-assets/home/ opencode-assets/agents/spec.md antigravity-assets/home/GEMINI.md engine-assets/copilot-instructions.md .github/copilot-instructions.md catalog-assets/shared-skills/spec-*/ AGENTS.md guidelines.md` returns zero matches for old path pattern in updated files

---

## Phase D: Setup Profiles

**Depends on:** nothing  
**Files changed:** 2 files + 1 regenerated  
**Spec coverage:** R10

### D1: Update profile definitions (R10)
- **File:** `engine-assets/skills/repo-setup-governance/profile-definitions.json`
- In the `spec-driven` overlay profile: replace `specs/index.md` with `docs/specs/index.md` in `requiredResourcePaths` and `recommendedResourcePaths`

### D2: Update profile validator expectations (R10)
- **File:** `scripts/validate-repo-setup-profiles.js`
- Update hardcoded expected values: `specs/index.md` → `docs/specs/index.md` (~lines 27-42)

### D3: Regenerate setup profiles (R10)
- Run: `node scripts/generate-repo-setup-profiles.mjs`
- This regenerates `engine-assets/skills/repo-setup-governance/setup-profiles.json`

**Validation gate D:** `node scripts/validate-repo-setup-profiles.js` exits 0

---

## Phase E: Physical File Migration

**Depends on:** Phase B (tooling defaults) for `generate-spec-index.js`  
**Files changed:** 8 specs moved + index generated + redirect created  
**Spec coverage:** R11

### E1: Move spec directories to docs/specs/
```bash
git mv specs/_templates docs/specs/_templates
git mv specs/agentic-lanes-quality docs/specs/agentic-lanes-quality
git mv specs/align-elegy-db-assets docs/specs/align-elegy-db-assets
git mv specs/asset-sync-truthfulness docs/specs/asset-sync-truthfulness
git mv specs/docs-specs-knowledge-system docs/specs/docs-specs-knowledge-system
git mv specs/planning-explorer-view docs/specs/planning-explorer-view
git mv specs/planning-visibility-canonicalization docs/specs/planning-visibility-canonicalization
git mv specs/spec-system-hardening docs/specs/spec-system-hardening
git mv specs/verifiable-acceptance-criteria docs/specs/verifiable-acceptance-criteria
```

### E2: Create redirect README at old location
- **File:** `specs/README.md`
- Content: "Specs have moved to `docs/specs/`. See [`docs/specs/index.md`](docs/specs/index.md)."

### E3: Remove old index
```bash
git rm specs/index.md
```

### E4: Regenerate spec index at new location
```bash
node scripts/generate-spec-index.js docs/specs
```
This creates `docs/specs/index.md` listing all migrated specs.

**Validation gate E:** 
- `node scripts/validate-specs.js --strict docs/specs` exits 0 (all migrated specs valid at new location)
- `node -e "const fs=require('fs');if(!fs.existsSync('specs')){process.exit(0)};const entries=fs.readdirSync('specs').filter(e=>e!=='README.md');process.exit(entries.length?1:0)"` exits 0 (only redirect remains)

---

## Phase F: CI + Pre-commit Invocation Paths

**Depends on:** Phase E (files must be at docs/specs/)  
**Files changed:** 2 files  
**Spec coverage:** R5

### F1: Update CI workflow (R5)
- **File:** `.github/workflows/repo-ci.yml`
- Line ~58: Change `node scripts/validate-specs.js --strict specs` to `node scripts/validate-specs.js --strict docs/specs`

### F2: Reinstall pre-commit hooks
- **Pre-step:** Manually remove the `# BEGIN spec-validation` / `# END spec-validation` block from `.git/hooks/pre-commit` (the installer exits early if the marker already exists and will not overwrite a previously-installed hook). Use:
  ```bash
  node -e "const fs=require('fs');const h=fs.readFileSync('.git/hooks/pre-commit','utf8');const re=/# BEGIN spec-validation[\s\S]*?# END spec-validation\n?/g;fs.writeFileSync('.git/hooks/pre-commit',h.replace(re,''))"
  ```
- Run: `node scripts/install-spec-hooks.mjs`
- This installs `.git/hooks/pre-commit` with the new stage filter pattern (`^docs/specs/`, already updated in Phase B4)

**Validation gate F:** 
- `.github/workflows/repo-ci.yml` line 58 references `docs/specs`
- The pre-commit hook's stage filter matches `^docs/specs/` paths

---

## Phase G: Final Validation

**Depends on:** Phases A-F  
**Spec coverage:** All acceptance checks

### G1: Run spec validation
```bash
node scripts/validate-specs.js --strict docs/specs
```

### G2: Run doc-graph validation
```bash
node scripts/validate-doc-graph.js
```

### G3: Run setup profile validation
```bash
node scripts/generate-repo-setup-profiles.mjs && node scripts/validate-repo-setup-profiles.js
```

### G4: Verify no stale paths remain
```bash
rg "[\"']specs[\"']" scripts/ .github/workflows/
```

### G5: Verify harness files updated
```bash
rg "specs/<" codex-assets/home/ opencode-assets/home/ opencode-assets/agents/spec.md antigravity-assets/home/GEMINI.md engine-assets/copilot-instructions.md .github/copilot-instructions.md catalog-assets/shared-skills/spec-*/
```

### G6: Full CI run
```bash
npm run ci:local
```

### G7: Install spec hooks for this repo
```bash
node scripts/install-spec-hooks.mjs
```

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| CI breaks between Phase E (file move) and Phase F (CI path update) | High | High | E and F should be committed together or F immediately follows E in the same PR |
| Pre-commit hook rejects commits during transition | Medium | Medium | Phase B4 updates the hook installer; Phase F2 reinstalls. Between B and F, old specs/ files can still be committed at old path |
| External consumers (bookmarks, other repos) reference old paths | Low | Low | Declared Non-Goal; redirect README is the mitigation |
| validate-doc-graph.js breaks on docs/specs/ content before Phase A3 | High | Medium | Phase A3 is in Phase A and runs before any spec files exist under docs/ |
| Spec authors working in other branches have specs/ files | Medium | Low | They'll get merge conflicts; `git mv` preserves history |

---

## Rollback Plan

If the migration fails:
1. `git revert` the migration commit(s) to restore `specs/` at root
2. Revert all script defaults back to `specs/`
3. Reinstall pre-commit hooks with old paths via `node scripts/install-spec-hooks.mjs`
4. No data loss — all content is preserved in git history
