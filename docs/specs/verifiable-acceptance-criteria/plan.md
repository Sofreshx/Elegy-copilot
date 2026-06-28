# Implementation Plan: Verifiable Acceptance Criteria

## Spec
`docs/specs/verifiable-acceptance-criteria/spec.md`

## Overview
Add concrete verification methods to acceptance criteria across the elegy-copilot codebase. The core change is a `→ verify:` marker format that pairs each acceptance check with a test command, script, or manual step. Validators are upgraded to enforce this, skills and agents are updated to reference it, and existing specs are migrated.

## Implementation Order

The order is structured so that validators (the enforcement mechanism) are upgraded first, then the docs/skills/agents that reference them are updated, and finally existing specs are migrated. This ensures every step can be validated as we go.

### Step 0: Pre-flight checks

Before any implementation, verify the environment:
- Check if plan-pack validator is used in CI: `Select-String -Path "*.yml","*.yaml","package.json" -Pattern "validate-planpack" -Recurse`. If found, note the locations so we can monitor for breakage after Step 1.
- Run the current spec validator to capture baseline: `node scripts/validate-specs.js docs/specs/` — expected to fail on `align-elegy-db-assets` (invalid status/type, missing headings) and possibly others. Capture the output as baseline.
- Confirm Node.js is available: `node --version`

### Step 1: Upgrade plan-pack validator default (R4) — 1 line change
**File:** `scripts/validate-planpack.js`
**Change:** Line 309: `acEnforcement: 'warn'` → `acEnforcement: 'fail'`
**Validation:** Running the plan-pack validator on an existing plan-pack (if one exists in the repo) — this is informational since existing plan-packs may have vague AC. If no plan-pack exists, verify the constant changed.
**Risk:** Low — one character change.

### Step 2: Add verification method detection to spec validator (R2)
**File:** `scripts/validate-specs.js`
**Changes:**
- Add new function `parseAcceptanceChecksWithVerify(sectionText)` that:
  - Splits the `## Acceptance Checks` section into bullet items (like `countBulletItems` does)
  - For each bullet, checks whether the next non-blank line is an indented `→ verify:` line (2-space indent, no blank line separating)
  - Returns an array of `{ bulletText, verifyLines: string[], lineNumber }` objects
- Add new function `validateAcceptanceChecks(checks)` that:
  - Flags any bullet with zero verify lines: error "Acceptance check at line N lacks a verification method (→ verify: ...)"
  - Flags verify lines with empty content after the colon
- Wire the new validation into `validateSpecFile()`, calling it after the existing bullet count check
- The existing `countBulletItems` check (minimum 2) is preserved — the new check is additive
**Validation:** Create a temporary spec with prose-only acceptance checks, run `node scripts/validate-specs.js` on it, confirm exit code 1.
**Risk:** Medium — new parsing logic; must handle edge cases (blank lines within verify blocks, nested bullets, code blocks in verify content).

