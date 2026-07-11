---
created: 2026-06-08
updated: 2026-06-29
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

Instruction governance was previously fragmented across multiple canonical docs (`project-conventions-governance`, `documentation-authoring-governance`, `documentation-structure-governance`). This node unifies the writing standards into one authority while the other nodes continue to govern structure, entrypoints, and conventions policy.

This node is the canonical authority for instruction-writing standards. The contract lives in a single shared portable baseline at `catalog-assets/instructions/agent-session-defaults.md`. At install time, each harness installer composes the shared baseline with a harness-specific appendix to produce the installed instruction file (AGENTS.md, CLAUDE.md, GEMINI.md, copilot-instructions.md). Between the baseline and appendix, an optional user collaboration profile (preset + custom instructions) from `~/.elegy/config.json` is injected. See `docs/system/collaboration-profile-adr.md` for the profile architecture.

## Routing

| When | Use |
|------|-----|
| Writing or reviewing instructions, prompts, agent files, or skill docs | This node |
| Deciding documentation information architecture or entrypoints | `docs/system/documentation-structure-governance.md` |
| Auditing repo conventions or per-harness instruction file policy | `docs/system/project-conventions-governance.md` |
| Choosing between code, comments, docs, or ADRs | `docs/system/self-documenting-code-and-rationale-placement.md` |

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
- Write current canonical docs that describe live state in present state. Do not frame them as change narrative.

### Retention Test

Retain a model-facing directive only when it supplies at least one of:

- a trigger or applicability condition
- an exact action, technique, tool, or interface
- a permission, trust, cost, or mutation boundary
- a failure mode and required response
- an output contract or acceptance check
- a repository- or harness-specific fact the model cannot discover reliably

Remove capability reminders and intensity modifiers such as “plan carefully,”
“think thoroughly,” “be concise,” “use your judgment,” or “produce high-quality
work.” Replace them only when the missing operational rule is known.

Harness-specific extra guidance requires a named limitation or failure mode.
Do not place weaker-model scaffolding in the shared baseline or a Codex-reachable
asset.

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
> - Per-harness instruction file only: local entrypoint

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

## Outcome-Oriented Instructions

Instructions should name the result, contract, acceptance evidence, and stop conditions before step-by-step guidance.

Use narrow procedural detail only when it prevents a known failure mode, protects a boundary, or helps a weaker executor avoid an unsafe guess. Prefer:

- intended behavior over internal narration
- acceptance checks over broad success claims
- failure behavior over generic robustness language
- stop conditions over permission to improvise through ambiguity

## External Practices

- [Google Developer Documentation Style Guide](https://developers.google.com/style/highlights) — clear, precise language and active voice.
- [Microsoft Writing Style Guide](https://learn.microsoft.com/en-us/style-guide/word-choice/use-simple-words-concise-sentences) — simple words and concise sentences.
- [Diátaxis](https://diataxis.fr/) — separate tutorials, how-to guides, reference, and explanation instead of mixing doc purposes.

## Validation

Before handoff, run the narrowest relevant check:

- `node scripts/validate-instruction-wiring.mjs` — validates shared baseline exists, appendix files are present per harness, compose integrity (no missing sections), and no banned terms in the baseline
- `node scripts/validate-instruction-quality.mjs` — scans first-party shipped instructions, agents, prompts, skills, and model-facing references for budgets, repeated prose, prompt theory, ceremony, vague intensity, and non-actionable directives
- Manual review: apply the retention test because semantic fluff cannot be exhaustively detected by phrase matching

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
- `docs/system/harness-asset-flow.md` — harness install architecture and per-harness comparison
