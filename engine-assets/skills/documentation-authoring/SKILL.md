---
name: documentation-authoring
description: "Reusable documentation authoring workflow for durable human-readable and agent-readable docs. Triggers on: documentation authoring, docs writing, docs quality, progressive disclosure, diagram-heavy docs, changelog discipline, docs drift, llms.txt docs."
tags: [documentation, authoring, diagrams, llms, validation]
---

# Documentation Authoring

## Purpose

Use this skill to create or revise durable documentation after the correct documentation location is
known. It is about page quality, progressive disclosure, diagrams, agent readability, changelog
discipline, and drift resistance.

Use `documentation-structure-governance` instead when the main problem is information architecture,
entrypoints, or discoverability.

## Canonical Basis

When working inside Instruction Engine, ground this skill in:

- `docs/system/documentation-authoring-governance.md`
- `docs/system/documentation-structure-governance.md`
- `docs/system/doc-graph-spec.md`
- `docs/system/progressive-constraint-narrowing.md`
- `docs/system/adr-governance.md`

In other repositories, use the nearest repo-local docs contract first, then apply this reusable
baseline only where it does not conflict.

## Workflow

1. Identify the docs source of truth and the intended audience.
2. Read the smallest relevant canonical entrypoint before editing.
3. Narrow candidate constraints to the minimum hard constraints needed for the active step; keep
   shaping context and open questions separate.
4. Choose the page role: overview, concept, architecture, guide, reference, troubleshooting,
   changelog/release note, or agent-ingestion surface.
5. Write from stable concepts, contracts, invariants, and decisions before implementation detail.
6. Use ADRs only for key architectural, workflow-authority, trust-boundary, or long-lived
   contract decisions. If one is discovered, call out ADR follow-up instead of hiding it in
   page-only prose.
7. Use progressive disclosure: compact summary first, details and edge cases later.
8. Add diagrams for topology, lifecycle, state, sequence, authority, data/evidence flow, or
   release/version relationships when they clarify the page.
9. Check whether changelog, known-issues, migration, versioning, or `llms.txt` outputs need
   updates.
10. Run the narrowest docs validation available and report any remaining gap.

## Page Pattern

Prefer this shape for durable pages:

- purpose and audience
- current-state summary
- diagram or relationship map when useful
- core rules, invariants, or decisions
- current behavior or workflow
- limitations, non-goals, or known risks
- validation, freshness, or evidence notes
- read-next links

Omit sections that would be empty. Do not pad pages to fit the pattern.

## Drift Controls

- Avoid line-by-line implementation mirrors unless generated from source.
- Prefer durable public contracts over volatile internal mechanics.
- Keep future-state planning separate from current-state docs unless the distinction is explicit.
- Link to implementation evidence when it helps verification, but keep canonical docs readable
  without the code open.
- If code and docs materially disagree, surface the conflict and follow the repo's canonical
  contradiction-handling workflow before rewriting either side.

## Agent-Readable Docs

For agent-facing docs or `llms.txt`/Markdown exports:

- keep frontmatter summaries accurate and specific
- use stable headings and terminology
- expose source ownership, status, and validation path
- include curated links instead of dumping unrelated planning/research content
- prefer generated indexes over manually duplicated page lists

## Validation

Use repo-local validators first. Useful checks include:

- frontmatter/schema validation
- link graph validation
- docs-site build
- Mermaid or diagram render validation
- sidebar/navigation validation
- generated `llms.txt` freshness

If validation is unavailable, report the manual checks performed and the risk that remains.

## Output

Report:

```text
DOCUMENTATION_AUTHORING
- scope:
- source_of_truth:
- authoring_changes:
- drift_controls:
- diagrams_or_agent_outputs:
- validation:
```
