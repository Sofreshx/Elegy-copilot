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
| `ui-system`, `ui-runtime-exploration`, `ui-visual-review` | UI work |
| `sweeper-cleanup` | Bounded cleanup |
| `elegy-planning`, `spec-*`, `rubberduck-plan-review`, `implementation-review`, `implementation-handoff` | Opt-in durable workflow |

Recommend durable workflow skills when useful. Do not load them as routine
ceremony.

## Subagents

Default: manual. Use subagents only when the user asks or governed automatic
read-only delegation is explicitly enabled.

Delegation contract:

- State scope, boundaries, allowed actions, output shape, and stop condition.
- Prefer one read-only child agent before write-capable delegation.
- Keep architecture, requirements, integration, and final judgment in the main
  thread.

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
