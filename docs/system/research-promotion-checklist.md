---
created: 2026-03-01
updated: 2026-03-01
category: system
status: current
doc_kind: node
id: research-promotion-checklist
summary: Checklist and evidence requirements for promoting research findings into canonical system documentation.
tags: [documentation, governance, promotion, research]
related: [system-docs-index, doc-graph-spec, moc-skills-governance, orchestration-and-agents]
---

# Research Promotion Checklist

Use this checklist when deciding whether content from `docs/research/**` should become canonical in `docs/system/**`.

## Promotion Criteria

Promote research content only when all criteria are met:

1. The guidance is stable enough to apply across multiple tasks or sessions.
2. The recommendation has clear operational impact (architecture, safety, workflow, or validation).
3. Conflicts with existing canonical docs were reviewed and resolved.
4. The proposed content can be validated (script, test, deterministic check, or review protocol).
5. Ownership for future updates is clear.

If criteria are not met, keep the content in `docs/research/**` and link it as non-canonical context.

## Practical Checklist

- Define scope:
  - What decision/pattern is being promoted?
  - Which workflows are affected?
- Confirm source quality:
  - Source research docs are identified and dated.
  - Findings are not speculative or one-off observations.
- Run conflict check:
  - Compare against `docs/system/**` nodes and MOCs.
  - Resolve contradictions before promotion.
- Choose canonical target:
  - Existing node update, or
  - New node plus MOC/index wiring.
- Add validation plan:
  - Include the narrowest command/check that verifies correctness.
- Record evidence (required fields below).
- Update links:
  - Ensure index/MOC routes can discover the promoted node.
- Log change:
  - Add a concise entry to `docs/system/instruction-changelog.md`.

## Required Evidence Fields

When promoting research content, include these fields in the PR description, plan artifact, or change note:

| Field | Required | Description |
|---|---|---|
| `promotion_title` | yes | Short name of the promoted guidance. |
| `source_research_docs` | yes | List of source files under `docs/research/**`. |
| `canonical_targets` | yes | Node/MOC/index files created or updated in `docs/system/**`. |
| `conflict_check_result` | yes | `none` or a short summary of resolved conflicts. |
| `validation_evidence` | yes | Commands/checks executed, or rationale if not executable. |
| `owner_role` | yes | Role accountable for future updates. |
| `review_signoff` | yes | Reviewer(s) or approval artifact reference. |
| `rollback_plan` | yes | How to revert or demote if guidance is incorrect. |

## Decision Rule

- Canonical decisions live in `docs/system/**`.
- Research remains non-canonical in `docs/research/**`.
- On conflicts, update canonical docs intentionally; do not silently rely on research notes.
