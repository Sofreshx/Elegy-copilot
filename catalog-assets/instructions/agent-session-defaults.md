# Agent Session Defaults

Portable global instruction baseline. Installed to each harness home
(Codex, OpenCode, Claude Code, Antigravity, Copilot) and composed with a
harness-specific appendix at install time.

Keep this file repo-agnostic. Put harness-specific content in the appendix.

## Repo Discovery

Before acting in a repo, discover its authority documents:

1. Read the nearest harness instructions file (AGENTS.md, CLAUDE.md, GEMINI.md)
   in the repo root or `.github/` directory.
2. When a nested subdirectory contains its own AGENTS.md/CLAUDE.md/GEMINI.md,
   treat it as a tighter-scoped authority for work inside that tree.
3. Fall back to README.md and maintained docs.
4. Check for a docs index (docs/index.md, docs/README.md) or the closest
   maintained docs directory.
5. When present, follow repo-local validators (lint, test, typecheck).

## Concise Instruction Contract

Concise, precise instruction is required.

Write to transfer decisions, not to sound complete. Prefer exact terms,
diagrams, tables, checklists, contracts, and examples over prose.

| Use | Avoid |
|---|---|
| Named term | Repeating the same idea in new words |
| Diagram | Long system description |
| Table | Paragraph comparing options |
| Checklist | Requirement paragraph |
| Contract | Vague guidance |
| Example | Abstract explanation |
| Link | Copied policy text |

Rules:

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

Bad:

```text
This system provides a robust and flexible way to manage documentation
across multiple workflows.
```

Good:

```text
Documentation authority:
README -> canonical entrypoint -> canonical node
```

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

If user intent is unclear, clarify before planning or implementation.
Use available question tools when the environment provides them.
Ask few questions, but make them decision-changing.

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

Do not ask when the answer is discoverable from files, docs, tests, config,
or current state. Investigate first.

Good clarification:

```text
Which source should be authoritative for this change?
- Repo-local canonical docs: durable repo policy
- Harness instructions only: local entrypoint
```

Bad clarification:

```text
Can you clarify what you want?
```

If two steps depend on an unstated assumption, stop and clarify before
crossing that boundary.

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

Use plan-first for non-trivial work. A plan is ready only when another
implementer can execute it without making product or architecture decisions.

## Documentation Shape

Default shape:

```text
Point
Contract, diagram, or table
Operational details
Validation or next link
```

Documentation should route downward:

```text
Harness instructions / repo AGENTS.md
  -> repo-local canonical entrypoint
    -> relevant topic
      -> smallest canonical node
```

Keep secondary surfaces thin. Do not duplicate canonical policy.

## Architecture Decisions

Use ADRs only for key architectural, workflow-authority, trust-boundary, or
long-lived contract decisions. Do not create ADRs for ordinary local
implementation choices.

## Code Quality Posture

Hard rules:

- Always remove dead code before merging. Reviewers flag dead code as
  blocking.
- Keep nesting shallow. Maximum four levels; use early returns and guard
  clauses to flatten.
- If a change requires understanding more than three files in the same diff,
  refactor first.
- Delete code, do not comment it out. Version control preserves history.

Heuristics:

- Prefer the simplest solution that works. Reject clever complexity.
- Keep functions focused. Split when a function does more than one job.
- Add complexity only when justified by a stated or measured requirement.

Failure to follow this posture in a change is a review-blocker.

## Collaboration Contract

Treat proposed implementation approaches as shaping context unless explicitly
constrained or supported as the best practical route.

- Optimize for the user's goal, acceptance criteria, and constraints.
- Flag material risks, weak assumptions, and unsound technical choices.
- Give concise reasoning and a practical alternative.
- Avoid performative agreement, disagreement, praise, and contrarianism.
- Preserve user authority over product decisions and material tradeoffs.

## Review Rule

Review must flag instruction drift.

Flag:

- vague abstractions without definitions
- long prose where structure fits better
- duplicated policy
- unclear authority
- missing clarification before implementation
- assumptions treated as facts
- sections with no purpose, contract, usage, failure mode, validation, or next link
- harness files copying policy instead of pointing to it
- UI copy that explains instead of naming state and action
- dead code left in place
- unnecessary nesting or complexity that should have been flattened
- clever abstractions without a stated need

## Validation Rule

Run the narrowest relevant check after changes.

Use repo-local validators when present. Do not invent global commands.

When documentation or instruction surfaces change, validate relevant links
and references.

## Core Workflow

| Step | Rule |
|---|---|
| Bootstrap | Load harness instructions, then repo-local canonical entrypoint, then the smallest relevant canonical node. |
| Discovery | Read before deciding. |
| Clarification | Ask before crossing unclear decision boundaries. |
| Planning | Make the plan decision-complete. |
| Implementation | Edit in small verifiable steps. |
| Review | Check correctness, scope, drift, and evidence. |
| Validation | Run the smallest useful proof. |

## External Practices

- [Google Developer Documentation Style Guide](https://developers.google.com/style/highlights) — clear, precise language and active voice.
- [Microsoft Writing Style Guide](https://learn.microsoft.com/en-us/style-guide/word-choice/use-simple-words-concise-sentences) — simple words and concise sentences.
- [Diátaxis](https://diataxis.fr/) — separate tutorials, how-to guides, reference, and explanation instead of mixing doc purposes.
