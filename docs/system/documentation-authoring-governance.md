---
created: 2026-05-17
updated: 2026-05-17
category: system
status: current
doc_kind: node
id: documentation-authoring-governance
summary: Canonical contract for writing durable documentation that is human-readable, agent-readable, progressively disclosed, diagram-friendly, and resistant to drift.
tags: [documentation, authoring, governance, diagrams, validation]
related: [doc-graph-spec, documentation-structure-governance, self-documenting-code-and-rationale-placement]
---

# Documentation Authoring Governance

## Purpose

Define the reusable documentation authoring contract for durable docs. This governs how to write or
revise documentation once the correct documentation location and entrypoint have been chosen.

Use [[documentation-structure-governance]]
[docs/system/documentation-structure-governance.md](docs/system/documentation-structure-governance.md)
when the main problem is information architecture, entrypoints, or discoverability. Use this node
when the main problem is page quality, progressive disclosure, diagrams, agent readability, and
drift-resistant content.

## Authoring Principles

- Write from stable concepts, contracts, invariants, and key decisions before implementation detail.
- Start with a compact explanation, then disclose detail only when the reader needs it.
- Keep pages atomic enough that an agent can retrieve one page without dragging in an unrelated rule
  family.
- Prefer diagrams for topology, lifecycle, sequence, state, data flow, authority boundaries, and
  release/version relationships.
- Make freshness and scope visible through frontmatter, status language, and validation evidence.
- Link to implementation evidence when useful, but do not turn durable docs into a line-by-line code
  mirror.

## Page Pattern

Durable documentation pages should usually include:

1. purpose and audience
2. short current-state summary
3. diagram or relationship map when the topic has structure or flow
4. core rules, invariants, or decisions
5. current behavior or workflow
6. limitations, non-goals, or known risks
7. validation, freshness, or evidence notes when relevant
8. read-next links to the smallest useful nodes

Not every page needs every section. Omit sections that would be empty or performative.

## Human-Friendly Requirements

Human-facing docs should:

- expose a clear starting point and next step
- use conventional headings and link text
- avoid hidden prompt assumptions
- keep examples short and close to the rule they demonstrate
- explain "why this exists" before detailed mechanics when the topic is conceptual

## Agent-Friendly Requirements

Agent-facing docs should:

- keep frontmatter summaries accurate and specific
- use deterministic headings and stable terminology
- avoid mixing current truth with future-state planning unless the distinction is explicit
- prefer short canonical pages over broad composite pages
- include machine-friendly cues such as status, scope, source ownership, validation command, and
  read-next links

## Drift Resistance

Docs should be biased toward durable claims:

- Good: authority boundaries, lifecycle states, public contracts, validation commands, release
  policy, accepted limitations.
- Risky: exhaustive implementation call graphs, file inventories, UI copy that changes frequently,
  generated API detail unless generated from source.

When implementation evidence conflicts with canonical docs, follow the contradiction-handling rules
in [[documentation-structure-governance]]
[docs/system/documentation-structure-governance.md](docs/system/documentation-structure-governance.md)
before rewriting the docs around an unverified assumption.

## Changelog And Version Notes

When a docs change describes behavior visible to users, operators, integrators, or downstream
agents, check whether a changelog, release note, migration note, or known-issues entry also needs an
update.

Do not invent release history. Record only known facts and link to stable evidence when available.

## Validation Expectations

Before handoff, run the narrowest docs validation available for the repo. Prefer validators that
check:

- frontmatter and required summaries
- graph links and wikilinks
- public navigation or sidebar references
- diagram rendering or docs-site builds
- generated agent-readable indexes such as `llms.txt`

If no validator exists, perform a manual structure check against [[doc-graph-spec]]
[docs/system/doc-graph-spec.md](docs/system/doc-graph-spec.md) and report the validation gap.

## Output Contract

Use this structure when reporting documentation authoring work:

```text
DOCUMENTATION_AUTHORING
- scope:
- source_of_truth:
- authoring_changes:
  - <page or skill changed>
- drift_controls:
  - <how freshness/desync risk was reduced>
- diagrams_or_agent_outputs:
  - <diagram, llms.txt, index, or none>
- validation:
  - <command or manual check>
```
