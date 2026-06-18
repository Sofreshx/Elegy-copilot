---
spec_id: verifiable-acceptance-criteria
title: Verifiable Acceptance Criteria
status: draft
type: contract
updated: 2026-06-04
liveness_skip_paths:
  - opencode-assets/agents/spec.md
---

# Verifiable Acceptance Criteria

## Intent

Acceptance criteria across specs and project plans must include concrete verification methods (tests, scripts, CLI commands) alongside prose descriptions. Currently, acceptance criteria are prose-only bullet lists with no structural requirement for verifiability — the spec validator only counts bullets, and the plan-pack validator defaults to warn mode for vague language. This spec mandates verifiable checks so agents and humans can prove criteria are met rather than accepting them "on vibe."

## Context Evidence

- `catalog-assets/shared-skills/spec-authoring/SKILL.md:59`: "Write at least two observable Acceptance Checks" — says "observable" but no verification structure
- `catalog-assets/shared-skills/spec-authoring/SKILL.md:104-107`: Template shows `- <observable check>` with no verification field
- `catalog-assets/shared-skills/spec-review/SKILL.md:19`: Review check #6: "Check whether Acceptance Checks are observable and specific enough to plan against" — manual only, no automated backing
- `scripts/validate-specs.js:298-302`: Enforces minimum 2 bullet items only, no quality or verification check
- `scripts/validate-planpack.js:309`: `acEnforcement: 'warn'` — default is non-blocking
- `scripts/validate-planpack.js:457`: `AC_VAGUE_TOKEN_RE` detects subjective words but only warns
- `docs/system/spec-driven-development.md:116-120`: Example acceptance checks are prose-only with no verification methods
- `opencode-assets/agents/reviewer.md:35`: "Testability — can the acceptance criteria be validated?" — manual review only
- `opencode-assets/agents/spec.md:48`: Acceptance criteria treated as a clarification boundary, no verification-gate mention

## Requirements

- **R1:** Every acceptance check bullet in a spec must include at least one `→ verify:` line immediately following it (indented 2 spaces, no blank line separator). The verify line content must be non-empty.
- **R2:** The spec validator (`scripts/validate-specs.js`) must detect verification methods and flag acceptance checks that lack them.
- **R3:** The spec validator (`scripts/validate-specs.js`) must replicate the `AC_VAGUE_TOKEN_RE` regex from `scripts/validate-planpack.js:457` verbatim and apply it to acceptance check bullet text (not verify lines), reporting errors for any matches. This is a hard error, not a warning.
- **R4:** The plan-pack validator (`scripts/validate-planpack.js`) must default `acEnforcement` to `'fail'` instead of `'warn'`.
- **R5:** The spec-authoring skill template and authoring rules must reflect the required verification method format.
- **R6:** The spec-review skill must explicitly check that each acceptance check has a concrete verification method, not just that it is "observable."
- **R7:** The spec-driven-development doc (`docs/system/spec-driven-development.md`) must show an updated example with verification methods.
- **R8:** The spec-authoring skill and reviewer agent instructions must reference verification methods in their acceptance criteria guidance.
- **R8b:** The project lane agent (`opencode-assets/agents/project.md`) must reference running acceptance verification methods as part of its validation standard (via the `project-workflow` skill).
- **R9:** Existing spec examples (the one in `docs/system/spec-driven-development.md` and any in `specs/`) are updated to the new format.

For existing specs where the implementer lacks domain knowledge to write meaningful verification methods, add a placeholder `→ verify: pending — author review needed` and do not block the change on perfect verification lines. The goal is structural compliance; content quality is the spec author's responsibility.

### Verification Marker Format

The `→ verify:` marker is the canonical way to attach a verification method to an acceptance check bullet. Rules:

- The `→ verify:` line must immediately follow its parent bullet with no blank line between them.
- The `→ verify:` line must be indented exactly 2 spaces relative to the bullet's `- ` prefix.
- The content after `→ verify:` must be non-empty and include a concrete verification method: a test command, script path, CLI invocation, or explicit manual step description.
- A single bullet may have multiple `→ verify:` lines (e.g., for automated + manual verification paths).
- The spec validator must reject any acceptance check bullet that lacks at least one `→ verify:` line.
- The `AC_VAGUE_TOKEN_RE` regex from `scripts/validate-planpack.js:457` must be replicated verbatim in the spec validator (not imported/shared — a copy maintained in `validate-specs.js`) to detect subjective language in the bullet text itself (not the verify line).

