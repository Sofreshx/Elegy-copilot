---
created: 2026-03-13
updated: 2026-06-08
category: system
status: current
doc_kind: node
id: documentation-structure-governance
summary: Canonical contract for documentation and project-structure governance, including human-friendly and LLM-friendly entrypoint expectations.
tags: [governance, documentation, structure, routing]
related: [doc-graph-spec, system-docs-index, search-execute-workflow, project-conventions-governance, progressive-constraint-narrowing, adr-governance]
---

# Documentation and Structure Governance

## Purpose

Define the canonical governance contract for documentation structure, project entrypoints, and
human-friendly versus LLM-friendly access paths.

### Artifact Roles

Specs describe intent. Docs describe state. ADRs record decisions.

| Artifact | Mode | Describes | Answers |
|----------|------|-----------|---------|
| Spec | Intent | What the system should do (requirements) | "What should it do?" |
| Canonical doc | State | How the system currently works | "How does it work?" |
| ADR | Decision state | What architectural decision was made | "Why this way?" |

Drift measures divergence between spec intent and implementation state.

## Context

Instruction Engine already uses the doc graph in `docs/system/**` as its canonical documentation
system. This governance lane extends that model rather than replacing it.

Feature and modification work is docs-first. When a new feature or modification changes intended
design, behavior, or workflow policy, it is also docs-update-first: the first execution slice
should update the relevant canonical docs to match the intended design before or alongside
implementation, not wait until after code lands.

Before implementation, humans and AI should load the smallest relevant canonical entrypoint,
usually `docs/system/index.md`, a relevant MOC, or a more specific canonical node, then expand
only as needed.

`docs/system/**` remains canonical intent. Other maintained docs in `docs/**` still matter as
important design and operating context, but they are not peer authority with the canonical system
nodes.

The published documentation website is a presentation layer over this graph. It may reorganize
navigation or rendering for readability, but it does not replace `docs/system/**` as the canonical
source.

Top-down documentation is the default shape: readers should enter through a compact canonical
entrypoint, move into the relevant MOC, then open the smallest atomic node that answers the current
question.

For this rollout:

- scope is **instruction-engine first**
- governance remains **audit/propose first**
- edits flow through normal documentation execution only after approval

## Top-Down Documentation Model

Documentation should route from broad entrypoint to narrow authority instead of flattening the same rule into every file.

```text
README / guidelines / tool instructions
  -> docs/system/index.md
    -> relevant MOC
      -> smallest canonical node
```

| Layer | Primary job | Should contain | Must avoid |
|---|---|---|---|
| `docs/system/index.md` | global start point | route to the right MOC | rule-family detail dumps |
| MOC | cluster and route | when to read + next nodes | duplicating node policy |
| Canonical node | single source of truth for one rule family | durable policy, constraints, examples | unrelated workflow bundles |
| README / `guidelines.md` / tool instructions | discovery and local application | brief summary + pointer to canonical docs | peer-authority policy copies |

Secondary entrypoints should stay thin: tell the reader where to start, what local nuance applies,
and which canonical node owns the rule.

## Governance Scope

This lane governs:

- canonical documentation entrypoints
- repo-structure guidance that affects discoverability
- where humans should start versus where LLM workflows should start
- promotion of structural rules from ad hoc practice into canonical docs

This lane does not replace:

- `documentation-authoring` or the host's normal docs-writing lane for general Markdown execution
- the doc graph spec as the validation contract
- repo implementation docs that are already correctly placed and linked

## Human-Friendly Entrypoint Expectations

A human-friendly entrypoint should:

- be discoverable from `docs/system/index.md` or a relevant MOC
- explain purpose, audience, and when to read it
- orient a reader to the smallest useful next links
- start from compact canonical entrypoints and expand only when the current task needs more detail
- treat progressive disclosure as a standing requirement for docs and entrypoints rather than a
  one-time preference
- follow the top-down route of index -> MOC -> node unless a deterministic node is already known
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
- a docs-first load order that starts from the smallest relevant canonical entrypoint
- required inputs
- output contract
- validation hook or canonical validator reference
- links to the minimum canonical nodes needed downstream

For V1, the LLM-friendly entrypoint may be:

