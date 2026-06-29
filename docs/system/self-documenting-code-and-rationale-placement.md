---
created: 2026-06-24
updated: 2026-06-24
category: system
status: current
doc_kind: node
id: self-documenting-code-and-rationale-placement
summary: Operational matrix for choosing between self-documenting code, local comments, doc comments, research design notes, canonical docs, ADRs, and thin instruction surfaces.
tags: [clarity, rationale, comments, documentation]
related: [project-conventions-governance, documentation-structure-governance, rules-compliance-audit-handoff-workflow, search-execute-workflow]
---

# Clarity Through Self-Documenting Code and Rationale Placement

## Decision matrix

Use the smallest surface that keeps the decision clear, durable, and discoverable for the next reader.

| Need | Default home | Use when | Avoid |
|---|---|---|---|
| Straightforward intent, naming, and control flow | self-documenting code with no prose | names, types, tests, and structure already make the behavior clear | narrating obvious steps |
| Local non-obvious invariant, boundary, or tradeoff | smart comment next to the code | future cleanup could weaken a real constraint or collapse intentional separation | large policy blocks or duplicated cross-file rationale |
| Public API, exported contract, or usage-time behavior | API or doc comment | callers need lifecycle, precondition, postcondition, or compatibility guidance at the usage site | restating types or private implementation detail |
| Cross-file design exploration or unresolved options | design note in `docs/research/**` | the team is still comparing approaches or recording non-canonical analysis | treating exploratory notes as policy |
| Durable architecture decision, workflow policy, or standing constraint | canonical doc or ADR in `docs/system/**` | future humans or agents must rely on the decision as a source of truth | hiding the decision in comments, issues, or prompts |
| Tool-specific routing or host-specific cue that is not meaningfully discoverable elsewhere | thin instruction surface | it is local setup or execution guidance, not durable policy | using instruction text as the only home for rules others must discover |

## Self-documenting code first

Code is the default explanation surface when a careful reader can understand the intent from names, types, tests, and structure.

- Prefer clear names, small boundaries, and explicit types before adding prose.
- Leave straightforward control flow uncommented when prose would only repeat what the code already says.
- Treat no prose as the correct choice when the missing information is not rationale, contract, or boundary context.

## When smart comments are warranted

Smart comments are for local rationale that would be easy to erase by mistake during cleanup or refactor.

- Use a short local comment when the code protects a non-obvious invariant, security boundary, protocol quirk, or intentional duplication.
- Keep the comment adjacent to the code it explains and scoped to the local reason the shape must stay as-is.
- If the explanation now spans multiple files, workflows, or owners, promote the broader rationale and leave only a short local reminder.

## When doc comments are warranted

Doc comments are for consumers who need contract information at the point of use.

- Add doc comments to exported APIs, commands, schemas, or extension points when callers need behavior, lifecycle, or compatibility guidance without opening the implementation.
- Document the contract and constraints, not a line-by-line walkthrough of how the implementation works.
- Skip doc comments on private or local code when names, types, tests, and nearby call sites already carry the meaning.

## When to promote to ADR or canonical docs

Promote rationale once the explanation stops being local and starts guiding future work across files, workflows, or teams.

- Put exploratory design reasoning and unratified alternatives in `docs/research/**`.
- Promote durable workflow or rule guidance into [[project-conventions-governance]] [project-conventions-governance.md](project-conventions-governance.md) or the smallest sibling canonical node that owns the rule family.
- Use an ADR in `docs/system/**` when the decision is architectural and future readers need the chosen option plus the durable tradeoff record.
- If the same rationale would otherwise be copied into multiple comments or tool instructions, the doc graph is the right home.

## Discoverability guidance

Discoverability should come from stable doc-graph edges, not improvised tags.

- Prefer unique ids, precise Markdown links, `related`, and focused `tags` for durable retrieval.
- Add the smallest natural breadcrumb in the relevant MOC or overview node when a new canonical rule family is introduced.
- Fix poor discoverability by improving index -> MOC -> node routing, not by scattering free-form hashtags across comments, issues, or prompts.
- Use instruction text to point at canonical docs, not to invent a parallel search surface.

## Instruction-surface rule: non-discoverable-only

Instruction surfaces are a non-discoverable-only lane for concise local guidance that does not need to become durable policy.

- Keep agent instructions to tool affordances, host-specific setup notes, or routing cues that are not meaningfully discoverable elsewhere.
- If humans or multiple agents must be able to find, compare, or rely on a rule later, move it into canonical docs and point to it from the instruction surface.
- When a compact instruction surface and a canonical doc disagree, follow the canonical doc and treat the instruction text as drift.

## Default heuristics

Use these defaults when the boundary is unclear.

1. Try clearer names, types, and tests before adding prose.
2. Add a smart comment only when removing it would make the code easier to misread or oversimplify.
3. Add a doc comment only when a consumer needs contract guidance at the usage site.
4. Promote to `docs/system/**` or an ADR once the rationale crosses file or workflow boundaries.
5. Improve ids, related links, and tags before inventing ad hoc discoverability markers.