## Non-Goals

- Changing the elegy-planning `--acceptance` free-form string interface (that is a separate contract surface).
- Changing roadmap item `Acceptance:` field format (roadmap-authoring is a separate skill).
- Requiring automated test execution from acceptance criteria — the verification method is a reference, not an auto-run trigger.
- Changing the plan-pack work unit `#### Acceptance Criteria` format — the format stays the same (bullets only, no `→ verify:` marker). Only the enforcement default changes from `warn` to `fail`.
- Mandating a specific tool or framework for verification — any CLI command, test runner invocation, script path, or explicit manual step description is acceptable as long as it is concrete.

## Acceptance Checks

- [ ] New or updated specs include `→ verify:` lines under each acceptance check bullet
  → verify: `node scripts/validate-specs.js` passes on all specs in the repo after updating them to the new format
- [ ] Spec validator reports error (exit 1) when an acceptance check lacks a `→ verify:` line
  → verify: create a temp spec with a bullet lacking a verify line, run `node scripts/validate-specs.js` on it, confirm exit code 1 with message containing "missing verification method"
- [ ] Spec validator reports error (exit 1) for vague/subjective language in acceptance check text
  → verify: create a temp spec with "should be good" and "proper handling" in acceptance check bullets, run `node scripts/validate-specs.js` on it, confirm exit code 1 with messages flagging the vague tokens
- [ ] Plan-pack validator defaults to fail mode for AC enforcement (not just warnings)
  → verify: `node scripts/validate-planpack.js` on a plan-pack with vague acceptance criteria exits with code 1; verify by checking line 309 of the script shows `acEnforcement: 'fail'`
- [ ] Spec-authoring SKILL.md template includes `→ verify:` lines and authoring rule requires them
  → verify: `rg "→ verify:" catalog-assets/shared-skills/spec-authoring/SKILL.md` returns at least 2 matches (template + rule)
- [ ] Spec-review SKILL.md check #6 explicitly requires verification methods, not just "observable"
  → verify: `rg -i "verification method|verify line|concrete check" catalog-assets/shared-skills/spec-review/SKILL.md` returns at least 1 match
- [ ] Spec-driven-development doc example includes `→ verify:` lines
  → verify: `rg "→ verify:" docs/system/spec-driven-development.md` returns at least 1 match
- [ ] Spec lane agent Phase 4 Verify mentions running acceptance verification methods — MOOT (spec lane agent was deleted)
  → verify: spec lane agent was removed; hardening absorbed into `spec-authoring` skill
- [ ] Reviewer agent spec-review mode mentions verification methods in testability check
  → verify: `rg -i "verification method|verify line" opencode-assets/agents/reviewer.md` returns at least 1 match
- [ ] Project lane agent references acceptance verification methods in its validation standard
  → verify: `rg -i "acceptance.*verif|verify.*acceptance|verification method" opencode-assets/agents/project.md` returns at least 1 match

## Implementation Links

- `catalog-assets/shared-skills/spec-authoring/SKILL.md`
- `catalog-assets/shared-skills/spec-review/SKILL.md`
- `scripts/validate-specs.js`
- `scripts/validate-planpack.js`
- `docs/system/spec-driven-development.md`
- `opencode-assets/agents/spec.md` — deleted during lane restructuring; R8 work was absorbed into skills
- `opencode-assets/agents/reviewer.md`
- `opencode-assets/agents/project.md`

## Validation Evidence

- Pending implementation.

## Drift Notes

- R3: clause "replicate verbatim (not imported/shared — a copy maintained in validate-specs.js)" overridden by shared module. The `AC_VAGUE_TOKEN_RE` is now exported from `scripts/lib/ac-vague-tokens.js` and imported by both `validate-specs.js` and `validate-planpack.js`. This eliminates copy-drift risk with no behavioral change. See spec-contract-evolution implementation.
