---
created: 2026-05-25
updated: 2026-06-18
category: system
status: current
doc_kind: node
id: progressive-constraint-narrowing
summary: Canonical rule for narrowing candidate constraints into the minimum authoritative set needed for the current planning, delegation, or execution step.
tags: [constraints, planning, delegation, governance]
related: [search-execute-workflow, calibrated-questioning-and-depth-governance, project-conventions-governance, adr-governance, planpack-spec]
---

# Progressive Constraint Narrowing

## Purpose

Define how Elegy Copilot should shrink a broad pool of candidate constraints into the smallest
authoritative set needed for the current step.

This rule is shared across planning, delegation, review, installed shared skills, and harness-facing
instruction surfaces.

## Why this exists

Constraint lists tend to bloat as context moves through docs, plans, prompts, skills, and handoff
briefs.

Without narrowing:

- downstream workers receive too much noise
- local hints get mistaken for durable policy
- architectural decisions get repeated in prompts instead of promoted into canonical docs or ADRs
- different harnesses drift because each one carries a slightly different restatement of the same rule

## Constraint classes

Classify candidate constraints before passing them downstream.

| Class | Meaning | Downstream posture |
|---|---|---|
| hard constraint | omitting it would likely cause wrong behavior, unsafe behavior, or contract drift | keep in the active brief |
| shaping context | useful context, preference, or local pattern that helps choose among valid options | keep only when it materially changes the active step |
| open question | unresolved branch that still needs evidence or user direction | do not flatten into a fake constraint |
| durable decision | standing cross-boundary constraint or architectural choice that should stay discoverable later | promote to canonical docs or ADR when it is not already there |

## Narrowing workflow

Apply this workflow in order.

1. Collect candidate constraints from the current user request, canonical docs, approved repo-local guidance, and strong repo evidence.
2. Remove non-authoritative restatements, duplicated wording, and one-off local habits.
3. Separate hard constraints from shaping context and open questions.
4. Keep only the minimum hard constraints needed for the current step.
5. Carry shaping context only when omitting it would plausibly widen scope, validation, ownership, or architecture.
6. Escalate open questions through the normal evidence-bound questioning ladder instead of smuggling them into `constraints`.
7. Promote durable cross-boundary constraints into canonical docs or an ADR when future humans or agents will need to rely on them later.

## Authority order

When candidate constraints conflict, resolve them in this order:

1. explicit user instruction for the current task
2. canonical docs in `docs/system/**`
3. nearest applicable approved repo-local operating guidance such as a per-harness
   instruction file (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`,
   .github/copilot-instructions.md)
4. other maintained repo docs
5. repeated implementation patterns with strong evidence
6. exploratory notes, prompts, or summaries

If the authoritative sources still conflict materially, stop and surface the contradiction.

## Planning and delegation rules

- Planning should begin broad enough to identify the real constraint set, then end with the narrowest hard-constraint set that still protects correctness and scope.
- Delegation payloads should include only the hard constraints and the minimum shaping context that matter to the active leaf.
- Installed shared skills should prefer this narrowed set over long narrative policy copies.
- Review should flag both under-constrained plans and overstuffed briefs that carry noise as if it were policy.

## Observable outputs

When a plan, execution brief, or review outcome includes constraints, it should make the following distinction legible even if the output schema is compact:

- hard constraints
- assumptions or shaping context
- unresolved questions

If the current output format does not have dedicated fields, the author should still keep the distinction explicit in wording rather than mixing all three into one undifferentiated list.

## ADR handoff rule

When narrowing reveals a durable architectural or workflow-authority constraint that future work will need, do not keep restating it in harness instructions, plan notes, or handoff prose.

Promote it to the owning canonical node or to [[adr-governance]] [adr-governance.md](adr-governance.md).

## Anti-patterns

- copying the full upstream rule set into every downstream brief
- treating preferences, open questions, and hard constraints as one list
- carrying repo habits as if they outrank canonical docs
- using harness home instructions as the only place a durable constraint exists
- solving a missing-doc problem by repeating the rule in more prompts

## Output shorthand

Use this mental template when the boundary is unclear:

- what must not be violated right now?
- what only shapes a valid choice?
- what is still unknown?
- what has become durable enough that it should move into canonical docs or an ADR?

## References

- `docs/system/search-execute-workflow.md`
- `docs/system/calibrated-questioning-and-depth-governance.md`
- `docs/system/project-conventions-governance.md`
- `docs/system/adr-governance.md`
- `docs/system/planpack-spec.md`
