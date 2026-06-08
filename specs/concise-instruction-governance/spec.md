---
spec_id: concise-instruction-governance
title: Repo-Agnostic Concise Instruction Governance
status: draft
type: contract
updated: 2026-06-08
liveness_skip_paths:
  - "docs/system/concise-instruction-governance.md"
  - "scripts/validate-guidelines-wiring.mjs"
  - "docs/**.md"
---

# Repo-Agnostic Concise Instruction Governance

## Intent

Replace `guidelines.md` with a sharper, repo-agnostic entrypoint that enforces concise writing, precise vocabulary, explicit clarification before implementation, and harness-wide references — backed by canonical docs, validation, and a UI setup/status check. The new `guidelines.md` serves as a universal instruction contract, not an Elegy Copilot-specific policy.

## Context Evidence

- `guidelines.md` (46 lines) — current repo-rules overlay with precedence table, core rules, doc sync rules; is compact but frames itself as repo-specific, not a universal writing-standards authority
- `docs/system/project-conventions-governance.md` (292 lines) — defines `guidelines.md` as a lightweight entrypoint that cannot outrank canonical docs, and provides the authority precedence model
- `docs/system/documentation-authoring-governance.md` (128 lines) — governs page quality, progressive disclosure, drift resistance; does not cover instruction-writing vocabulary standards
- `docs/system/documentation-structure-governance.md` (252 lines) — governs IA and entrypoints; no unified "instruction governance" node exists
- `docs/system/self-documenting-code-and-rationale-placement.md` (86 lines) — decision matrix for code vs comments vs docs vs ADRs vs instruction surfaces
- `AGENTS.md` (54 lines) — root entrypoint; step 1: "Load `guidelines.md` for repo-specific rules and precedence"
- `engine-assets/copilot-instructions.md` — references `guidelines.md` as secondary overlay (lines 132, 141)
- `engine-assets/agents/impl.agent.md` — must load nearest `guidelines.md` alongside canonical bootstrap (line 23)
- `codex-assets/home/AGENTS.md` — references `guidelines.md` as lighter local overlay (line 110)
- `opencode-assets/home/AGENTS.md` — mentions `guidelines.md` for target-repo conventions (line 9)
- `antigravity-assets/home/GEMINI.md` — does NOT reference `guidelines.md` at all — gap identified
- `scripts/validate-installed-governance-wiring.test.js` (97 lines) — test-only; no main validator script; checks only 2 governance snippets across 10 files, not `guidelines.md` content or harness coverage
- `scripts/validate-doc-graph.js` (500 lines) — validates `docs/**.md` frontmatter/links; does not validate `guidelines.md` or harness references
- `copilot-ui/ui/src/lib/types.ts` (lines 3425-3505) — existing `OpenCodeSetupCheck` type with `status: 'ok'|'warning'|'blocked'` and `overallStatus: 'ready'|'degraded'|'blocked'` patterns proven in OpenCodeView
- No existing spec for instruction governance as a unified discipline
- `engine-assets/skills/concise-writing/SKILL.md` (98 lines) — the existing enforcement tool for word budgets and banned phrases; relevant as a complementary enforcement mechanism, not modified by this spec

## Requirements

### R1 — New `guidelines.md` Content

Replace `guidelines.md` with a repo-agnostic entrypoint that:
- Defines concise instruction standards: exact vocabulary, diagrams/tables/checklists over prose, banned empty language, section question requirements
- Defines clarification contract: never implement through ambiguity; clarify when uncertainty affects scope, architecture, data, destruction, cost, UX, acceptance, validation, ownership, or security
- Defines planning contract: load sources, identify authority, state goal/criteria, separate facts from assumptions, resolve ambiguity, choose smallest path, define validation
- Defines documentation shape (top-down routing: README/guidelines → index → MOC → node)
- Defines harness rule: every harness must reference this contract with one compact sentence
- Defines review rule: flag instruction drift, vague abstractions, duplicated policy, unclear authority, missing clarification
- Defines validation rule: run narrowest relevant check after changes
- Defines core workflow table (Bootstrap → Discovery → Clarification → Planning → Implementation → Review → Validation)

