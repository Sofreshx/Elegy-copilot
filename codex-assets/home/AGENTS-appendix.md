# Codex Session Defaults

Composed after the shared baseline at install time.

## Authority

Order: user instruction -> repo canonical docs -> README/maintained docs ->
implementation patterns. Report conflicts.

## Skills

Load shared skills only when they materially change the result:

| Skill | Use |
|---|---|
| `skill-discovery` | Ambiguous capability routing |
| `agents-md-authoring` | Instruction files and AGENTS.md layering |
| `elegy-ui-craft@elegy` | UI inventory, implementation guidance, runtime evidence, and review |
| `sweeper-cleanup` | Bounded cleanup |
| `elegy-planning`, `spec-*`, `rubberduck-plan-review`, `implementation-review`, `implementation-handoff` | Opt-in durable workflow |

Recommend durable workflow skills when useful. Do not load them as routine
ceremony.

Elegy plugins are the primary Codex route for Elegy-owned capabilities. Use the
`elegy` Codex marketplace when available; shared skills such as
`elegy-planning` are compatibility fallbacks.

For UI work, use `elegy-ui-craft@elegy`. The retired standalone UI skills and
vendored Impeccable package are no longer installed by this repository.

## Subagents

The shared Codex baseline owns native subagent lifecycle, model selection, and
identity. Do not install or project plugin-owned agent TOMLs that duplicate the
baseline. The main Sol agent retains requirements, architecture, integration,
and final judgment.

Default: manual. A plugin may enable automatic delegation only for sessions
where its explicit routing contract is active, and only when the task benefits
from context or token isolation. Do not fan out tiny or tightly coupled work.

Delegation contract:

- State scope, boundaries, allowed actions, output shape, and stop condition.
- Prefer one bounded read-only child before write-capable delegation.
- Native delegated workers use `gpt-5.6-luna` with effort `low`, `medium`,
  `high`, or `max`; never select a higher effort or another model family for
  this lane.
- Record agent, nickname, model, reasoning effort, source, profile, cost
  policy, write mode, and job identifier whenever the hosting surface exposes
  them. Host UI identity is best effort; plugin evidence is authoritative.
- A write-capable child requires explicit role enablement and an allowlisted
  file scope. It may not commit, push, publish, change permissions, or modify
  files outside that scope.

## Planning and Specs

Default to the smallest useful plan in the current thread. Use durable planning
or specs only when requested, multi-session, or needed for verifiable
acceptance.

## Repo Docs Breadcrumb

Repo policy: canonical docs entrypoint -> nearest routing node -> smallest
owner.

## Boundaries

- Keep global Codex guidance thin and workflow-specific.
- Put repo commands and conventions in repo-local `AGENTS.md`.
- Point to canonical docs instead of copying policy.
