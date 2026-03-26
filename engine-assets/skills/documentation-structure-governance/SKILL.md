---
name: documentation-structure-governance
description: "Governance rules for documentation and project-structure entrypoints, discoverability, and aligned human-friendly plus LLM-friendly access paths. Triggers on: documentation structure, docs IA, docs entrypoint, project structure guidance, LLM-friendly entrypoint, human-friendly entrypoint, doc structure governance."
---

# Documentation Structure Governance

## Purpose

Reusable governance rules for generating, evaluating, and updating documentation/project-structure
guidance. This skill is about **entrypoints, discoverability, and structural policy**, not generic
Markdown authoring.

## Canonical Sources

Always ground this skill in:

- `docs/system/documentation-structure-governance.md`
- `docs/system/doc-graph-spec.md`
- `docs/system/search-execute-workflow.md`

If these sources conflict, prefer the canonical governance doc, then the doc-graph contract, then the
search/execute routing doc.
Start from the smallest relevant canonical entrypoint for the governed surface and expand only as the current step requires.

## LLM Routing Guide

Route here when the request is about:

- documentation information architecture
- canonical entrypoints for a capability family
- human versus agent navigation paths
- repo/project structure guidance for discoverability
- hidden, duplicated, or conflicting start points in docs

Do not route here when the request is mainly:

- "write/update this Markdown page"
- "fix frontmatter/formatting only"
- "review correctness/style/runtime behavior"
- "define coding conventions"

## Use This Skill When

- a repo or capability needs a clearer documentation entrypoint
- documentation structure should work for both humans and LLM workflows
- a governance lane needs to audit whether docs are discoverable from the graph
- project-structure guidance is hidden, duplicated, or spread across too many pages
- a new governance surface needs a human overview plus a compact execution-oriented entrypoint

## Do Not Use This Skill When

- the task is generic Markdown writing or frontmatter maintenance -> use `doc-writer`
- the task is mainly code/project conventions -> use project-conventions governance
- the task is correctness, consistency review, or runtime validation -> use the reviewer lanes
- the task is open-ended research rather than a governance decision -> use research/follow-up lanes

## Governance Defaults

- **Instruction-engine first**: optimize for this repo's canonical docs and asset model.
- **Audit/propose first**: default to finding gaps and proposing updates before mutating files.
- **Graph-preserving**: extend `docs/system/**`; do not create a parallel documentation system.
- **Smallest useful change**: prefer one node and the minimum index/MOC link updates needed.
- **Single source of truth**: human and LLM entrypoints must encode the same rules.

## Contradiction Handling

- Classify mismatches as minor wording drift or material contradiction.
- If intended work materially conflicts with current canonical docs or nearby maintained docs on entrypoint ownership, discoverability requirements, precedence, or documentation-backed workflow behavior, surface the specific contradiction and ask the user for direction before write-capable work continues.
- Do not create a separate truth hierarchy for docs routing; follow the owning canonical docs and escalate only the material contradiction.

## Dual-Entrypoint Model

### Human-Friendly Entrypoint Must

- be reachable from `docs/system/index.md` or a relevant MOC
- explain purpose, audience, and when to read it
- point readers to the smallest useful next docs
- avoid assuming hidden prompt knowledge
- summarize structure decisions without scattering policy across many pages

### LLM-Friendly Entrypoint Must

- be compact enough to distill into a downstream brief
- include route-to-me triggers
- include precedence rules and required inputs
- include the output contract and validation hook
- link only the minimum canonical nodes needed for execution

### Alignment Rule

The human-friendly and LLM-friendly entrypoints may differ in format, but they must agree on:

- scope
- precedence
- required inputs
- expected outputs
- validation path

## Deterministic Checklist

1. Identify the current entrypoint path for the governed surface.
2. Check whether the path is discoverable from the doc graph.
3. Identify the human reader's start point.
4. Identify the LLM workflow's compact start point.
5. Flag hidden, duplicated, conflicting, or overly broad entrypoint logic.
6. Surface any material contradiction before approved update work proceeds.
7. Propose the smallest graph-compliant change that fixes the gap.
8. Keep generic writing guidance out of scope unless it directly blocks governance clarity.

## Required Inputs

- target surface, folder, or capability family
- current docs/structure in scope
- whether the task is **audit**, **proposal**, or **approved update**
- any constraints on which files may be edited

If the target surface or edit scope is unclear, stop and ask for clarification instead of inventing a
new structure.

## Proposal Rules

- Prefer updating existing overview/MOC/node paths before creating new ones.
- Only create a new entrypoint when the current graph has no clear home for the governed topic.
- Keep governance guidance additive and reusable.
- Do not duplicate `doc-writer` guidance about generic headings, fenced code blocks, or broad
  frontmatter hygiene unless the structure decision depends on it.

## Output Contract

Return or propose results in this structure:

```text
DOC_STRUCTURE_GOVERNANCE
- scope:
- mode: audit|propose|update
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

## Validation Expectations

- Check the touched guidance against `docs/system/doc-graph-spec.md`.
- Verify the human entrypoint is discoverable from index/MOC flow.
- Verify the LLM entrypoint contains deterministic routing/execution cues.
- When no lightweight validator fits the asset scope, perform explicit manual frontmatter and structure
  checks against neighboring assets.
