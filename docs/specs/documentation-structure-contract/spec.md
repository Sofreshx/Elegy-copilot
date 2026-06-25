---
spec_id: documentation-structure-contract
title: Documentation Structure Contract
status: draft
type: contract
updated: 2026-06-20
---

# Documentation Structure Contract

## Intent

Define the authoritative contract for the canonical documentation system: doc frontmatter, graph routing, wikilink resolution, and validation. Every doc under `docs/system/` MUST conform to this contract.

## Context Evidence

- `docs/system/doc-graph-spec.md` — currently the canonical doc-graph spec. This spec will become the normative authority.
- `docs/system/documentation-structure-governance.md` — currently the canonical doc for documentation structure governance.
- `docs/system/documentation-authoring-governance.md` — authoring rules for durable docs.
- `docs/system/concise-instruction-governance.md` — instruction writing standards.
- `docs/system/mocs/` — 8 MOC files routing to atomic nodes.
- `scripts/validate-doc-graph.js` — doc graph validator enforcing frontmatter and link rules.
- `docs/system/index.md` — global entrypoint routing to MOCs.
- `scripts/validate-doc-graph.js` — validates doc frontmatter and link rules.
- 57 atomic nodes + 8 MOCs under `docs/system/` — all following the doc contract.
- No existing `docs/specs/` artifact defines the documentation structure contract normatively.

## Requirements

### Allowed Behavior

#### R1 — Doc Frontmatter

- R1.1: Every system doc MUST include YAML frontmatter with: `created` (ISO date), `updated` (ISO date), `category` (string), `status` (current/draft/archived/superseded), `doc_kind` (index/moc/node/redirect/spec), `id` (kebab-case, unique).
- R1.2: Non-redirect docs MUST have a unique `id` in kebab-case format.
- R1.3: Optional frontmatter: `summary` (single sentence), `tags` (string array), `related` (doc ID array).

#### R2 — Doc Graph Routing

- R2.1: The doc graph follows top-down progressive disclosure: `index.md` → MOC → atomic node.
- R2.2: `index.md` is the global entrypoint; it routes to the correct MOC for the task domain.
- R2.3: MOCs cluster content by domain but MUST NOT duplicate downstream policy.
- R2.4: Every atomic node MUST be reachable from at least one MOC via `related` links.

#### R3 — Wikilink Resolution

- R3.1: Doc references use dual-link format: `[[wikilink]]` followed by a Markdown link on the same or next line.
- R3.2: `[[wikilink]]` targets MUST resolve to real files in `docs/system/`.
- R3.3: Redirect pages (doc_kind: redirect) MUST point to a valid target.

#### R4 — Doc Freshness

- R4.1: The `updated` field MUST be bumped whenever a PR changes a public API, contract, or policy described by the doc (Doc Freshness Sync Rule).
- R4.2: Archived docs (`status: archived`) remain in the graph for reference but are excluded from active routing.

#### R5 — Doc Roles

- R5.1: Docs follow the Diátaxis framework roles: specification (describing intent), reference (describing state), guide (operational how-to).
- R5.2: `doc_kind` classifies by structural role: index, moc, node, redirect, spec.
- R5.3: A doc's `category` declares its domain (system, ops, design, governance, history).

### Forbidden Behavior

- A doc MUST NOT have a duplicate `id` with another doc.
- A doc MUST NOT use `[[wikilink]]` without an accompanying Markdown link.
- A redirect doc MUST NOT point to itself or form circular chains.
- A MOC MUST NOT duplicate policy content from its linked atomic nodes.
- A doc MUST NOT be removed from the graph without updating `status` to `archived` or `superseded` and fixing inbound links.

## Non-Goals

- Defining content authoring rules beyond structural requirements — content quality is in `documentation-authoring-governance.md`.
- Defining how docs relate to specs or ADRs — those are separate contracts.
- Defining the CI validation pipeline for docs — that is operational infrastructure.
- Defining the visual rendering or navigation of the doc graph.

## Acceptance Checks

- The spec itself passes spec validation
  → verify: run spec validator against this file
- All 5 requirements with sub-requirements are present
  → verify: count `#### R[1-5]` headings — at least 5
- Forbidden Behavior covers at least 4 prohibitions
  → verify: count `MUST NOT` prohibitions — at least 4
- Doc-graph spec references this spec
  → verify: search for `documentation-structure-contract` in the doc-graph spec

## Implementation Links

- `docs/specs/documentation-structure-contract/spec.md` — this file
- `docs/system/doc-graph-spec.md` — thinned to reference this spec
- `docs/system/documentation-structure-governance.md` — thinned to reference this spec
- `scripts/validate-doc-graph.js` — doc graph validator

## Validation Evidence

- Pending implementation.

## Drift Notes

- None yet.
