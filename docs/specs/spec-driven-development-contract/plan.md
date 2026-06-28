# Spec-Driven Development Contract — Implementation Plan

## Overview

Establish `docs/specs/spec-driven-development-contract/spec.md` as the single normative source of truth for the durable spec contract. Thin downstream consumers (canonical doc, 4 spec skills) to reference this spec instead of duplicating the contract inline. Update the validator to enforce new requirements surfaced by this spec. Promote stale draft specs to their correct status.

## Phases

### Phase 1 — Normative Spec (this file)
- [ ] Create `spec.md` with all 13 requirements
- [ ] Create `plan.md` (this file)
- [ ] Run `validate-specs.js --strict` on the new spec — fix all errors

### Phase 2 — Validator Enhancement
- [ ] Verify validator enforces all Forbidden Behavior constraints
- [ ] Add check: unique `spec_id` across all specs (R2.2)
- [ ] Add check: `### Allowed Behavior` and `### Forbidden Behavior` subsections present (R5)
- [ ] Update test suite with new test cases
- [ ] Run `node scripts/validate-specs.test.js` — all pass

### Phase 3 — Thin Canonical Doc
- [ ] Thin `docs/system/spec-driven-development.md` — remove duplicated contract, add reference to this spec
- [ ] Keep: validation layers, pre-commit hook, CI gate, operating model instructions
- [ ] Bump `updated` date

### Phase 4 — Thin Spec Skills
- [ ] Refactor `catalog-assets/shared-skills/spec-authoring/SKILL.md` — remove inline contract (lines 19-53), replace with reference
- [ ] Refactor `catalog-assets/shared-skills/spec-review/SKILL.md` — update check #1 to reference normative spec
- [ ] Refactor `catalog-assets/shared-skills/spec-dev/SKILL.md` — minor reference update
- [ ] Refactor `catalog-assets/shared-skills/spec-planning-bridge/SKILL.md` — reference R10 for file-scope grammar

### Phase 5 — Skill Consistency Normalization
- [ ] Add `spec_contract` frontmatter field to all 4 spec skills
- [ ] Ensure consistent heading structure across all 4 skills
- [ ] Ensure output contract format consistency

### Phase 6 — Promote Stale Drafts
- [ ] Promote `verifiable-acceptance-criteria` → `superseded` (superseded_by this spec)
- [ ] Promote `spec-system-hardening` → `approved`
- [ ] Resolve drift in `docs/specs/verifiable-acceptance-criteria/spec.md`

### Phase 7 — Normative Specs for Load-Bearing Pieces
- [ ] Create `docs/specs/skill-governance-contract/spec.md`
- [ ] Create `docs/specs/reviewer-lane-contract/spec.md`
- [ ] Create `docs/specs/commit-validation-contract/spec.md`
- [ ] Create `docs/specs/documentation-structure-contract/spec.md`
- [ ] Create `docs/specs/agent-routing-contract/spec.md`

### Phase 8 — Wire Everything Together
- [ ] Regenerate `docs/specs/index.md`
- [ ] Update `AGENTS.md`
- [ ] Update harness appendix files
- [ ] Update spec-driven instruction template

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Validator rejects new spec due to unhandled edge case | Medium | Low | Fix validator before promoting spec |
| Cross-reference break when changing supersedes chains | Low | High | Run full validation after each edit |
| Skill drift after refactoring | Medium | Medium | Run implementation-review on each skill change |
| Index regeneration overwrites manual changes | Medium | Low | Commit before regenerating |

## Validation

- `node scripts/validate-specs.js --strict docs/specs` — must pass
- `node scripts/validate-specs.test.js` — all 16+ tests must pass
- `npm run ci:local` — full CI must pass
- Manual review of each changed file for instruction drift
