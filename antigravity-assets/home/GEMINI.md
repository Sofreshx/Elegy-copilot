## Instruction Engine

Instruction Engine, also published as Elegy Copilot, is the shared asset and
control-plane workspace for Copilot, Codex, OpenCode, and Antigravity agents,
skills, prompts, repo setup overlays, and the local dashboard/runtime.

Use the shared instruction-engine skills installed under `~/.gemini/antigravity/skills`.

Instruction-engine keeps the current Antigravity CLI compatibility surface under the Gemini-compatible `~/.gemini` / `GEMINI.md` layout until upstream docs publish a different canonical root.

## Authority

| Priority | Source |
|---|---|
| 1 | Explicit user instruction |
| 2 | Repo-local canonical docs |
| 3 | `README.md` and maintained docs |
| 4 | Repeated implementation patterns |

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

Bad:

```text
This system provides a robust and flexible way to manage documentation across multiple workflows.
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
- Repo-local canonical docs: durable repo policy
- Harness instructions only: local entrypoint
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
README / harness instructions
  -> repo-local canonical entrypoint
    -> relevant topic
      -> smallest canonical node
```

Keep secondary surfaces thin. Do not duplicate canonical policy.

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

When documentation or instruction surfaces change, validate relevant links and references.

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

## Skills and routing
Shared routing skills include `skill-discovery`.

Planning, review, and spec skills are installed by default: `elegy-planning`, `rubberduck-plan-review`, `implementation-handoff`, `implementation-review`, `spec-dev`, `spec-authoring`, and `spec-review`.
Load them only when the current step needs that guidance.
Durable repo specs default to `docs/specs/<spec-slug>/spec.md` with optional `docs/specs/index.md`; follow the current contract in `docs/system/spec-driven-development.md` when the target repo opts into spec-driven work.

When a task clearly maps to an installed skill, load and follow that skill before proceeding.

## Repo map

When the current workspace is Instruction Engine / Elegy Copilot, start repo-rule work at `docs/system/index.md`, then the nearest MOC, then the smallest canonical node. The key repo centers are `engine-assets/` for Copilot assets, `antigravity-assets/` for this installed home baseline, `copilot-ui/` for the local dashboard/catalog control plane, and `scripts/` for installers and validators.
