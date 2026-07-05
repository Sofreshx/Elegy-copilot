---
name: implementation-handoff
description: "Deepen plans into decision-complete implementation briefs for another harness, model, executor, or session. Use when delegating implementation, preparing a model handoff, or when a downstream executor should not need to redesign or re-plan the work."
metadata: {"allowedDuplicateNameGroup":"implementation-handoff","variant":"codex"}
---

# Implementation Handoff

## Purpose

Produce an executor-ready brief from a proposed plan. Resolve implementation decisions before
handoff so a weaker or context-limited executor can implement without redesigning the solution.

## Trigger

Use this skill when the user delegates implementation to:

- another harness or model,
- another Codex session,
- an executor or implementation agent,
- a weaker or cheaper model,
- a future session that will not retain the current context.

Do not trigger for an ordinary plan that the current Codex session will implement.

## Required Inputs

- User goal, constraints, and accepted scope.
- Proposed plan, spec, roadmap slice, or architecture note.
- Active repository instructions and canonical docs.
- Relevant implementation, interface, schema, configuration, and test evidence.
- Known validation commands and acceptance criteria.

## Workflow

1. Restate the goal, success criteria, scope, and non-goals.
2. Inspect bounded repository evidence:
   - active instructions and canonical docs,
   - files, modules, APIs, schemas, and tests named by the source plan,
   - nearest existing pattern for each affected layer,
   - package-local validation commands.
3. Classify the source plan:
   - `ready`: already safe and substantially decision-complete,
   - `shallow`: direction is sound but implementation decisions are missing,
   - `unsafe`: architecture, scope, ordering, or acceptance criteria are unresolved.
4. For a complex, shallow, or unsafe plan, load `rubberduck-plan-review` and apply its review
   before writing the handoff.
   - `ready`: continue.
   - `revise`: incorporate every required plan edit, then review the revised plan again.
   - `blocked`: stop and request the missing decision. Do not emit a final handoff brief.
5. Deepen the plan until the executor does not need to make product or architecture decisions:
   - name concrete files or code areas when proven,
   - define interfaces, data flow, state transitions, and user-visible behavior when affected,
   - make dependencies and implementation order explicit,
   - state compatibility, migration, permission, and data-safety constraints when relevant,
   - define exact failure behavior and edge cases,
   - identify the existing pattern to copy and where not to generalize.
6. Separate repo facts from assumptions. Mark unverified claims as `unconfirmed`.
7. Define tests, validation commands, observable acceptance checks, and stop conditions.
8. Run the completeness gate. Emit the brief only when it passes.

## Completeness Gate

The handoff is ready only when all applicable checks pass:

- Goal, success criteria, scope, and non-goals are explicit.
- Each major step names its target, intended change, dependencies, and verification.
- Public interfaces, schemas, configuration, and user-visible behavior are defined when changed.
- Repo facts have evidence; assumptions are labeled.
- Edge cases and failure behavior are concrete.
- Tests and commands prove the acceptance criteria.
- Architectural surprises have stop conditions.
- The executor is told where not to generalize or expand scope.
- No blocking decision is deferred to the executor.

Reject vague instructions such as `update the logic`, `handle errors`, `make it robust`, or
`add tests` unless they name concrete targets, cases, and expected outcomes.

## Executor Calibration

Default the executor capability to `weak-or-unknown` unless the user states otherwise.

For `weak-or-unknown` executors:

- keep each step bounded to one coherent change,
- name exact patterns and evidence to follow,
- state sequencing and dependencies explicitly,
- provide concrete expected results,
- add stop conditions instead of permitting guesses.

For strong executors, retain the same decisions but compress explanatory context.

## Output Contract

```text
IMPLEMENTATION_HANDOFF_BRIEF

Goal:
- <implementation outcome>

Success Criteria:
- <observable completion condition>

Non-Goals:
- <explicit exclusions>

Executor Profile:
- weak-or-unknown | strong

Repo Evidence:
- <path, symbol, test, command, or contract>: <what it proves>

Assumptions:
- <unconfirmed assumption or none>

Implementation Sequence:
1. Target: <files or code area>
   Change: <exact behavior or interface change>
   Dependencies: <prior step or none>
   Pattern: <existing implementation to follow>
   Do Not: <scope/generalization boundary>
   Verify: <test, command, or observable result>

Behavioral And Interface Requirements:
- <invariant, API/schema/config shape, data flow, or user-visible behavior>

Edge Cases And Failure Behavior:
- <input/state/failure>: <required outcome>

Tests And Validation:
- <test cases to add or update>
- <commands to run>
- <acceptance evidence>
- <edge/state/timing/dependency case the validation must cover>

Compatibility And Safety:
- <migration, rollback, permission, data-safety, or compatibility rule; or none>

ADR Follow-Up:
- <required ADR or none>

Stop Conditions:
- <condition requiring clarification instead of guessing>

Handoff Notes:
- <remaining non-blocking context, biggest missing context, least-confident point, or none>
```

Do not append an alternate plan or long summary. The brief is the handoff artifact.
