---
created: 2026-05-25
updated: 2026-05-25
category: system
status: current
doc_kind: node
id: adr-governance
summary: Canonical governance for when to create ADRs, when not to, how to structure them, and how review should treat missing or excessive ADR usage.
tags: [adr, architecture, governance, documentation]
related: [self-documenting-code-and-rationale-placement, project-conventions-governance, documentation-authoring-governance, progressive-constraint-narrowing, research-promotion-checklist]
---

# ADR Governance

## Purpose

Define when Instruction Engine should create an Architecture Decision Record, when it should not,
and how ADRs should be structured and reviewed.

## Core rule

ADRs are for key architectural, workflow-authority, trust-boundary, or long-lived contract
decisions.

ADRs are not the default home for routine implementation choices.

## Use an ADR when

Create or update an ADR only when all of these are true:

1. the decision is architectural, cross-boundary, or long-lived enough that future work will rely on it
2. there is a meaningful tradeoff, boundary, or rationale worth preserving
3. the decision affects multiple files, workflows, teams, or sessions
4. repeating the rationale inline, in prompts, or in multiple docs would create drift risk

Typical ADR-worthy subjects:

- trust boundaries and auth model choices
- workflow ownership and authority boundaries
- durable runtime/storage/session-state contracts
- cross-harness or cross-lane architectural decisions
- major integration, framework, or module-boundary choices with lasting tradeoffs

## Do not use an ADR when

Do not create an ADR for:

- local refactors or small code-shape choices
- routine bugfix approach
- naming and extraction decisions with only local impact
- temporary exploration notes
- ordinary task sequencing
- small UI, copy, or implementation details with no durable architectural consequence

If the rationale is local, keep it in code, a smart comment, a doc comment, or a nearby canonical node instead.

## Path and discovery

- Store ADRs in `docs/system/**`.
- Prefer file names ending in `-adr.md`.
- Keep ADRs discoverable from the relevant MOC or owning canonical node.
- ADRs remain normal canonical system docs for doc-graph purposes; do not treat them as a separate doc-kind family.

## Required sections

Every ADR must include:

- `## Context`
- `## Decision`
- `## Consequences`

Recommended sections when they materially help:

- `## Scope`
- `## Non-goals`
- `## Alternatives Considered`
- `## Validation Notes`
- `## Follow-up`

## Frontmatter posture

Use normal `docs/system/**` frontmatter.

- keep `category: system`
- keep `doc_kind: node`
- use a precise `id`
- include `tags` with `adr`
- keep `summary` specific enough for retrieval

## Review posture

Review should enforce two things at once:

1. missing ADRs for key decisions are a real gap
2. ADR spam for local decisions is also drift

Treat missing ADR coverage as a blocking review concern only when the change introduces or revises a
key architectural, trust-boundary, workflow-authority, or long-lived contract decision.

Treat unnecessary ADR creation as over-documentation drift when the decision is local and not durable
enough to justify an ADR.

## Relationship to other surfaces

- Use [[self-documenting-code-and-rationale-placement]] [docs/system/self-documenting-code-and-rationale-placement.md](docs/system/self-documenting-code-and-rationale-placement.md) to choose between code comments, docs, and ADRs.
- Use [[progressive-constraint-narrowing]] [docs/system/progressive-constraint-narrowing.md](docs/system/progressive-constraint-narrowing.md) when a repeated constraint should be promoted out of prompts or plans into a durable source of truth.
- Keep exploratory or unratified analysis in `docs/research/**` until the decision is stable enough to promote.

## Minimal template

```markdown
---
created: YYYY-MM-DD
updated: YYYY-MM-DD
category: system
status: current
doc_kind: node
id: <decision-id>
summary: <one-sentence ADR summary>
tags: [adr, <topic>]
related: [<id>]
---

# <Decision Title> ADR

## Context

<what problem, boundary, or tradeoff forced a decision>

## Decision

<the chosen option and the governing rule>

## Consequences

<positive outcomes, tradeoffs, and follow-up implications>
```

## Validation

- ADRs must pass the normal doc-graph validator.
- `*-adr.md` files must include the required ADR sections.
- Existing ADR examples should be kept aligned with this contract rather than drifting into one-off formats.

## References

- `docs/system/self-documenting-code-and-rationale-placement.md`
- `docs/system/project-conventions-governance.md`
- `docs/system/documentation-authoring-governance.md`
- `docs/system/research-promotion-checklist.md`
