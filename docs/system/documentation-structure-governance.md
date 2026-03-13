---
created: 2026-03-13
updated: 2026-03-13
category: system
status: current
doc_kind: node
id: documentation-structure-governance
summary: Canonical contract for documentation and project-structure governance, including human-friendly and LLM-friendly entrypoint expectations.
tags: [governance, documentation, structure, routing]
related: [doc-graph-spec, system-docs-index, search-execute-workflow, project-conventions-governance]
---

# Documentation and Structure Governance

## Purpose

Define the canonical governance contract for documentation structure, project entrypoints, and
human-friendly versus LLM-friendly access paths.

## Context

Instruction Engine already uses the doc graph in `docs/system/**` as its canonical documentation
system. This governance lane extends that model rather than replacing it.

For this rollout:

- scope is **instruction-engine first**
- governance remains **audit/propose first**
- edits flow through normal documentation execution only after approval

## Governance Scope

This lane governs:

- canonical documentation entrypoints
- repo-structure guidance that affects discoverability
- where humans should start versus where LLM workflows should start
- promotion of structural rules from ad hoc practice into canonical docs

This lane does not replace:

- `doc-writer` for general Markdown execution
- the doc graph spec as the validation contract
- repo implementation docs that are already correctly placed and linked

## Human-Friendly Entrypoint Expectations

A human-friendly entrypoint should:

- be discoverable from `docs/system/index.md` or a relevant MOC
- explain purpose, audience, and when to read it
- orient a reader to the smallest useful next links
- avoid assuming prompt-only or hidden agent knowledge
- point to canonical nodes instead of duplicating policy text across many pages

Examples include:

- the system index
- MOCs
- short overview nodes that explain a governance surface before the reader opens atomic rules

## LLM-Friendly Entrypoint Expectations

An LLM-friendly entrypoint should be compact, deterministic, and easy to extract into a downstream
brief. It should include:

- route-to-me triggers
- precedence rules
- required inputs
- output contract
- validation hook or canonical validator reference
- links to the minimum canonical nodes needed downstream

For V1, the LLM-friendly entrypoint may be:

- a dedicated compact node, or
- a clearly labeled compact section inside the canonical overview node until a dedicated node is
  added later

The human-friendly and LLM-friendly entrypoints must agree on the same source-of-truth rules.

## Documentation and Project-Structure Responsibilities

This lane is responsible for:

- defining which docs are entrypoints, MOCs, and atomic nodes for new governance surfaces
- ensuring repo structure guidance has a human-readable path and an LLM-usable path
- detecting duplicated, conflicting, or hidden entrypoint logic
- keeping new governance docs graph-compliant and discoverable

This lane is not responsible for:

- deciding code-style conventions that belong to project-conventions governance
- performing code correctness review
- performing runtime validation

## Routing

Route requests here when the user asks to:

- improve documentation structure or information architecture
- define the canonical entrypoint for a new capability family
- make a repo surface easier for both humans and agents to navigate
- audit whether docs and folder structure expose the right starting points

Prefer other lanes when the task is mainly:

- convention policy authoring -> `docs/system/project-conventions-governance.md`
- review of a specific change -> `docs/system/reviewer-lane-governance.md`
- gap detection or research follow-up -> `docs/system/follow-up-discovery-governance.md`

## Output Contract

Use this structure for doc/structure governance work:

```text
DOC_STRUCTURE_GOVERNANCE
- scope:
- current_entrypoints:
  - <path + audience>
- structure_findings:
  - <gap or strength>
- required_human_entrypoints:
  - <path or doc role>
- required_llm_entrypoints:
  - <path or compact section>
- proposed_graph_updates:
  - <index/MOC/node/link change>
- validation:
  - <validator or manual check>
```

## Change Workflow

1. identify the current entrypoint path
2. verify graph compliance and discoverability
3. propose the smallest structural update
4. update the canonical node plus the minimal index or MOC links needed
5. validate with the doc graph validator when available

## References

- `docs/system/doc-graph-spec.md`
- `docs/system/index.md`
- `docs/system/mocs/orchestration-and-agents.md`
- `docs/system/search-execute-workflow.md`
- `docs/system/project-conventions-governance.md`
