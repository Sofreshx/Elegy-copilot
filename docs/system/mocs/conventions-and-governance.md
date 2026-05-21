---
created: 2026-03-18
updated: 2026-05-21
category: system
status: current
doc_kind: moc
id: moc-conventions-and-governance
summary: Map of content for canonical conventions, governance routing, and follow-up handoff entrypoints.
tags: [governance, conventions, routing]
related: [system-docs-index, rules-compliance-audit-handoff-workflow, project-conventions-governance, documentation-structure-governance, documentation-authoring-governance, self-documenting-code-and-rationale-placement, follow-up-discovery-governance]
---

# MOC — Conventions & Governance

## When to read

- You need the canonical starting point for repository rules, conventions, or governance workflows.
- You want a clear route for humans and AI to the right governance lane.
- You need convention findings to feed later planning or backlog follow-up without turning this MOC
  into a planning artifact.

## Start here

- End-to-end first-slice overview for repo-rule bootstrap, compliance, project audit, follow-up
  routing, and smart-comment posture:
  [[rules-compliance-audit-handoff-workflow]]
  [docs/system/rules-compliance-audit-handoff-workflow.md](docs/system/rules-compliance-audit-handoff-workflow.md)
- Convention policy, rule precedence, and governance output shape:
  [[project-conventions-governance]] [docs/system/project-conventions-governance.md](docs/system/project-conventions-governance.md)
- Placement matrix for self-documenting code, smart comments, doc comments, ADRs, and thin
  instruction surfaces:
  [[self-documenting-code-and-rationale-placement]]
  [docs/system/self-documenting-code-and-rationale-placement.md](docs/system/self-documenting-code-and-rationale-placement.md)
- Documentation entrypoints, information architecture, and discoverability:
  [[documentation-structure-governance]] [docs/system/documentation-structure-governance.md](docs/system/documentation-structure-governance.md)
- Documentation page quality, progressive disclosure, diagrams, changelog discipline, and drift
  resistance:
  [[documentation-authoring-governance]]
  [docs/system/documentation-authoring-governance.md](docs/system/documentation-authoring-governance.md)
- Repo-local skill source-of-truth and deterministic cross-harness mirror rules:
  [[repo-skill-sync-governance]] [docs/system/repo-skill-sync-governance.md](docs/system/repo-skill-sync-governance.md)
- Durable repo spec contract and `specs/` layout:
  [[spec-driven-development]] [docs/system/spec-driven-development.md](docs/system/spec-driven-development.md)
- Planning-ready follow-up when convention gaps become next tasks:
  [[follow-up-discovery-governance]] [docs/system/follow-up-discovery-governance.md](docs/system/follow-up-discovery-governance.md)
- Specific change review versus governance authoring:
  [[reviewer-lane-governance]] [docs/system/reviewer-lane-governance.md](docs/system/reviewer-lane-governance.md)
- Canonical graph/frontmatter/link contract:
  [[doc-graph-spec]] [docs/system/doc-graph-spec.md](docs/system/doc-graph-spec.md)

## Recommended workflow

1. Start with `docs/system/rules-compliance-audit-handoff-workflow.md` when the user needs the
   integrated first-slice route across repo-rule bootstrap, compliance gates, project audit, and
   follow-up handoff.
2. Open `docs/system/project-conventions-governance.md` when the question is specifically what the
   repo rules are or how they should be clarified.
3. Add `docs/system/documentation-structure-governance.md` when the main gap is that conventions are
   hard to find, hard to route, or split across too many entrypoints.
4. Add `docs/system/documentation-authoring-governance.md` when the main gap is durable page
   quality, progressive disclosure, diagrams, changelog discipline, or docs drift resistance.
5. Add `docs/system/repo-skill-sync-governance.md` when the main question is how repo-local skills should mirror safely across harnesses.
6. Route confirmed next steps to `docs/system/follow-up-discovery-governance.md` when convention or
   audit findings should become planning-ready tasks later.
7. Use `docs/system/reviewer-lane-governance.md` instead when the task is review of a concrete
   change rather than governance authoring.

## Quick routing

- "Define or revise repo conventions" -> `docs/system/project-conventions-governance.md`
- "Decide whether this belongs in code, comments, API docs, or canonical docs" -> `docs/system/self-documenting-code-and-rationale-placement.md`
- "Show me the whole rules -> compliance -> audit -> follow-up workflow" -> `docs/system/rules-compliance-audit-handoff-workflow.md`
- "Make the rules easier to discover" -> `docs/system/documentation-structure-governance.md`
- "Make this documentation more durable, diagram-first, or agent-readable" -> `docs/system/documentation-authoring-governance.md`
- "How should repo-local skills mirror across Codex/OpenCode/Gemini?" -> `docs/system/repo-skill-sync-governance.md`
- "Define a durable repo spec or shared `specs/` contract" -> `docs/system/spec-driven-development.md`
- "Turn convention gaps into follow-up tasks" -> `docs/system/follow-up-discovery-governance.md`
- "Review this implementation for correctness" -> `docs/system/reviewer-lane-governance.md`

## Depends on

- Contract: [[doc-graph-spec]] [docs/system/doc-graph-spec.md](docs/system/doc-graph-spec.md)
- System docs entrypoint: [[system-docs-index]] [docs/system/index.md](docs/system/index.md)