### R2 — Canonical Doc Node

Create a new canonical documentation node `docs/system/concise-instruction-governance.md` that:
- Is the canonical authority for instruction-writing standards
- Contains the concise instruction contract (use/avoid table, writing rules, empty language ban, section question requirements)
- Contains the clarification contract (when to clarify, good vs bad examples)
- Contains the planning contract (pre-implementation steps)
- Is linked from `docs/system/index.md` (under "Most Useful Entry Docs")
- Is linked from `docs/system/mocs/conventions-and-governance.md` (under conventions MOC)
- Has proper frontmatter (created, updated, category: system, status: current, doc_kind: node, id, summary, tags, related)
- Has a routing section explaining when to use this node vs other governance nodes
- Has an output contract block for reporting instruction governance work

### R3 — Harness References

Add one-line `guidelines.md` references to every managed harness:
- `antigravity-assets/home/GEMINI.md` — add the recommended pointer (currently missing entirely)
- `opencode-assets/home/AGENTS.md` — verify existing reference is adequate; update to recommended pointer if needed
- `codex-assets/home/AGENTS.md` — verify existing reference; update if needed
- `engine-assets/copilot-instructions.md` — verify existing references; update if needed
- `.github/copilot-instructions.md` — verify existing references; update if needed
- `AGENTS.md` (root) — update step 1 to include the concise/clarification contract pointer

Recommended pointer format:
```
Follow `guidelines.md`: clarify ambiguity before implementation; write concise, precise, diagram-forward instructions; avoid vague or ceremonial prose.
```

### R4 — Guidelines Validator

Create `scripts/validate-guidelines-wiring.mjs` that:
- Checks that `guidelines.md` exists at repo root and is non-empty
- Checks that every managed harness surface (AGENTS.md root, engine-assets/copilot-instructions.md, codex-assets/home/AGENTS.md, opencode-assets/home/AGENTS.md, antigravity-assets/home/GEMINI.md, .github/copilot-instructions.md) references `guidelines.md` (case-insensitive search for "guidelines.md")
- Reports status per harness: `pass`, `missing`, `stale` (if reference exists but is not the recommended pointer format)
- Exits 1 if any harness is `missing`, exits 0 otherwise
- Accepts `--fix` flag that writes a recommended pointer into any missing harness file
  - When `--fix` encounters a `stale` reference (file references `guidelines.md` but not in recommended format), it replaces the existing reference line with the recommended pointer format
  - When `--fix` encounters a `pass` reference, it does nothing
  - Supports `--json` flag for machine-readable output (returns structured JSON; used by setup status derivation per R6)
- Is callable standalone and from CI

### R5 — CI Integration

Wire the guidelines validator into CI:
- Add `validate:guidelines-wiring` to `package.json` scripts: `"node scripts/validate-guidelines-wiring.mjs"`
- Add `validate:guidelines-wiring` to `npm run ci:local` (which already exists at `package.json` line ~28)
- Ensure `.github/workflows/repo-ci.yml` includes the check
- When validation fails, CI must fail

### R6 — Setup/Status Item

Add an instruction governance status item to the Elegy Copilot setup dashboard:
- New `setupCheck` with id `instruction-governance` or similar
- `ready`: `guidelines.md` exists AND all harness references are present
- `degraded`: `guidelines.md` exists but one or more harness references are missing or stale
- `blocked`: `guidelines.md` is missing
- Status is derived from the `validate-guidelines-wiring.mjs` validator output (JSON mode)
- Extend the existing OpenCode status endpoint (`/api/opencode/status` or nearest equivalent in `copilot-ui/server.js`) to include this check in the `setupChecks` array with response shape: `{ id: "instruction-governance", label: "Instruction Governance", status: "ok"|"warning"|"blocked", detail: string }`
- Show in the OpenCode readiness dashboard (OpenCodeView or similar)

