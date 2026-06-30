---
created: 2026-04-09
updated: 2026-06-29
category: system
status: current
doc_kind: node
id: rules-compliance-audit-handoff-workflow
summary: Canonical overview entrypoint for the first additive slice connecting repo-rule bootstrap, compliance gates, project audit, follow-up routing, and selective rationale capture.
tags: [governance, compliance, audit, follow-up, routing]
related: [system-docs-index, moc-conventions-and-governance, project-conventions-governance, documentation-structure-governance, self-documenting-code-and-rationale-placement, search-execute-workflow, reviewer-lane-governance, follow-up-discovery-governance]
---

# Rules, Compliance, Audit, and Handoff Workflow

## Purpose

Use this node as the compact overview for the elegy-copilot-first first implementation slice.
It turns the approved distributed governance updates into one discoverable path without replacing the
atomic nodes that already own each rule family.

## When to read

- You need the end-to-end route from repo-rule bootstrap to planning-ready follow-up.
- You want one compact canonical entrypoint before expanding into the underlying governance nodes.
- You need the explicit validation gates or rollout posture for this first slice.

## Authority posture

- Repo-rule authority stays in [[project-conventions-governance]]
  [project-conventions-governance.md](project-conventions-governance.md).
- Entrypoint and discoverability rules stay in [[documentation-structure-governance]]
  [documentation-structure-governance.md](documentation-structure-governance.md).
- Bootstrap, contradiction handling, and observable rule reliance stay in [[search-execute-workflow]]
  [search-execute-workflow.md](search-execute-workflow.md).
- Project-audit lane composition and normalized finding categories stay in
  [[reviewer-lane-governance]]
  [reviewer-lane-governance.md](reviewer-lane-governance.md).
- Planning-ready follow-up routing stays in [[follow-up-discovery-governance]]
  [follow-up-discovery-governance.md](follow-up-discovery-governance.md).

This node is an overview and routing surface only. It does **not** create a competing authority
layer. If this page and an atomic node disagree, the atomic canonical node wins.

## First-slice workflow

1. **Bootstrap canonical repo rules first.**
    - Start from [[system-docs-index]] [index.md](index.md) and
      [[moc-conventions-and-governance]]
      [mocs/conventions-and-governance.md](mocs/conventions-and-governance.md),
      then load the smallest relevant canonical node for the active task. When the task spans this
      end-to-end workflow, this overview is the correct compact bootstrap before expanding only to
      the owning atomic node that the current step needs.
   - Write-capable leaves must repeat canonical bootstrap independently instead of relying only on
     orchestrator briefs, summaries, or prompt text.
2. **Make rule reliance observable.**
   - Docs-backed planning, execution, and review outputs should name the canonical doc paths they
     relied on.
   - Missing required bootstrap or a material contradiction with canonical docs is a hard stop for the
     active write-capable step.
3. **Run project audit as a composed family.**
   - Use the specialist lanes defined in [[reviewer-lane-governance]]
     [reviewer-lane-governance.md](reviewer-lane-governance.md) as an
     additive audit overlay rather than a replacement reviewer.
   - Reduce each accepted finding to exactly one normalized category: `defect`, `rule_drift`,
     `authority_gap`, `research_thread`, or `improvement`.
4. **Hand off accepted findings through existing canonical follow-up surfaces.**
    - Route normalized findings through [[follow-up-discovery-governance]]
      [follow-up-discovery-governance.md](follow-up-discovery-governance.md)
      so backlog carryover and the approved specialized `~/.copilot/backlogs/{repo-name}/issues/*` routes stay explicit.
    - V1 stays on the approved backlog plus the approved specialized `~/.copilot/backlogs/{repo-name}/issues/*` surfaces; it does
      **not** add a dedicated issue ledger.
5. **Capture "why" at the right authority surface.**
   - Use [[self-documenting-code-and-rationale-placement]]
     [self-documenting-code-and-rationale-placement.md](self-documenting-code-and-rationale-placement.md)
     as the placement matrix for self-documenting code, smart comments, doc comments, research
     design notes, canonical docs, ADRs, and thin instruction surfaces.
   - Put enduring workflow, architectural, and policy rationale in [[project-conventions-governance]]
     [project-conventions-governance.md](project-conventions-governance.md)
     or the smallest relevant canonical node.
   - Put planning-worthy ideas, deferred findings, and recurring friction in the approved
     `~/.copilot/backlogs/{repo-name}/issues/*` or backlog surfaces.
   - Use smart comments only for local, non-obvious rationale that must stay next to code to prevent
     accidental simplification or boundary erosion.

## First-slice validation gates

| Gate | What must remain true | Validation method |
| --- | --- | --- |
| discoverability | this overview is linked from the system index and the conventions/governance MOC, and all dual-link / frontmatter rules still pass | run `node scripts/validate-doc-graph.js` |
| bootstrap and compliance | docs-backed write-capable work still names canonical references, missing bootstrap still fails closed, and missing smart comments remain review findings rather than authority blockers | verify alignment with `docs/system/search-execute-workflow.md`, `docs/system/project-conventions-governance.md`, `docs/system/self-documenting-code-and-rationale-placement.md`, and `docs/system/reviewer-lane-governance.md` |
| additive handoff | project-audit findings still route into the approved backlog plus `~/.copilot/backlogs/{repo-name}/issues/*` surfaces, with no dedicated V1 issue ledger or new peer authority | verify alignment with `docs/system/follow-up-discovery-governance.md` |

For this doc-first slice, the required repo validator is the doc-graph check above. The remaining
gates make the rollout posture explicit so later extensions do not quietly introduce competing
authority or persistence surfaces.

## Rollout posture

- **elegy-copilot first:** prove the workflow in this repo before treating it as a reusable
  downstream pattern
- **canonical-docs first:** authority remains in `docs/system/**`; prompts, agent assets, and issue
  logs stay subordinate unless canonically promoted
- **additive:** reuse existing governance, reviewer, and follow-up contracts instead of replacing them
- **narrow ownership:** keep this first slice to one overview node plus minimal discoverability links
- **no competing authority surfaces:** do not create a second rules surface, alternate issue ledger,
  or comment-first policy layer
- **low-risk rollback:** removing this overview and its links cleanly reverts the synthesis if the
  workflow direction changes

## Expand next

- [[project-conventions-governance]] [project-conventions-governance.md](project-conventions-governance.md)
- [[self-documenting-code-and-rationale-placement]] [self-documenting-code-and-rationale-placement.md](self-documenting-code-and-rationale-placement.md)
- [[search-execute-workflow]] [search-execute-workflow.md](search-execute-workflow.md)
- [[reviewer-lane-governance]] [reviewer-lane-governance.md](reviewer-lane-governance.md)
- [[follow-up-discovery-governance]] [follow-up-discovery-governance.md](follow-up-discovery-governance.md)
