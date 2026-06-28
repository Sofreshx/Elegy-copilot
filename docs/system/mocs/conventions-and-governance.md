---
created: 2026-03-18
updated: 2026-06-27
category: system
status: current
doc_kind: moc
id: moc-conventions-and-governance
summary: Map of content for canonical conventions, governance routing, and follow-up handoff entrypoints.
tags: [governance, conventions, routing]
related: [system-docs-index, rules-compliance-audit-handoff-workflow, project-conventions-governance, documentation-structure-governance, self-documenting-code-and-rationale-placement, follow-up-discovery-governance, concise-instruction-governance, harness-asset-flow, check-taxonomy-governance]
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
  [../rules-compliance-audit-handoff-workflow.md](../rules-compliance-audit-handoff-workflow.md)
- Convention policy, rule precedence, and governance output shape:
  [[project-conventions-governance]] [../project-conventions-governance.md](../project-conventions-governance.md)
- Placement matrix for self-documenting code, smart comments, doc comments, ADRs, and thin
  instruction surfaces:
  [[self-documenting-code-and-rationale-placement]]
  [../self-documenting-code-and-rationale-placement.md](../self-documenting-code-and-rationale-placement.md)
- Documentation entrypoints, information architecture, and discoverability:
  [[documentation-structure-governance]] [../documentation-structure-governance.md](../documentation-structure-governance.md)
- Concise instruction standards, writing rules, and empty language bans:
  [[concise-instruction-governance]] [../concise-instruction-governance.md](../concise-instruction-governance.md)
- Harness asset flow, install architecture, and per-repo deployment model:
  [[harness-asset-flow]] [../harness-asset-flow.md](../harness-asset-flow.md)
- Planning-ready follow-up when convention gaps become next tasks:
  [[follow-up-discovery-governance]] [../follow-up-discovery-governance.md](../follow-up-discovery-governance.md)
- Check classes, determinism, and gate-strength ownership:
  [[check-taxonomy-governance]] [../check-taxonomy-governance.md](../check-taxonomy-governance.md)
- Specific change review versus governance authoring:
  [[reviewer-lane-governance]] [../reviewer-lane-governance.md](../reviewer-lane-governance.md)
- Canonical graph/frontmatter/link contract:
  [[doc-graph-spec]] [../doc-graph-spec.md](../doc-graph-spec.md)

## Recommended workflow

1. Start with `docs/system/rules-compliance-audit-handoff-workflow.md` when the user needs the
   integrated first-slice route across repo-rule bootstrap, compliance gates, project audit, and
   follow-up handoff.
2. Open `docs/system/project-conventions-governance.md` when the question is specifically what the
   repo rules are or how they should be clarified.
3. Add `docs/system/documentation-structure-governance.md` when the main gap is that conventions are
   hard to find, hard to route, or split across too many entrypoints.
4. Route confirmed next steps to `docs/system/follow-up-discovery-governance.md` when convention or
   audit findings should become planning-ready tasks later.
5. Add `docs/system/check-taxonomy-governance.md` when the main question is what kind of check should
   exist, where it belongs, or how authoritative it should be.
6. Use `docs/system/reviewer-lane-governance.md` instead when the task is review of a concrete
   change rather than governance authoring.

## Quick routing

- "Define or revise repo conventions" -> `docs/system/project-conventions-governance.md`
- "Decide whether this belongs in code, comments, API docs, or canonical docs" -> `docs/system/self-documenting-code-and-rationale-placement.md`
- "Show me the whole rules -> compliance -> audit -> follow-up workflow" -> `docs/system/rules-compliance-audit-handoff-workflow.md`
- "Make the rules easier to discover" -> `docs/system/documentation-structure-governance.md`
- "Write or enforce concise instruction standards" -> `docs/system/concise-instruction-governance.md`
- "Turn convention gaps into follow-up tasks" -> `docs/system/follow-up-discovery-governance.md`
- "Decide what kind of check should exist and how strong it should be" -> `docs/system/check-taxonomy-governance.md`
- "Review this implementation for correctness" -> `docs/system/reviewer-lane-governance.md`

## Depends on

- Contract: [[doc-graph-spec]] [../doc-graph-spec.md](../doc-graph-spec.md)
- System docs entrypoint: [[system-docs-index]] [../index.md](../index.md)
