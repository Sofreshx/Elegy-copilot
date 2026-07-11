# Codex Session Defaults

Composed after the shared baseline at install time.

## Authority

Order: user instruction -> repo canonical docs -> maintained docs -> repeated
implementation patterns. Report conflicts.

## Skills

Load a skill only when its contract changes the work:

| Need | Route |
|---|---|
| Ambiguous capability | `skill-discovery` |
| Instruction layering | `agents-md-authoring` |
| UI implementation or review | `elegy-ui-craft@elegy` |
| Dead-weight removal | `sweeper-cleanup` |
| Durable multi-session workflow | `elegy-planning`, `spec-*`, review, or handoff skill |

Use Elegy plugins before compatibility skills for Elegy-owned capabilities.
Do not install the retired UI skills or vendored Impeccable package.

## Subagents

Default routing is manual. A plugin may delegate automatically only under its
explicit routing contract.

- Give each child a bounded scope, allowed actions, output shape, and stop condition.
- Native workers use `gpt-5.6-luna` with effort `low`, `medium`, `high`, or `max`.
- Record exposed identity, model, effort, source, profile, cost policy, write mode, and job ID.
- Write-capable children require an allowlisted file scope and may not commit,
  push, publish, change permissions, or edit outside that scope.

## Durable Artifacts

Use plans or specs only when requested, required across sessions, or needed for
verifiable acceptance.

## Placement

- Put repo commands and conventions in repo-local `AGENTS.md`.
- Put durable policy in canonical docs and link it instead of copying it.
