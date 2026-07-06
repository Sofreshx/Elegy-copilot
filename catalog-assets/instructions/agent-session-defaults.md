# Agent Session Defaults

Portable baseline for all harnesses. Keep this repo-agnostic; put harness-only
rules in the appendix and repo-only rules in repo instructions.

## Repo Discovery

Before acting in a repo:

1. Read the nearest harness instruction file in the repo root or `.github/`.
2. Apply deeper instruction files as tighter scope.
3. Fall back to `README.md`, maintained docs, and the nearest docs index.
4. Prefer repo-local validators.

## Concise Instruction Contract

Write to transfer decisions.

| Use | Avoid |
|---|---|
| Named terms | Reworded repeats |
| Tables/checklists | Long comparison prose |
| Diagrams | Narrative tours |
| Links to authority | Copied policy |

Rules:

- Start with the point.
- Use active voice and exact vocabulary.
- Define a term once, then reuse it.
- Replace vague prose with structure.
- Delete ceremony, restatement, and empty emphasis.
- Keep only sections that state purpose, contract, use, failure, verification,
  or the next link.

## Clarification Contract

Never implement through ambiguity.

Clarify only when uncertainty changes scope, architecture, data handling,
destructive action, external cost, user-visible behavior, acceptance criteria,
validation, ownership, security, or privacy. Do not ask when the answer is
discoverable from files, docs, tests, config, or current state.

## Planning Contract

Plan non-trivial work after reading the relevant local sources.

A ready plan states goal, success criteria, authority path, facts, assumptions,
smallest workable path, validation, and stop conditions. Another implementer
must be able to execute it without making product or architecture decisions.

## Documentation Shape

Route downward:

```text
Harness or repo instructions
  -> canonical entrypoint
    -> relevant topic
      -> smallest canonical node
```

Keep secondary surfaces thin. Link canonical policy instead of copying it.

## Architecture Decisions

Use ADRs only for key architectural, workflow-authority, trust-boundary, or
long-lived contract decisions.

## Code Quality Posture

Merge blockers:

- Do not leave dead code introduced by the current change.
- Do not comment out code as a substitute for deletion.
- Do not add abstractions without a stated need.

Heuristics: choose the simplest working path, keep functions focused, keep
nesting shallow when guard clauses help, and split hard-to-read diffs before
expanding them.

## Collaboration Contract

- Optimize for the user's goal, acceptance criteria, and constraints.
- Flag material risks and weak assumptions.
- Give concise reasoning and a practical alternative.
- Preserve user authority over product decisions and tradeoffs.

## Review Rule

Review must flag unclear authority, temporal change framing in canonical docs,
duplicated policy, assumptions treated as facts, missing clarification, vague
abstractions, prose where structure fits better, copied harness policy, dead
code, and unnecessary complexity.

## Validation Rule

Run the narrowest relevant check after changes. For instruction or
documentation surfaces, validate relevant links and references.

## Git Checkpoint Rule

Keep work commit-sized. In goal or durable planning sessions, auto-commit
validated atomic work units when the approved goal or plan authorizes the
scope. In non-goal sessions, pause at natural boundaries, summarize the diff,
and offer an atomic commit. Never auto-push, auto-merge, delete branches, or
force-remove dirty worktrees.

## Core Workflow

| Step | Rule |
|---|---|
| Bootstrap | Load harness instructions, canonical entrypoint, then smallest relevant node. |
| Discovery | Read before deciding. |
| Clarification | Ask before crossing unclear decision boundaries. |
| Planning | Make non-trivial plans decision-complete. |
| Implementation | Edit in small verifiable steps. |
| Review | Check correctness, scope, drift, and evidence. |
| Validation | Run the smallest useful proof. |
