---
spec_id: skill-governance-contract
title: Skill Governance Contract
status: draft
type: contract
updated: 2026-06-30
---

# Skill Governance Contract

## Intent

Define the authoritative contract for skill format, lifecycle, triage model, and quality bar. Every skill in this system MUST conform to this contract. This spec is the normative source of truth; skill docs and validators derive their requirements from it.

## Context Evidence

- `docs/system/skills-governance.md` — currently the canonical doc for skill quality and lifecycle. This spec will become the normative authority.
- `docs/system/repo-skill-sync-governance.md` — defines repo-local skill mirror authority: `.github/skills/` is the sole editable source; harness mirrors (`.opencode/skills/`, `.agents/skills/`) are generated compatibility surfaces.
- `catalog-assets/shared-skills/` — 30+ shared skills; source of truth for cross-harness skills.
- `scripts/analyze-shipped-skill-quality.mjs` — skill quality analyzer checking frontmatter, description length, duplicate names, trigger overlap.
- `scripts/generate-skill-metadata-index.mjs` — generates skill metadata index from catalog assets.
- `catalog-assets/shippedAssets.mjs` — defines which skills ship to which harnesses, load modes (always/on-demand).
- `catalog-assets/targetRouting.mjs` — routes skills across 4 harnesses (OpenCode, Codex, Claude, Antigravity).
- No existing `docs/specs/` artifact defines the skill governance contract normatively — this is the gap.

## Requirements

### Allowed Behavior

#### R1 — Skill File Format

- R1.1: Every skill MUST be a `SKILL.md` file with YAML frontmatter.
- R1.2: Required frontmatter: `name` (kebab-case, unique), `description` (50+ characters recommended), `metadata` (object with `tags` array).
- R1.3: Optional frontmatter: `spec_contract` (reference to normative spec), `load_mode` (on-demand/always), `harness` (harness-specific).
- R1.4: The skill body MUST follow a consistent heading structure: `# <Name>`, followed by operational sections.

#### R2 — Skill Triage Model

- R2.1: Skills are classified into triage tiers:
  - **Core**: always-available, loaded proactively (e.g., spec system skills, project-workflow).
  - **Specialized**: loaded on-demand when triggers match (e.g., security or a framework-specific skill).
  - **Default-handled**: domain-specific tools that the agent invokes natively without skill loading.
  - **Deprecated**: retained for compatibility, not loaded by default.
- R2.2: Classification is declared via catalog metadata and harness asset manifests.

#### R3 — Skill Lifecycle

- R3.1: Skills follow this lifecycle: `draft` → `active` → `deprecated` → `removed`.
- R3.2: `draft`: In development, not shipped to any harness.
- R3.3: `active`: Shipped to target harnesses per target routing.
- R3.4: `deprecated`: Still installed for compatibility; emits deprecation warnings. Not loaded by default.
- R3.5: `removed`: Removed from shipping manifests. Target skill file MAY be deleted after a safety window.

#### R4 — Search/Execute Model

- R4.1: Skills use a staged search/execute model: trigger detection → skill resolution → loading → skill execution.
- R4.2: Trigger detection matches skill `description` frontmatter against user task description.
- R4.3: When multiple skills match, the narrowest (most specific) skill wins via deterministic resolution.
- R4.4: The `skill-discovery` skill provides vault-first priority routing for the search/execute pattern.

#### R5 — Skill Quality Bar

- R5.1: `name` MUST be present and unique across all shipped skills.
- R5.2: `description` MUST be at least 50 characters and include trigger keywords.
- R5.3: `metadata.tags` MUST be present, non-empty, and include at least one domain tag.
- R5.4: The skill body MUST NOT duplicate contract definitions that belong in normative specs.
- R5.5: Skills MUST reference their normative spec via `spec_contract` frontmatter when applicable.

#### R6 — Repo-Local Skill Authority

- R6.1: `.github/skills/` is the sole editable skill source for a target repo. See `docs/system/repo-skill-sync-governance.md`.
- R6.2: Harness-local mirror directories (`.opencode/skills/`, `.agents/skills/`, `.gemini/skills/`) are generated compatibility surfaces only.
- R6.3: Edits to harness mirrors MUST be overwritten by the sync process.

### Forbidden Behavior

- A skill MUST NOT ship without `name` and `description` frontmatter.
- A skill MUST NOT duplicate another skill's name.
- A skill MUST NOT define domain contracts inline that belong in normative specs.
- A skill MUST NOT edit harness-local mirror directories directly — only `.github/skills/`.
- A skill MUST NOT be removed from shipping without a deprecation window.

## Non-Goals

- Defining how skill installation works per harness — that belongs to harness install governance.
- Defining specific skill content requirements beyond quality bar — content is domain-specific.
- Defining the skill catalog database or index structure — that is operational infrastructure.
- Defining how agents select skills at runtime — that belongs to agent routing governance.
- Replacing the catalog-assets/shared-skills voting and review process.

## Acceptance Checks

- The spec itself passes `node scripts/validate-specs.js --strict`
  → verify: `node scripts/validate-specs.js --strict docs/specs/skill-governance-contract/spec.md`
- All 6 requirements with sub-requirements are present
  → verify: `rg "^#### R[1-6]" docs/specs/skill-governance-contract/spec.md | measure` returns at least 6
- Forbidden Behavior covers at least 4 prohibitions
  → verify: `rg "^-\s+A skill MUST NOT" docs/specs/skill-governance-contract/spec.md | measure` returns at least 4
- Existing skills governance doc references this spec
  → verify: `rg "skill-governance-contract" docs/system/skills-governance.md` returns at least 1 match

## Implementation Links

- `docs/specs/skill-governance-contract/spec.md` — this file
- `docs/system/skills-governance.md` — thinned to reference this spec
- `docs/system/repo-skill-sync-governance.md` — referenced in R6
- `catalog-assets/shared-skills/` — all skills should reference this spec via `spec_contract`
- `scripts/analyze-shipped-skill-quality.mjs` — enforces quality bar (R5)

## Validation Evidence

- Pending implementation.

## Drift Notes

- None yet.
