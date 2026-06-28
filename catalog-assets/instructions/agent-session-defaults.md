# Agent Session Defaults

Portable global instruction baseline. Installed to each harness home and
composed with a harness-specific appendix at install time.

Keep this file repo-agnostic. Put harness-specific content in the appendix.

## Repo Discovery

Before acting in a repo:

1. Read the nearest harness instruction file in the repo root or `.github/`.
2. If a deeper directory has its own instruction file, treat it as tighter
   scope for work inside that tree.
3. Fall back to `README.md`, maintained docs, and the nearest docs index.
4. Prefer repo-local validators when they exist.

## Concise Instruction Contract

Write to transfer decisions, not to sound complete.

| Use | Avoid |
|---|---|
| Named terms | Rephrasing the same rule |
| Tables and checklists | Long comparison prose |
| Diagrams | Narrative system tours |
| Links to authority | Copied policy text |

Rules:

- Start with the point.
- Use active voice.
- Use exact vocabulary.
- Keep sentences short by default.
- Define a term once, then reuse it.
- Replace vague prose with structure.
- Delete ceremony, restatement, and empty emphasis.

A section must answer at least one question:

- What is the purpose?
- What is the contract?
- When is it used?
- What can fail?
- How is it verified?
- What is the next link?

If it answers none, remove it.

## Clarification Contract

Never implement through ambiguity.

Clarify before planning or implementation when uncertainty changes:

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

Do not ask when the answer is discoverable from files, docs, tests, config, or
current state.

## Planning Contract

Before non-trivial implementation:

1. Read the relevant local sources.
2. Identify the authority path.
3. State the goal and success criteria.
4. Separate facts from assumptions.
5. Resolve blocking ambiguity.
6. Choose the smallest workable path.
7. Define validation.

A plan is ready only when another implementer can execute it without making
product or architecture decisions.

## Documentation Shape

Documentation should route downward:

```text
Harness instructions / repo instructions
  -> canonical entrypoint
    -> relevant topic
      -> smallest canonical node
```

Keep secondary surfaces thin. Point to canonical policy instead of copying it.

## Architecture Decisions

Use ADRs only for key architectural, workflow-authority, trust-boundary, or
long-lived contract decisions.

## Code Quality Posture

Hard rules:

- Remove dead code before merge.
- Keep nesting shallow; use guard clauses and early returns.
- If understanding a change requires more than three files, refactor first.
- Delete code instead of commenting it out.

Heuristics:

- Prefer the simplest solution that works.
- Keep functions focused.
- Add complexity only for a stated requirement.

## Collaboration Contract

- Optimize for the user's goal, acceptance criteria, and constraints.
- Flag material risks and weak assumptions.
- Give concise reasoning and a practical alternative.
- Preserve user authority over product decisions and tradeoffs.

## Review Rule

Review must flag:

- unclear authority
- duplicated policy
- assumptions treated as facts
- missing clarification before implementation
- vague abstractions without definitions
- long prose where structure fits better
- harness files copying policy instead of pointing to it
- dead code or unnecessary complexity

## Validation Rule

Run the narrowest relevant check after changes.

Use repo-local validators when present. When instruction or documentation
surfaces change, validate relevant links and references.

## Core Workflow

| Step | Rule |
|---|---|
| Bootstrap | Load harness instructions, then the canonical entrypoint, then the smallest relevant node. |
| Discovery | Read before deciding. |
| Clarification | Ask before crossing unclear decision boundaries. |
| Planning | Make the plan decision-complete. |
| Implementation | Edit in small verifiable steps. |
| Review | Check correctness, scope, drift, and evidence. |
| Validation | Run the smallest useful proof. |
