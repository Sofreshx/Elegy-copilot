---
created: 2026-06-29
updated: 2026-06-29
category: research
status: current
doc_kind: node
id: skills-agents-md-and-implementation-handoff-audit
summary: Focused quality audit of the shared agents-md-authoring skill and the shared plus Codex implementation-handoff skills.
tags: [skills, audit, quality, agents-md-authoring, implementation-handoff]
related: [skills-governance, concise-instruction-governance, shipped-skill-quality-audit]
---

# Skill Quality Audit

Targets:

- `catalog-assets/shared-skills/agents-md-authoring/SKILL.md`
- `catalog-assets/shared-skills/implementation-handoff/SKILL.md`
- `codex-assets/skills/implementation-handoff/SKILL.md`

Authorities:

- `docs/system/concise-instruction-governance.md`
- `docs/system/skills-governance.md`
- `catalog-assets/shared-skills/CATALOG-GOVERNANCE.md`
- `catalog-assets/shared-skills/writing-great-skills/SKILL.md`
- `catalog-assets/shared-skills/skill-authoring/SKILL.md`

## Summary

Overall result: the skills are directionally strong, but the evaluated directories still do not meet the catalog's per-skill trigger-test rule.

The Codex-specific `implementation-handoff` variant is materially better than the shared version at completion gating and executor calibration. The duplicate-name governance conflict called out in the initial audit has since been resolved through an approved metadata-backed exception in catalog governance and shipped-skill diagnostics.

## Scorecard

| Target | Trigger Quality | Workflow Determinism | Signal Density | Governance Compliance | Cross-Surface Consistency | Status |
|---|---:|---:|---:|---:|---:|---|
| `agents-md-authoring` | 4/5 | 4/5 | 3/5 | 3/5 | 5/5 | needs tightening |
| shared `implementation-handoff` | 4/5 | 4/5 | 4/5 | 3/5 | 2/5 | needs tightening |
| Codex `implementation-handoff` | 5/5 | 5/5 | 4/5 | 4/5 | 2/5 | ready with governance follow-up |

## Findings

### Medium

#### [SKILL-001] Duplicate `implementation-handoff` name governance conflict was resolved after the initial audit
- Category: `rule_drift`
- Location:
  - `catalog-assets/shared-skills/implementation-handoff/SKILL.md:2`
  - `codex-assets/skills/implementation-handoff/SKILL.md:2`
  - `catalog-assets/shared-skills/CATALOG-GOVERNANCE.md`
  - `docs/system/skills-governance.md`
- Description:
  - The initial audit found that the shared and Codex variants both used `name: implementation-handoff` while catalog governance still banned duplicate skill names outright.
  - The repo now documents a narrow approved exception for harness-specialized variants and encodes it in `metadata.allowedDuplicateNameGroup`.
  - `node scripts/analyze-shipped-skill-quality.mjs --no-write-md` no longer reports `duplicate-name` diagnostics for this pair.
- Recommendation:
  - Keep the exception narrow.
  - Reuse the same metadata-backed pattern only for deliberate shared-invocation, harness-specialized variants.

#### [SKILL-002] Per-skill trigger tests are missing in all evaluated directories
- Category: `rule_drift`
- Location:
  - `catalog-assets/shared-skills/agents-md-authoring/`
  - `catalog-assets/shared-skills/implementation-handoff/`
  - `codex-assets/skills/implementation-handoff/`
- Description:
  - Catalog governance rule 10 requires each skill directory to include a local `trigger-evals.md` test file.
  - The repo has a shared `catalog-assets/shared-skills/TRIGGER-TESTS.md`, but these target directories do not contain local trigger-eval files.
  - Current automation does not fail on this gap, so this is both a skill finding and a validator blind spot.
- Recommendation:
  - Add per-skill `trigger-evals.md` test files for these skills, or
  - relax the governance rule to permit the shared catalog-level trigger test surface and document that exception explicitly.

#### [SKILL-003] Shared `implementation-handoff` is weaker than the Codex variant on completion gating
- Category: `improvement`
- Location: `catalog-assets/shared-skills/implementation-handoff/SKILL.md:20-107`
- Description:
  - The shared skill has a solid workflow and output contract, but it does not define a named completeness gate.
  - It says to turn a plausible plan into an executor-ready brief, yet it leaves readiness more implicit than explicit.
  - The Codex variant adds plan classification, review escalation through `rubberduck-plan-review`, and a concrete completeness gate.
  - Under `CATALOG-GOVERNANCE.md` rule 8, the Codex version is safer because "done" is directly testable.
- Recommendation:
  - Backport a lightweight completeness gate to the shared skill.
  - Keep the Codex-only strictness if needed, but make shared completion criteria explicit.

### Low

#### [SKILL-004] `agents-md-authoring` carries avoidable doctrine that the baseline instructions already own
- Category: `improvement`
- Location: `catalog-assets/shared-skills/agents-md-authoring/SKILL.md:150-161`
- Description:
  - The authority table and conflict rule are useful, but they restate doctrine already carried by the shared baseline and repo governance docs.
  - `docs/system/skills-governance.md` says shared skills should narrow active constraints instead of copying standing rule families.
  - This does not make the skill wrong, but it costs signal density in a file that is already 217 lines long.
- Recommendation:
  - Compress the surface/authority section to one short rule and one link.
  - Keep the file focused on discovery behavior, authoring guidance, and verification.

#### [SKILL-005] `agents-md-authoring` mixes strong reference material with weaker harness-verification guidance
- Category: `improvement`
- Location: `catalog-assets/shared-skills/agents-md-authoring/SKILL.md:163-179`
- Description:
  - The discovery and authoring sections are concrete and high-value.
  - The verification section becomes less precise outside Codex: `OpenCode` and `Antigravity` checks are presented as short UI hints rather than the same level of deterministic validation given to Codex.
  - This weakens the "same authoring rules across harnesses" claim in the opening section.
- Recommendation:
  - Either tighten cross-harness verification to the same evidence standard, or
  - mark those checks as best-effort and route to the owning harness docs for exact verification steps.

## Strengths

### `agents-md-authoring`

- The description is strong: concrete nouns, clear trigger phrases, and good front-loading.
- The discovery precedence section is actionable and model-usable.
- The authoring rules are scoped to what agents cannot reliably infer.

### shared `implementation-handoff`

- The skill has one coherent job and stays read-only.
- The workflow is concise and ordered.
- The output contract is easy to reuse in another session.

### Codex `implementation-handoff`

- The trigger section is sharper than the shared version.
- The plan classification and `rubberduck-plan-review` escalation close a real failure mode.
- The completeness gate is the strongest piece across all evaluated skills.

## Evidence

Commands:

- `npm run validate:skills`
- `node scripts/analyze-shipped-skill-quality.mjs --no-write-md`
- `git diff --no-index -- catalog-assets/shared-skills/implementation-handoff/SKILL.md codex-assets/skills/implementation-handoff/SKILL.md`
- `rg --files catalog-assets/shared-skills/agents-md-authoring catalog-assets/shared-skills/implementation-handoff codex-assets/skills/implementation-handoff`

Observed facts:

- `npm run validate:skills` passes, but it checks only a subset of governance rules.
- The shipped-skill analyzer currently reports two issues: the duplicate `implementation-handoff` name pair.
- The checked target directories contain no local `trigger-evals.md` test files.

## Recommended Fix Order

1. Add or formally replace per-skill trigger-test coverage.
2. Backport an explicit completion gate into shared `implementation-handoff`.
3. Trim duplicated doctrine from `agents-md-authoring`.
4. Tighten or downgrade the non-Codex verification claims in `agents-md-authoring`.
