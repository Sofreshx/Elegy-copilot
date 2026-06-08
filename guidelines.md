# Guidelines

Starting point for documentation: `docs/system/index.md`.

Canonical authority lives in `docs/system/**`. This file is the local starting point.

## Authority

| Priority | Source |
|---|---|
| 1 | Explicit user instruction |
| 2 | `docs/system/**` |
| 3 | Nearest `guidelines.md` |
| 4 | `README.md` and maintained docs |
| 5 | Repeated implementation patterns |

If sources conflict, follow the highest authority and report the conflict.

## Concise Instruction Contract

Concise, precise instruction is required.

Write to transfer decisions, not to sound complete. Prefer exact terms, diagrams, tables, checklists, contracts, and examples over prose.

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

Bad:

```text
This system provides a robust and flexible way to manage documentation across multiple workflows.
```

Good:

```text
Documentation authority:
README -> guidelines.md -> docs/system/index.md -> canonical node
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

If user intent is unclear, clarify before planning or implementation. Use available question tools when the environment provides them. Ask few questions, but make them decision-changing.

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

Good clarification:

```text
Which source should be authoritative for this change?
- docs/system node: durable repo policy
- guidelines.md only: local entrypoint
```

Bad clarification:

```text
Can you clarify what you want?
```

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
README / guidelines / harness instructions
  -> docs/system/index.md
    -> relevant MOC
      -> smallest canonical node
```

Keep secondary surfaces thin. Do not duplicate canonical policy.

## Harness Rule

Every harness must reference this contract.

Required surfaces:

- root `AGENTS.md`
- Codex home instructions
- OpenCode home instructions
- Claude Code instructions or managed config
- Copilot instructions
- Gemini or Antigravity instructions when present

Harness files should point here with one compact sentence.

Recommended pointer:

```text
Follow `guidelines.md`: clarify ambiguity before implementation; write concise, precise, diagram-forward instructions; avoid vague or ceremonial prose.
```

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

## Validation Rule

Run the narrowest relevant check after changes.

Use repo-local validators when present. Do not invent global commands.

When documentation or instruction surfaces change, validate:

- doc graph links
- harness references
- managed asset manifests
- setup/status checks
- UI display if a status surface changed

## Core Workflow

| Step | Rule |
|---|---|
| Bootstrap | Load `guidelines.md`, then `docs/system/index.md`, then the smallest relevant canonical node. |
| Discovery | Read before deciding. |
| Clarification | Ask before crossing unclear decision boundaries. |
| Planning | Make the plan decision-complete. |
| Implementation | Edit in small verifiable steps. |
| Review | Check correctness, scope, drift, and evidence. |
| Validation | Run the smallest useful proof. |

## Key Links

- `docs/system/index.md`
- `docs/system/project-conventions-governance.md`
- `docs/system/documentation-structure-governance.md`
- `docs/system/self-documenting-code-and-rationale-placement.md`
- `docs/system/search-execute-workflow.md`

## External Practices

- [Google Developer Documentation Style Guide](https://developers.google.com/style/highlights) — clear, precise language and active voice.
- [Microsoft Writing Style Guide](https://learn.microsoft.com/en-us/style-guide/word-choice/use-simple-words-concise-sentences) — simple words and concise sentences.
- [Diátaxis](https://diataxis.fr/) — separate tutorials, how-to guides, reference, and explanation instead of mixing doc purposes.
