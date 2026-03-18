---
created: 2026-03-18
updated: 2026-03-18
category: system
status: current
doc_kind: moc
id: moc-conventions-and-governance
summary: Map of content for canonical conventions, governance routing, and follow-up handoff entrypoints.
tags: [governance, conventions, routing]
related: [system-docs-index, project-conventions-governance, documentation-structure-governance, follow-up-discovery-governance]
---

# MOC — Conventions & Governance

## When to read

- You need the canonical starting point for repository rules, conventions, or governance workflows.
- You want a clear route for humans and AI to the right governance lane.
- You need convention findings to feed later planning or backlog follow-up without turning this MOC
  into a planning artifact.

## Start here

- Convention policy, rule precedence, and governance output shape:
  [[project-conventions-governance]] [docs/system/project-conventions-governance.md](docs/system/project-conventions-governance.md)
- Documentation entrypoints, information architecture, and discoverability:
  [[documentation-structure-governance]] [docs/system/documentation-structure-governance.md](docs/system/documentation-structure-governance.md)
- Planning-ready follow-up when convention gaps become next tasks:
  [[follow-up-discovery-governance]] [docs/system/follow-up-discovery-governance.md](docs/system/follow-up-discovery-governance.md)
- Specific change review versus governance authoring:
  [[reviewer-lane-governance]] [docs/system/reviewer-lane-governance.md](docs/system/reviewer-lane-governance.md)
- Canonical graph/frontmatter/link contract:
  [[doc-graph-spec]] [docs/system/doc-graph-spec.md](docs/system/doc-graph-spec.md)

## Recommended workflow

1. Start with `docs/system/project-conventions-governance.md` when the user is asking what the repo
   rules are or how they should be clarified.
2. Add `docs/system/documentation-structure-governance.md` when the main gap is that conventions are
   hard to find, hard to route, or split across too many entrypoints.
3. Route confirmed next steps to `docs/system/follow-up-discovery-governance.md` when convention
   findings should become planning-ready tasks later.
4. Use `docs/system/reviewer-lane-governance.md` instead when the task is review of a concrete
   change rather than governance authoring.

## Quick routing

- "Define or revise repo conventions" -> `docs/system/project-conventions-governance.md`
- "Make the rules easier to discover" -> `docs/system/documentation-structure-governance.md`
- "Turn convention gaps into follow-up tasks" -> `docs/system/follow-up-discovery-governance.md`
- "Review this implementation for correctness" -> `docs/system/reviewer-lane-governance.md`

## Depends on

- Contract: [[doc-graph-spec]] [docs/system/doc-graph-spec.md](docs/system/doc-graph-spec.md)
- System docs entrypoint: [[system-docs-index]] [docs/system/index.md](docs/system/index.md)