- a dedicated compact node, or
- a clearly labeled compact section inside the canonical overview node until a dedicated node is
  added later

The human-friendly and LLM-friendly entrypoints must agree on the same source-of-truth rules.
Progressive disclosure is a standing requirement for canonical docs and entrypoints: start compact,
expand only when the current step needs more detail, and avoid flattening the whole rule set into
every entrypoint.

Tool-facing entrypoints should therefore behave as pointers first: they may carry compact routing,
local setup notes, or output-shape reminders, but they should defer durable rule text to the
canonical nodes they cite.

## Rationale Placement and Authority Boundaries

Documentation structure should keep "why" discoverable without creating competing authority layers.

- durable workflow, policy, and architectural rationale that others must rely on belongs in
  canonical `docs/system/**` nodes
- `~/.copilot/backlogs/{repo-name}/issues/*` is the durable home for planning-worthy ideas, deferred
  findings, open questions, and recurring friction, but it does not become peer authority with
  `docs/system/**`
- code comments may carry selective local rationale, but they should stay brief and should not try to
  replace the canonical doc or issue entry that owns the broader decision
- if the same rationale would otherwise need to be copied into many comments or scattered docs, create
  or update the smallest relevant canonical node and let local surfaces point back to it
- when the repeated material is really a standing architectural tradeoff, prefer ADR promotion under
  [[adr-governance]] [docs/system/adr-governance.md](docs/system/adr-governance.md) rather than
  multiplying summary copies
- when issue logs or comments expose a repeated rationale pattern that should guide future work, route
  promotion through conventions or documentation governance instead of treating the lower-authority
  surface as final policy

## Documentation and Project-Structure Responsibilities

This lane is responsible for:

- defining which docs are entrypoints, MOCs, and atomic nodes for new governance surfaces
- ensuring repo structure guidance has a human-readable path and an LLM-usable path
- detecting duplicated, conflicting, or hidden entrypoint logic
- keeping new governance docs graph-compliant and discoverable

## Contradiction Handling

When intended work materially contradicts current documentation, the workflow must surface the
contradiction before proceeding.

- identify the conflicting docs and the specific point of disagreement
- state which source is canonical when precedence is clear
- ask the user for direction before implementation or other write-capable work continues

Do not silently resolve a material documentation conflict by coding first, overriding prompt or
asset behavior, and updating docs later.

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
2. load the smallest relevant canonical entrypoint and expand only as needed
3. verify graph compliance and discoverability
4. when intended work changes canonical design, behavior, or workflow policy, update the relevant
   canonical docs in the first execution slice before or alongside implementation
5. surface any material contradiction with current documentation before write-capable work proceeds
6. propose the smallest structural update
7. update the canonical node plus the minimal index or MOC links needed
8. validate with the doc graph validator when available

### Concision Rule

Docs and specs must be concise, map-like, and scoped to their stated purpose. Avoid tangential exposition and duplicated policy. When a concept is covered by a canonical doc, link to it rather than re-explaining it.

### Pruning Policy

When editing existing docs or specs:
- Delete obsolete, duplicated, inaccurate, or compatibility-only prose instead of preserving it by default.
- Replace stale detail with links to the current authority.
- Keep redirects only when needed for inbound path compatibility.

## Doc Freshness Sync Rule

To minimize drift between documentation and code:

- Any PR that changes a public API, contract shape, workflow policy, or CLI command name MUST also
  update the `updated` date in the owning canonical doc's frontmatter.
- When a doc describes a concrete command, script path, or file path (e.g., `node scripts/foo.js`),
  and the referenced target changes path or contract, the doc MUST be updated in the same commit or
  an immediately following commit.
- If the code change lands first (e.g., urgent hotfix), a follow-up documentation issue MUST be
  created in `~/.copilot/backlogs/{repo-name}/issues/` before the PR is merged, and the doc MUST be
  updated within 3 business days.
- Reviewer lanes SHOULD flag missing or stale frontmatter `updated` dates as a `rule_drift` finding
  when a code change touches the surface that the owning doc describes.

## References

- `docs/system/doc-graph-spec.md`
- `docs/system/index.md`
- `docs/system/mocs/orchestration-and-agents.md`
- `docs/system/search-execute-workflow.md`
- `docs/system/project-conventions-governance.md`
