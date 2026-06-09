---
created: 2026-06-08
updated: 2026-06-09
category: system
status: current
doc_kind: node
id: concise-instruction-governance
summary: Canonical authority for concise instruction writing standards — exact vocabulary, banned empty language, clarification contract, planning contract, harness references, and review rules. Complements existing governance nodes as the unified instruction-quality entrypoint.
tags: [governance, instruction, writing, clarity, concise]
related: [project-conventions-governance, documentation-authoring-governance, documentation-structure-governance, progressive-constraint-narrowing, self-documenting-code-and-rationale-placement]
---

# Concise Instruction Governance

## Purpose

Define the canonical instruction-writing contract. This node is the single authority for how instructions must be written across all harness surfaces — concise, precise, diagram-forward, and free of vague or ceremonial prose.

## Context

Instruction governance was previously fragmented across multiple canonical docs (`project-conventions-governance`, `documentation-authoring-governance`, `documentation-structure-governance`) and the `concise-writing` skill. This node unifies the writing standards into one authority while the other nodes continue to govern structure, entrypoints, and conventions policy.

This node is the canonical authority for instruction-writing standards. The contract is now embedded directly in all harness home files (AGENTS.md, CLAUDE.md, GEMINI.md, copilot-instructions.md) so that sessions always read it without needing to discover a separate `guidelines.md` file.

## Routing

| When | Use |
|------|-----|
| Writing or reviewing instructions, prompts, agent files, or skill docs | This node |
| Deciding documentation information architecture or entrypoints | `docs/system/documentation-structure-governance.md` |
| Auditing repo conventions or `guidelines.md` policy | `docs/system/project-conventions-governance.md` |
| Choosing between code, comments, docs, or ADRs | `docs/system/self-documenting-code-and-rationale-placement.md` |
| Enforcing word budgets and banned phrases automatically | `engine-assets/skills/concise-writing/SKILL.md` |

## Concise Instruction Contract

Concise, precise instruction is required.

Write to transfer decisions, not to sound complete. Prefer exact terms, diagrams, tables, checklists, contracts, and examples over prose.

### Use / Avoid

| Use | Avoid |
|---|---|
| Named term | Repeating the same idea in new words |
| Diagram | Long system description |
| Table | Paragraph comparing options |
| Checklist | Requirement paragraph |
| Contract | Vague guidance |
| Example | Abstract explanation |
| Link | Copied policy text |

### Writing Rules

- Start with the point.
- Use active voice.
- Use short sentences by default.
- Use exact vocabulary.
- Define key terms once.
- Reuse defined terms consistently.
- Replace vague nouns with named concepts.
- Replace long explanation with a diagram, table, checklist, or example.
- Delete ceremonial openings and closings.
- Delete restatement.
- Delete throat-clearing.
- Delete empty emphasis.

### Empty Language Ban

Never use empty language such as:

- important
- powerful
- robust
- flexible
- comprehensive
- seamless
- centralized
- intuitive
- scalable
- best practice
- production ready

Use those words only when followed by a concrete mechanism, owner, boundary, or test.

**Bad:**
> This system provides a robust and flexible way to manage documentation across multiple workflows.

**Good:**
> Documentation authority:
> README → guidelines.md → docs/system/index.md → canonical node

### Section Question Requirement

A section must answer at least one question:

- What is the purpose?
- What is the contract?
- Who owns it?
- When is it used?
- What can fail?
- How is it verified?
- What is the next link?

If it answers none, remove it.

## Clarification Contract

Never implement through ambiguity.

If user intent is unclear, clarify before planning or implementation. Use available question tools when the environment provides them. Ask few questions, but make them decision-changing.

### When to Clarify

Clarify when uncertainty affects:

- scope
- architecture
- data handling
- destructive action
- external cost
- user-visible behavior
- acceptance criteria
- validation
- ownership
- security or privacy

Do not ask when the answer is discoverable from files, docs, tests, config, or current state. Investigate first.

### Good vs Bad Clarification

**Good:**
> Which source should be authoritative for this change?
> - docs/system node: durable repo policy
> - guidelines.md only: local entrypoint

**Bad:**
> Can you clarify what you want?

If two steps depend on an unstated assumption, stop and clarify before crossing that boundary.

## Planning Contract

Do not jump from intent to edits.

Before implementation:

1. Read the relevant local sources.
2. Identify the authority path.
3. State the goal and success criteria.
4. Separate facts from assumptions.
5. Resolve blocking ambiguity.
6. Choose the smallest implementation path.
7. Define validation.

Do not assume unclear parts will work out during implementation.

Use plan-first for non-trivial work. A plan is ready only when another implementer can execute it without making product or architecture decisions.

## External Practices

- [Google Developer Documentation Style Guide](https://developers.google.com/style/highlights) — clear, precise language and active voice.
- [Microsoft Writing Style Guide](https://learn.microsoft.com/en-us/style-guide/word-choice/use-simple-words-concise-sentences) — simple words and concise sentences.
- [Diátaxis](https://diataxis.fr/) — separate tutorials, how-to guides, reference, and explanation instead of mixing doc purposes.

## Validation

Before handoff, run the narrowest relevant check:

- `node scripts/validate-guidelines-wiring.mjs` — harness contract heading coverage
- Manual review: check for empty language, vague abstractions, duplicated policy

## Output Contract

Use this structure when reporting instruction governance work:

```text
INSTRUCTION_GOVERNANCE
- scope:
- canonical_node:
- writing_changes:
  - <file changed>
- drift_controls:
  - <how freshness/desync risk reduced>
- harness_coverage:
  - <harness: pass|missing|stale>
- validation:
  - <command or manual check>
```

## References

- `docs/system/harness-asset-flow.md` — harness install architecture and per-harness comparison
- `docs/system/documentation-authoring-governance.md` — documentation authoring contract
- `docs/system/documentation-structure-governance.md` — documentation IA governance
- `docs/system/self-documenting-code-and-rationale-placement.md` — rationale placement matrix
- `engine-assets/skills/concise-writing/SKILL.md` — automated concise-writing enforcement skill
- `docs/system/harness-asset-flow.md` — harness install architecture and per-harness comparison
