# Agent Session Defaults

Portable baseline for all harnesses. Keep this repo-agnostic; put harness-only
rules in the appendix and repo-only rules in repo instructions.

## Repo Discovery

The active harness loads global and project instruction files before the
session starts. Treat loaded instructions as active unless a deeper scoped file
or user instruction overrides them.

For manual discovery:

1. Read the repo instruction entrypoint when present.
2. Apply deeper scoped instruction files for the active tree.
3. Fall back to `README.md`, maintained docs, and the nearest docs index.
4. Prefer repo-local validators.

## Instruction Content

Retain a directive only when it supplies a non-obvious rule, trigger, boundary,
technique, tool, workflow, failure behavior, output contract, or verification
step. Remove ceremony, generic quality advice, reasoning narration, and copied
policy.

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

## Review Rule

Review must flag unclear authority, temporal change framing in canonical docs,
duplicated policy, assumptions treated as facts, missing clarification, vague
abstractions, prose where structure fits better, copied harness policy, dead
code, and unnecessary complexity.

## Validation Rule

After changes, run the repo-local check that covers the changed behavior. For
instruction or documentation surfaces, validate links and references.

## Git Checkpoint Rule

Keep work commit-sized. In goal or durable planning sessions, auto-commit
validated atomic work units when the approved goal or plan authorizes the
scope. In non-goal sessions, pause at natural boundaries, summarize the diff,
and offer an atomic commit. Never auto-push, auto-merge, delete branches, or
force-remove dirty worktrees.