### Step 3: Add vague language detection to spec validator (R3)
**File:** `scripts/validate-specs.js`
**Changes:**
- Add constant `AC_VAGUE_TOKEN_RE` (copied verbatim from `scripts/validate-planpack.js:457`)
- In the new `validateAcceptanceChecks` function (or a companion), check each bullet text (not verify lines) against `AC_VAGUE_TOKEN_RE`
- Report error for any match: "Acceptance check at line N contains vague language: '${token}'"
- This is a hard error, not a warning (unlike plan-pack's historical warn mode)
**Validation:** Create a temp spec with "should be good" in acceptance checks, run validator, confirm exit code 1.
**Risk:** Low — well-tested pattern already in use in plan-pack validator.

### Step 4: Update spec-authoring skill (R5)
**File:** `catalog-assets/shared-skills/spec-authoring/SKILL.md`
**Changes:**
- Authoring rule line 59: Change "Write at least two observable Acceptance Checks." to "Write at least two Acceptance Checks, each with a concrete verification method using the `→ verify:` marker."
- Template lines 106-107: Change from:
  ```
  - <observable check>
  - <observable check>
  ```
  to:
  ```
  - <observable behavior>
    → verify: <test command, script path, or manual steps>
  - <observable behavior>
    → verify: <test command, script path, or manual steps>
  ```
- Add a reference to the "Verification Marker Format" section in the spec-driven-development doc or inline the rules
**Validation:** `rg "→ verify:" catalog-assets/shared-skills/spec-authoring/SKILL.md` returns at least 2 matches.
**Risk:** Low — template-only change.

### Step 5: Update spec-review skill (R6)
**File:** `catalog-assets/shared-skills/spec-review/SKILL.md`
**Changes:**
- Review check #6 line 19: Change "Check whether `Acceptance Checks` are observable and specific enough to plan against." to "Check whether each `Acceptance Check` has a concrete verification method (`→ verify:` line) and whether vague language is absent."
**Validation:** `rg -i "verification method|verify line|concrete check" catalog-assets/shared-skills/spec-review/SKILL.md` returns at least 1 match.
**Risk:** Low — one sentence change.

### Step 6: Update spec-driven-development doc (R7)
**File:** `docs/system/spec-driven-development.md`
**Changes:**
- Update the example spec section (lines 116-120) to include `→ verify:` lines:
  ```
  ## Acceptance Checks
  
  - Expired access tokens refresh without forcing re-login when the refresh token is valid.
    → verify: `npm test -- --grep "session refresh"`
  - Invalid refresh tokens force the existing signed-out path.
    → verify: `npm test -- --grep "invalid refresh token"`
  ```
- Update the validation section (around line 210) to mention the new verification method check
**Validation:** `rg "→ verify:" docs/system/spec-driven-development.md` returns at least 1 match.
**Risk:** Low — example-only change.

### Step 7: Update project-workflow skill (R8)
**File:** `opencode-assets/skills/project-workflow/SKILL.md`
**Changes:**
- Validation Standard section: Add a bullet about running acceptance verification methods. For example: "Run spec acceptance verification methods (e.g., the `→ verify:` commands from the spec)."
**Validation:** `rg -i "acceptance.*verif|verify.*acceptance|verification method" opencode-assets/skills/project-workflow/SKILL.md` returns at least 1 match.
**Risk:** Low — guidance-only change.

### Step 8: Update reviewer agent (R8)
**File:** `opencode-assets/agents/reviewer.md`
**Changes:**
- Spec-review mode section (lines 31-36): Update "Testability — can the acceptance criteria be validated?" to "Testability — does each acceptance criterion have a concrete verification method (e.g., `→ verify:` line with a test command or script)?"
**Validation:** `rg -i "verification method|verify line" opencode-assets/agents/reviewer.md` returns at least 1 match.
**Risk:** Low — one phrase change.

### Step 9: Update project lane agent (R8b)
**File:** `opencode-assets/agents/project.md`
**Changes:**
- Add a bullet to the Validation Standard section (lines 116-124): "Run acceptance verification methods defined in work unit acceptance criteria (e.g., `→ verify:` commands from work unit specs)."
**Validation:** `rg -i "acceptance.*verif|verify.*acceptance|verification method" opencode-assets/agents/project.md` returns at least 1 match.
**Risk:** Low — one bullet addition to the existing list.

### Step 10: Migrate existing specs to new format (R9)

Three existing specs need updating. They fall into two categories:

#### Step 10a: Simple migration — add `→ verify:` lines (2 specs)

**Files:** `docs/specs/planning-explorer-view/spec.md`, `docs/specs/agentic-lanes-quality/spec.md`

These specs already have compliant structure (valid status/type, all required headings, proper `## Acceptance Checks` section). For each:
- Read the existing acceptance check bullets
- Add `→ verify:` lines referencing the test commands, scripts, or validation steps already described in the spec's own `Validation Evidence` or `Test Plan` sections
- Where verification methods are clear from context, write concrete `→ verify:` lines
- Where domain knowledge is lacking, use placeholder: `→ verify: pending — author review needed`
- The goal is structural compliance; content quality is the spec author's responsibility

**Risk:** Low — additive change only. `countBulletItems` is preserved since verify lines don't start with `-` or `*`.

#### Step 10b: Structural fix — `align-elegy-db-assets` (1 spec)

**File:** `docs/specs/align-elegy-db-assets/spec.md`

This spec has multiple pre-existing compliance issues that must be fixed BEFORE adding `→ verify:` lines. Issues found:
- `status: proposed` → must be `draft`, `approved`, `implemented`, or `superseded` (VALID_STATUS). Change to `status: draft`.
- `type: fix` → must be `feature`, `workflow`, `contract`, `skill`, `agent`, or `migration` (VALID_TYPES). Change to `type: workflow` (it describes process fixes).
- Missing `## Non-Goals` heading — extract existing non-goal content from individual requirement subsections into a top-level section.
- Missing `## Acceptance Checks` heading — collect acceptance criteria currently embedded under `### R1` through `### R4` subsections into a single `## Acceptance Checks` section, rewriting them as bullets with `→ verify:` lines.
- Missing `## Implementation Links` heading — add with `None.` placeholder.
- Missing `## Validation Evidence` heading — add with `Pending implementation.` placeholder.
- Missing `## Drift Notes` heading — add with `None.` placeholder.
- Existing `## Test Plan` and `## Assumptions` sections — these are non-standard. Move `## Test Plan` content into `## Validation Evidence` (or keep it as-is, just ensure required headings exist). Move `## Assumptions` content into `## Context Evidence` (or add a note that it complements context). The validator only enforces required heading presence, not absence of extra headings, so keeping them is acceptable as long as all 8 required headings exist.

**Risk:** Medium — requires understanding the spec's domain to properly extract and rewrite acceptance criteria. Mitigation: run `node scripts/validate-specs.js specs/align-elegy-db-assets/spec.md` before and after changes to track progress.

### Step 10 pre-check: Baseline validation

Before making any changes to existing specs, run:
```
node scripts/validate-specs.js specs/
```
Capture the exact error output. This serves as a pre-migration baseline. After all Step 10 changes, run it again — the diff should show only the pre-existing `align-elegy-db-assets` issues resolved, and no new errors introduced.

### Step 11: Final validation — run spec's own acceptance checks

After Steps 1-10 are complete, verify each acceptance check from `docs/specs/verifiable-acceptance-criteria/spec.md`. If `rg` (ripgrep) is not available on this Windows environment, use PowerShell equivalents (`Select-String` with the same patterns).

11a. Structural compliance:
- [ ] `node scripts/validate-specs.js specs/` exits 0 (all specs pass, including migrated ones)

11b. Validator enforcement (manual tests with temp specs):
- [ ] Create a temp spec at `docs/specs/__test-missing-verify/spec.md` with a bullet lacking `→ verify:`. Run `node scripts/validate-specs.js specs/__test-missing-verify/spec.md`. Confirm exit code 1 with message about "missing verification method."
- [ ] Create a temp spec at `docs/specs/__test-vague-ac/spec.md` with "should be good" and "proper handling" in acceptance check bullets. Run `node scripts/validate-specs.js specs/__test-vague-ac/spec.md`. Confirm exit code 1 with messages flagging vague tokens.
- [ ] After tests pass, delete both `docs/specs/__test-missing-verify/` and `docs/specs/__test-vague-ac/` directories.

11c. Plan-pack validator:
- [ ] Verify `scripts/validate-planpack.js` line 309 reads `acEnforcement: 'fail'` (not `'warn'`).

11d. Skill and doc content checks (using PowerShell `Select-String` since `rg` may not be available):
- [ ] `Select-String -Path "catalog-assets/shared-skills/spec-authoring/SKILL.md" -Pattern "→ verify:" | Measure-Object | Select-Object -ExpandProperty Count` — assert >= 2
- [ ] `Select-String -Path "catalog-assets/shared-skills/spec-review/SKILL.md" -Pattern "verification method|verify line|concrete check" | Measure-Object | Select-Object -ExpandProperty Count` — assert >= 1
- [ ] `Select-String -Path "docs/system/spec-driven-development.md" -Pattern "→ verify:" | Measure-Object | Select-Object -ExpandProperty Count` — assert >= 1
- [ ] `Select-String -Path "opencode-assets/agents/spec.md" -Pattern "acceptance.*verif|verify.*acceptance|verification method" | Measure-Object | Select-Object -ExpandProperty Count` — assert >= 1 (NOTE: spec lane agent was deleted; acceptance verification was absorbed into `spec-authoring` skill)
- [ ] `Select-String -Path "opencode-assets/agents/reviewer.md" -Pattern "verification method|verify line" | Measure-Object | Select-Object -ExpandProperty Count` — assert >= 1
- [ ] `Select-String -Path "opencode-assets/agents/project.md" -Pattern "acceptance.*verif|verify.*acceptance|verification method" | Measure-Object | Select-Object -ExpandProperty Count` — assert >= 1

11e. Cleanup:
- [ ] Delete temp spec directories created in 11b.

## Risk Summary

| Risk | Severity | Mitigation |
|------|----------|------------|
| Verification parser edge cases (blank lines, code blocks, nested bullets) | Medium | Write focused test cases against temp specs before finalizing |
| Existing specs may have hidden issues (invalid status, missing content) | Medium | Validate before and after migration |
| Plan-pack validator mode change breaks existing CI | Low | Check if any CI uses plan-pack validator before changing default |
| `rg` not available on Windows for some acceptance checks | Low | Document fallback or use `Select-String` equivalent |
