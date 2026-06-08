# Implementation Plan: Concise Instruction Governance

Spec source: `specs/concise-instruction-governance/spec.md`
Spec ID: `concise-instruction-governance`
Target worktree root: `C:\Users\lolzi\.local\share\opencode\worktree\GitHub-instruction-engine\spec\concise-instruction-governance`

## Phases

### Phase 1 — Core Content & Canonical Doc (R1, R2, R7)
**Dependencies:** None
**Exit criteria:** `guidelines.md` replaced, canonical doc created, docs/index.md linked

Files:
- `guidelines.md` — replace with new content
- `docs/system/concise-instruction-governance.md` — create canonical node
- `docs/system/index.md` — add link under Most Useful Entry Docs
- `docs/system/mocs/conventions-and-governance.md` — add link

**Implementation steps:**
0. Read engine-assets/skills/concise-writing/SKILL.md to align vocabulary and banned-phrase lists between the new guidelines.md and the existing enforcement skill.
1. Replace `guidelines.md` with the new repo-agnostic content (concise instruction contract, clarification contract, planning contract, documentation shape, harness rule, review rule, validation rule, core workflow, key links, external practices per R7 — Google Developer Documentation Style Guide, Microsoft Writing Style Guide, Diátaxis framework — as links, not inlined)
2. Create `docs/system/concise-instruction-governance.md` with:
   - Proper frontmatter (created, updated, category: system, status: current, doc_kind: node, id, summary, tags, related)
   - Purpose section
   - Concise instruction contract: use/avoid table, writing rules, banned empty language, section question requirements
   - Clarification contract: when to clarify (ambiguity affecting scope, architecture, data, destruction, cost, UX, acceptance, validation, ownership, security), good vs bad examples
   - Planning contract: load sources, identify authority, state goal/criteria, separate facts from assumptions, resolve ambiguity, choose smallest path, define validation
   - Routing section explaining when to use this node vs other governance nodes (project-conventions-governance.md, documentation-authoring-governance.md, documentation-structure-governance.md, self-documenting-code-and-rationale-placement.md, concise-writing skill)
   - Output contract block for reporting instruction governance work
   - Reference to external practices (R7)
3. Add `docs/system/concise-instruction-governance.md` link to `docs/system/index.md` under Most Useful Entry Docs (per R2)
4. Add link to `docs/system/mocs/conventions-and-governance.md` (per R2)
5. Run `node scripts/validate-doc-graph.js docs/system/concise-instruction-governance.md` to verify doc graph compliance

**Spec references:** R1 (lines 36–47), R2 (lines 48–59), R7 (lines 108–113)

### Phase 2 — Validator & CI (R4, R5, R8)
**Dependencies:** Phase 1 (validator checks guidelines.md content)
**Exit criteria:** Validator exits 0, CI passes

Files:
- `scripts/validate-guidelines-wiring.mjs` — complete stub implementation (--fix write logic, --json output, setupChecks)
- `package.json` — add script
- `.github/workflows/repo-ci.yml` — add CI step
- `specs/index.md` — regenerate

**Implementation steps:**
6. Complete the stub implementation of `scripts/validate-guidelines-wiring.mjs` that:
   - Checks `guidelines.md` exists at repo root and is non-empty (R4)
   - Checks all 6 harness surfaces reference `guidelines.md` (case-insensitive search): AGENTS.md (root), engine-assets/copilot-instructions.md, codex-assets/home/AGENTS.md, opencode-assets/home/AGENTS.md, antigravity-assets/home/GEMINI.md, .github/copilot-instructions.md
   - Reports status per harness: `pass`, `missing`, `stale` (if reference exists but not recommended pointer format per R3: `Follow \`guidelines.md\`: clarify ambiguity before implementation; write concise, precise, diagram-forward instructions; avoid vague or ceremonial prose.`)
    - Supports `--fix` flag: writes recommended pointer into missing files; replaces stale reference line with recommended pointer on stale files; no-op on passing files (R4). When a file references guidelines.md on multiple lines, --fix replaces only the FIRST line containing guidelines.md with the recommended pointer format, and removes subsequent guideline reference lines (to prevent duplicate references).
   - Supports `--json` flag for machine output (R6 requires this for status derivation)
   - Exits 1 on any `missing`, exits 0 otherwise (R4)
(Note: a detection-only stub exists at scripts/validate-guidelines-wiring.mjs with RECOMMENDED_POINTER, MANAGED_HARNESSES, basic --json output, and setupChecks array, but the --fix write logic is not implemented.)
7. Add `"validate:guidelines-wiring": "node scripts/validate-guidelines-wiring.mjs"` to `package.json` scripts (R5)
8. Insert `node scripts/validate-guidelines-wiring.mjs &&` after `node scripts/validate-doc-graph.js &&` in the ci:local chain (in the validate family, before builds)
9. Add `validate:guidelines-wiring` step to `.github/workflows/repo-ci.yml`, ensuring CI fails when validation fails (R5)
10. Run `node scripts/generate-spec-index.js` to regenerate `specs/index.md` (R8)

