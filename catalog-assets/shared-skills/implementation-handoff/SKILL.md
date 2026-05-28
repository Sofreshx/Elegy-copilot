---
name: implementation-handoff
description: "Convert a feature plan, roadmap slice, or architecture note into a repo-grounded implementation handoff brief for another coding model, especially a weaker, cheaper, or lower-context executor. Use during planning before implementation, delegation, or model handoff when the executor needs concrete file evidence, sequencing, tests, validation commands, edge cases, non-goals, and stop conditions."
---

# Implementation Handoff

## Purpose

Turn an already plausible plan into an executor-ready brief. Optimize for reducing unresolved implementation decisions, not for adding volume.

Use this skill after a normal plan exists and before code changes begin when a different model, lower-context session, or future implementation run may execute the work.

## Do Not Use

- Do not use for trivial one-file edits where the implementer can inspect the target directly.
- Do not use to invent architecture before repo evidence exists.
- Do not use as a substitute for `rubberduck-plan-review` when the plan itself may be unsafe or incomplete.
- Do not implement, stage, commit, or edit product files while preparing the handoff.

## Workflow

1. Restate the goal, accepted scope, and explicit non-goals in one compact paragraph.
2. Read bounded repo evidence:
   - active `AGENTS.md` or repo instructions,
   - docs named by the plan,
   - files, modules, tests, schemas, commands, or APIs named by the plan,
   - nearest existing patterns for each planned layer.
3. Convert the plan into an ordered implementation sequence. Each step should name concrete files or code areas when known.
4. Separate proven repo facts from assumptions. If a file or API is likely but unverified, label it `unconfirmed` instead of presenting it as fact.
5. Separate hard constraints from shaping context and open questions instead of flattening them into one undifferentiated brief.
6. Call out any key architectural or workflow-authority decision that should be captured in an ADR so the implementer does not treat the handoff as the long-term source of truth.
7. Add edge cases, validation commands, and stop conditions that help a less capable executor avoid confident wrong changes.
8. Keep the brief concise enough to paste into a new coding session.

## Handoff Rules

- Prefer repo-local names, paths, commands, tests, and examples over generic advice.
- Every major implementation step should cite evidence, usually a file path, test name, command, or documented contract.
- Keep the active brief narrowed: preserve only the hard constraints and the minimum shaping context needed for correct execution.
- Preserve non-goals close to the steps where scope creep is likely.
- Include enough sequencing to avoid circular or premature edits: contracts/types first, storage or state next, runtime wiring next, user/API surfaces next, tests and validation last.
- Include acceptance checks that are observable by tests, builds, smoke commands, or inspection.
- Include rollback, migration, compatibility, permission, or data-safety notes when relevant.
- Avoid line-by-line pseudocode unless it is copied from an existing local pattern.
- Avoid broad instructions such as "make robust", "clean up", or "handle errors" unless paired with concrete cases.

## Model Calibration

For a weaker or cheaper executor:
- reduce ambiguity by naming the exact patterns to copy,
- make dependencies and order explicit,
- call out where not to generalize,
- include stop conditions for architectural surprises,
- keep the task slice small enough for one implementation pass.

For a strong executor:
- keep the brief shorter and emphasize invariants, non-goals, and validation.

## Output Contract

Use this format:

```text
IMPLEMENTATION_HANDOFF_BRIEF

Goal:
- <what to implement>

Non-Goals:
- <what must remain out of scope>

Repo Evidence:
- <path or command>: <why it matters>

Implementation Sequence:
1. <ordered task with target files/areas and rationale>
2. <ordered task>

Behavioral Requirements:
- <observable behavior or invariant>

Edge Cases:
- <case the executor must cover or explicitly preserve>

Tests And Validation:
- <specific tests to add or update>
- <commands to run, from repo docs or nearest package config>

Hard Constraints:
- <must-not-violate rule or none>

Shaping Context:
- <useful but non-hard context or none>

ADR Follow-Up:
- <required adr or none>

Stop Conditions:
- <when the executor should pause instead of guessing>

Handoff Notes:
- <assumptions, risks, or none>
```

Do not include a long summary after the brief. The brief itself is the artifact.
