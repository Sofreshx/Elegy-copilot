# Agent Session Defaults

Portable global instruction baseline. Keep this repo-agnostic; harness-specific content belongs in the appendix.

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

A plan is ready only when another implementer can execute it without making product or architecture decisions.

Default to intended behavior, acceptance evidence, and stop conditions over narrow hand-holding.
For non-trivial planning, implementation, review, handoff, or debugging closure, surface the biggest missing context and least-confident point when they affect follow-up or validation. Omit this for tiny command-answer tasks and no-op reviews.

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

Merge blockers:

- Do not leave dead code introduced by the current change.
- Do not comment out code as a substitute for deletion.
- Do not add clever abstractions without a stated need.

Heuristics:

- Prefer the simplest solution that works.
- Keep functions focused.
- Keep nesting shallow; use guard clauses and early returns when they improve clarity.
- If a diff is hard to understand, split or refactor before expanding it.
- Add complexity only for a stated requirement.

## Collaboration Contract

- Optimize for the user's goal, acceptance criteria, and constraints.
- Flag material risks and weak assumptions.
- Give concise reasoning and a practical alternative.
- Preserve user authority over product decisions and tradeoffs.

## Review Rule

Review must flag:

- unclear authority
- change_narrative: current canonical doc uses temporal change framing instead of present-state description
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

---

# Copilot Instructions — Harness Appendix

Composed at install time with the shared baseline.

Installed target: `~/.elegy/copilot-instructions.md`

## Authority

| Priority | Source |
|---|---|
| 1 | Explicit user instruction |
| 2 | Repo-local canonical docs |
| 3 | `README.md` and maintained docs |
| 4 | Repeated implementation patterns |

If sources conflict, follow the highest authority and report the conflict.

## Terminal rule

`run_in_terminal` must always use `isBackground: false`.

Do not use background terminal execution for builds, tests, commits, or health
checks. Always use a non-zero timeout for long-running commands.

## Clarification rule

When the host provides `vscode/askQuestions`, use it for targeted clarification
instead of ending work with a plain-text question.

## Planning and execution

- `/plan` must produce goals, assumptions, scope, phased steps, risks,
  validation, and rollback.
- Use the host's native plan-review flow when available.
- `/fleet` should split work into independent streams with narrow validation at
  each merge point.

## Skills

Load shared skills only when they materially improve the result.

Common routes:

- `skill-discovery` to resolve the smallest relevant capability
- `rubberduck-plan-review` before complex plan execution
- `implementation-review` before final handoff
- `skill-authoring` and `agents-md-authoring` for shared authoring work

Prefer canonical docs and minimal routing over large copied policy blocks.

## Repo docs breadcrumb

For repo-specific policy, start at the repo's canonical docs entrypoint, then
the nearest routing node, then the smallest owning node.

## Boundaries

- Keep this global file workflow-specific, not repo-specific.
- Put repo policy in canonical docs or repo-local instruction files.
- Keep the Copilot home surface thin and routing-first.