**Spec references:** R4 (lines 76–86), R5 (lines 88–94), R8 (lines 115–117)

### Phase 3 — Harness Wiring (R3)
**Dependencies:** Phase 1 (guidelines.md must exist to reference)
**Exit criteria:** All 6 harness surfaces reference guidelines.md, validator exits 0

Files:
- `antigravity-assets/home/GEMINI.md` — add reference (currently missing per context evidence)
- `opencode-assets/home/AGENTS.md` — verify/update reference
- `codex-assets/home/AGENTS.md` — verify/update reference
- `engine-assets/copilot-instructions.md` — verify/update reference
- `.github/copilot-instructions.md` — verify/update reference
- `AGENTS.md` (root) — update step 1

**Implementation steps:**
11. Add recommended pointer to `antigravity-assets/home/GEMINI.md` (identified gap in context evidence line 27: "does NOT reference guidelines.md at all")
12. Verify `opencode-assets/home/AGENTS.md` already references guidelines.md; update to recommended pointer format if needed (R3)
13. Verify `codex-assets/home/AGENTS.md` already references guidelines.md; update to recommended pointer format if needed (R3)
14. Verify `engine-assets/copilot-instructions.md` already references guidelines.md; update to recommended pointer format if needed (R3)
15. Verify `.github/copilot-instructions.md` already references guidelines.md; update to recommended pointer format if needed (R3)
16. Update `AGENTS.md` step 1 to include concise/clarification contract pointer (currently step 1: "Load `guidelines.md` for repo-specific rules and precedence"; update to reference the new universal contract)
17. Run `node scripts/validate-guidelines-wiring.mjs` — expect exit 0
**Note:** Step 17 depends on Phase 2's full validator implementation (--fix, --json). If Phase 3 wiring edits are done before Phase 2 completes, defer this validation step until Phase 2 is complete.

**Spec references:** R3 (lines 61–74), Acceptance Checks (lines 135–136)

### Phase 4 — Setup Status Item (R6)
**Dependencies:** Phase 2 (validator must exist for status derivation)
**Exit criteria:** Status endpoint returns instruction-governance check

Files:
- `copilot-ui/routes/opencode.js` (buildSetupChecks function at line ~257) — add instruction governance check
- `copilot-ui/ui/src/lib/types.ts` — add setup check type entry
- `copilot-ui/ui/src/tabs/OpenCode/OpenCodeView.tsx` — display the check

**Implementation steps:**
18. Add server-side logic: derive instruction-governance status by calling `node scripts/validate-guidelines-wiring.mjs --json` and mapping results:
    - `ready`: guidelines.md exists AND all harness references are present (validator exit 0, no missing/stale)
    - `degraded`: guidelines.md exists but one or more harness references are missing or stale
    - `blocked`: guidelines.md is missing
    - Status derivation matches R6 (lines 98–103)
19. Add setup check type for `instruction-governance` with id, label, and status fields, following existing `OpenCodeSetupCheck` pattern (types.ts lines 3425–3505 per context evidence)
20. Wire into the OpenCode readiness dashboard display in OpenCodeView.tsx, following existing check rendering patterns (R6 scope: OpenCode dashboard only per Non-Goals)
21. Run `node scripts/validate-guidelines-wiring.mjs --json` and verify the output format includes `setupChecks` array with entry where `.id === "instruction-governance"` per acceptance check

**Spec references:** R6 (lines 96–106), Non-Goals (line 123 — OpenCode dashboard only), Acceptance Checks (lines 143–144)

### Phase 5 — Validation & Cleanup
**Dependencies:** All previous phases
**Exit criteria:** All validators pass, all tests pass

**Implementation steps:**
22. Run `node scripts/validate-guidelines-wiring.mjs` — expect exit 0, zero missing harnesses
23. Run `node scripts/validate-doc-graph.js docs/system/concise-instruction-governance.md` — expect pass (valid frontmatter, valid links)
24. Run `node scripts/validate-specs.js specs/concise-instruction-governance/spec.md` — expect pass
25. Run `npm run ci:local` — expect pass (or at minimum the subset of checks available; note that unrelated failures may exist)
26. Verify all acceptance checks from spec (lines 130–146):
    - `rg -c "clarify ambiguity before implementation" guidelines.md` ≥ 1
    - `rg "concise-instruction-governance" docs/system/index.md` returns a match
    - `rg "concise-instruction-governance" docs/system/mocs/conventions-and-governance.md` returns a match
    - `rg "validate-guidelines-wiring" .github/workflows/repo-ci.yml package.json` returns matches in BOTH files
    - `node scripts/validate-guidelines-wiring.mjs --json` outputs JSON with `setupChecks` containing entry `.id === "instruction-governance"`
    - `rg "concise-instruction-governance" specs/index.md` returns a match

**Spec references:** Acceptance Checks (lines 128–146)

## Dependency Graph

```
Phase 1 (Content + Doc)
    ├── Phase 2 (Validator + CI)
    │       ├── Phase 4 (Setup Status)
    │       └── Phase 5 (Validation)
    └── Phase 3 (Harness Wiring)
```