### R7 — External Practices Reference

The `guidelines.md` and canonical doc must reference external writing practices:
- Google Developer Documentation Style Guide (clear, precise language, active voice)
- Microsoft Writing Style Guide (simple words, concise sentences)
- Diátaxis framework (separate tutorials, how-to guides, reference, explanation)
- Sources included as links, not inlined

### R8 — Existing Spec Update

Update `specs/index.md` to include the new spec. Run `node scripts/generate-spec-index.js` after spec file is created.

## Non-Goals

- Rewriting all existing canonical docs to match the concise standard (scope: only the new `concise-instruction-governance.md` node)
- Changing the `guidelines.md` authority precedence model (stays as layer 3, below user instruction and canonical docs)
- Removing the `doc sync rules` table from guidelines.md (keep as operational guidance)
- Adding instruction governance status to the ClaudeCode, Codex, or Antigravity dashboards (scope: OpenCode dashboard only)
- Creating a new MOC for instruction governance (reuse existing `conventions-and-governance` MOC)
- Rewriting the `concise-writing` skill (it exists and works; link from new doc, don't modify)

## Acceptance Checks

- `guidelines.md` matches the new content contract (concise instruction standards, clarification contract, planning contract, harness rule, review rule, validation rule, core workflow, key links)
  → verify: `node scripts/validate-guidelines-wiring.mjs` exits 0 and reports `guidelines.md` as `present`
  → verify: `rg -c "clarify ambiguity before implementation" guidelines.md` returns ≥1 (content contract present)
- `docs/system/concise-instruction-governance.md` exists with valid frontmatter, all required sections, and routing guidance
  → verify: `node scripts/validate-doc-graph.js docs/system/concise-instruction-governance.md` passes
- All harness surfaces (6 files) reference `guidelines.md`
  → verify: `node scripts/validate-guidelines-wiring.mjs` exits 0 with zero `missing` harnesses
- `docs/system/index.md` links to the new canonical node
  → verify: `rg "concise-instruction-governance" docs/system/index.md` returns a match
- `docs/system/mocs/conventions-and-governance.md` links to the new canonical node
  → verify: `rg "concise-instruction-governance" docs/system/mocs/conventions-and-governance.md` returns a match
- CI includes `validate:guidelines-wiring`
  → verify: `rg "validate-guidelines-wiring" .github/workflows/repo-ci.yml package.json` returns matches in BOTH files
- Setup status endpoint returns instruction governance check
  → verify: `node scripts/validate-guidelines-wiring.mjs --json` outputs JSON with `setupChecks` array containing an entry where `.id === "instruction-governance"`
- `specs/index.md` includes the new spec
  → verify: `rg "concise-instruction-governance" specs/index.md` returns a match

## Implementation Links

- `guidelines.md` — replace
- `docs/system/concise-instruction-governance.md` — create
- `docs/system/index.md` — update (add link)
- `docs/system/mocs/conventions-and-governance.md` — update (add link)
- `antigravity-assets/home/GEMINI.md` — update (add reference)
- `opencode-assets/home/AGENTS.md` — verify/update reference
- `codex-assets/home/AGENTS.md` — verify/update reference
- `engine-assets/copilot-instructions.md` — verify/update reference
- `.github/copilot-instructions.md` — verify/update reference
- `AGENTS.md` — update step 1
- `scripts/validate-guidelines-wiring.mjs` — create
- `package.json` — add script
- `.github/workflows/repo-ci.yml` — add CI step
- `copilot-ui/server.js` or status route — add instruction governance check
- `specs/index.md` — regenerate

## Validation Evidence

- (pending — will populate after implementation)

## Drift Notes

- Does not supersede any existing spec
- Complements `verifiable-acceptance-criteria` (spec_id: verifiable-acceptance-criteria) — all acceptance checks must use concrete verification methods
