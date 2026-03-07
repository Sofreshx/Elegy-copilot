---
created: 2026-03-06
updated: 2026-03-06
category: research
status: draft
doc_kind: node
id: elegy-ie-agentic-field-mapping
summary: Draft mapping between Elegy agentic contracts and instruction-engine skill and agent metadata fields.
tags: [elegy, instruction-engine, migration, contracts]
---

# Elegy to IE Agentic Field Mapping

## Scope

This draft maps field-level contracts between Elegy formalized records and instruction-engine YAML or markdown conventions.

## Agent Definition Mapping

| Elegy Field | Elegy Type | IE YAML Field (or N/A) | IE Location | Migration Notes |
|---|---|---|---|---|
| `id` | `string` | `name` (closest stable identifier) | `engine-assets/agents/*.agent.md` frontmatter | IE `name` is human-readable and stable; add explicit machine `id` in bridge phase. |
| `name` | `string` | `name` | `engine-assets/agents/*.agent.md` frontmatter | Direct mapping when IDs are introduced separately. |
| `description` | `string?` | `description` | `engine-assets/agents/*.agent.md` frontmatter | Direct optional text mapping. |
| `capabilities[]` | `AgentCapability[]` | N/A | Not first-class today | Represented implicitly by routing/behavior prose; requires schema-backed extraction. |
| `routingRules[]` | `RoutingRule[]` | N/A | `engine-assets/agents/*.agent.md` body tables | Can be parsed from routing tables in selected agents with deterministic parser. |
| `scope` | `enum(session/workspace/global)` | N/A | Not modeled today | Should become explicit frontmatter key in dual-write phase. |

## Skill Definition Mapping

| Elegy Field | Elegy Type | IE YAML Field (or N/A) | IE Location | Migration Notes |
|---|---|---|---|---|
| `id` | `string` | `name` (temporary) | `engine-assets/skills/*/SKILL.md` frontmatter | Introduce explicit `id` while keeping `name` for compatibility. |
| `name` | `string` | `name` | `engine-assets/skills/*/SKILL.md` frontmatter | Direct mapping. |
| `description` | `string?` | `description` | `engine-assets/skills/*/SKILL.md` frontmatter | Direct mapping. |
| `triggers[]` | `SkillTrigger[]` | derived from `description` trigger clause | `engine-assets/skills/*/SKILL.md` frontmatter | Triggers currently embedded in prose; should normalize to explicit array. |
| `constraints[]` | `SkillConstraint[]` | N/A | Body sections like "When NOT to Use" | Requires extraction rules and optional metadata block. |
| `lifecycleState` | `enum(draft/active/deprecated/archived)` | N/A | Not modeled today | Add explicit lifecycle key in frontmatter for governance tooling. |

## Gap Analysis

- IE skills and agents are markdown-first artifacts with implicit semantics in prose; Elegy schemas require explicit structured fields.
- Routing and constraints are not currently represented as machine-readable arrays in IE assets.
- Lifecycle and scope are absent in IE frontmatter, so contract parity needs additive fields.
- Field extraction requires deterministic parsers to avoid fragile natural-language interpretation.

## Proposed Bridge Artifacts

- Keep canonical schemas under `contracts/elegy/` and expose TypeScript stubs in `contracts/src/agentic.ts`.
- Add lightweight extraction adapters that map existing frontmatter plus selected tables into schema-shaped objects.
- Emit validation reports before any write-back to source markdown files.