Phase 1 has no dependencies and must be executed first — it creates the core content that all other phases depend on.

Phase 2 depends on Phase 1 (validator checks guidelines.md exists and has content). Phase 2 must complete before Phase 4 (setup status needs the validator with --json flag).

Phase 3 depends only on Phase 1 (harnesses need to reference existing guidelines.md). It is independent of Phase 2 and can be parallelized.

Phase 4 depends on Phase 2 (status derivation calls the validator with --json).

Phase 5 depends on all previous phases — it validates the complete picture.

## Files Changed (Complete Inventory)

| # | File | Action | Phase |
|---|------|--------|-------|
| 1 | `guidelines.md` | Replace | 1 |
| 2 | `docs/system/concise-instruction-governance.md` | Create | 1 |
| 3 | `docs/system/index.md` | Edit | 1 |
| 4 | `docs/system/mocs/conventions-and-governance.md` | Edit | 1 |
| 5 | `scripts/validate-guidelines-wiring.mjs` | Create | 2 |
| 6 | `package.json` | Edit | 2 |
| 7 | `.github/workflows/repo-ci.yml` | Edit | 2 |
| 8 | `specs/index.md` | Regenerate | 2 |
| 9 | `antigravity-assets/home/GEMINI.md` | Edit | 3 |
| 10 | `opencode-assets/home/AGENTS.md` | Verify/Edit | 3 |
| 11 | `codex-assets/home/AGENTS.md` | Verify/Edit | 3 |
| 12 | `engine-assets/copilot-instructions.md` | Verify/Edit | 3 |
| 13 | `.github/copilot-instructions.md` | Verify/Edit | 3 |
| 14 | `AGENTS.md` (root) | Edit | 3 |
| 15 | `copilot-ui/routes/opencode.js` (buildSetupChecks function at line ~257) | Edit | 4 |
| 16 | `copilot-ui/ui/src/lib/types.ts` | Edit | 4 |
| 17 | `copilot-ui/ui/src/tabs/OpenCode/OpenCodeView.tsx` | Edit | 4 |

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Harness file format mismatch (--fix may break non-markdown files) | Low | Medium | Test --fix on each harness individually; use exact line matching and only insert/replace lines, never rewrite full files |
| UI setup status route doesn't exist in current copilot-ui/routes/opencode.js | Medium | Medium | Explore existing routes before implementation (context evidence shows OpenCodeSetupCheck pattern exists in types.ts); may need new route or extend existing endpoint |
| guidelines.md content too long for a single entrypoint | Low | Low | Keep content contract-focused; delegate detail to canonical doc `docs/system/concise-instruction-governance.md` per spec design (R1 delegates to R2) |
| ci:local may fail from unrelated issues | Medium | Low | Isolate changes; run targeted validators first (`validate-guidelines-wiring.mjs`, `validate-doc-graph.js`, `validate-specs.js`) before full ci:local; document unrelated failures |
| Validator --fix writes to files not yet ready in Phase 2 (when Phase 3 hasn't run) | Low | Medium | Design --fix to handle missing files gracefully; verify target file exists before attempting to edit |
| `specs/index.md` regeneration may not exist or may fail | Medium | Low | Verify `scripts/generate-spec-index.js` exists and works before Phase 2 step 10; have manual fallback if script unavailable |
| acceptance-check `rg` patterns may match in unexpected locations (e.g., spec.md itself) | Low | Low | Use specific patterns with full path constraints; document exact rg commands to run for each check |
| Phase 4 UI files may have moved or changed structure | Medium | Medium | Inventory current copilot-ui route/component structure before editing; prefer additive changes to existing patterns |
| Multi-reference files (e.g., copilot-instructions.md has 2 guideline references) complicates --fix | Medium | Low | --fix replaces first reference, removes subsequent ones; test on copilot-instructions.md specifically |

## Validation Commands (Per Phase)

### Phase 1
```powershell
node scripts/validate-doc-graph.js docs/system/concise-instruction-governance.md
rg -c "clarify ambiguity before implementation" guidelines.md
rg "concise-instruction-governance" docs/system/index.md
rg "concise-instruction-governance" docs/system/mocs/conventions-and-governance.md
```

### Phase 2
```powershell
node scripts/validate-guidelines-wiring.mjs
node scripts/validate-guidelines-wiring.mjs --json
node scripts/validate-guidelines-wiring.mjs --fix
node scripts/generate-spec-index.js
rg "validate-guidelines-wiring" .github/workflows/repo-ci.yml package.json
rg "concise-instruction-governance" specs/index.md
```

### Phase 3
```powershell
node scripts/validate-guidelines-wiring.mjs
node scripts/validate-guidelines-wiring.mjs --fix
```

### Phase 4
```powershell
node scripts/validate-guidelines-wiring.mjs --json
```

### Phase 5
```powershell
node scripts/validate-guidelines-wiring.mjs
node scripts/validate-doc-graph.js docs/system/concise-instruction-governance.md
node scripts/validate-specs.js specs/concise-instruction-governance/spec.md
npm run ci:local
```
