# Codex Session Defaults

Composed with the shared baseline at install time.

## Authority

Order: user instruction → repo canonical docs → README/maintained docs →
implementation patterns. Report conflicts.

## Skills

Load shared skills only when they materially change the result:

- `skill-discovery` for ambiguous capability routing.
- `ui-system`, `ui-runtime-exploration`, `ui-visual-review` for UI work.
- `sweeper-cleanup` for bounded cleanup.
- `agents-md-authoring` for instruction files.
- `elegy-planning`, `spec-*`, `rubberduck-plan-review`,
  `implementation-review`, and `implementation-handoff` are opt-in durable
  workflow tools. Recommend when useful; do not load as routine ceremony.

## Subagents

Default: manual. Use subagents when the user asks, or when governed automatic
read-only delegation is explicitly enabled.

| Agent | Use |
|---|---|
| `explorer` | Read-only repo mapping that would create about five or more noisy tool calls. |
| `reviewer` | Read-heavy independent review. |
| `sweeper` | Bounded cleanup with evidence. |

Delegation gates:

- State scope, boundaries, allowed actions, output shape, and stop condition.
- Prefer one child agent.
- Prefer read-only agents before write-capable agents.
- Keep architecture, requirements, integration, and final judgment in the main thread.
- Treat per-agent MCP limits as configured intent, not hard isolation.

## Planning and specs

Default to the smallest useful plan in the current thread. Use durable planning
or specs only when requested, multi-session, or needed for verifiable acceptance.

## Repo docs breadcrumb

Repo policy: canonical docs entrypoint → nearest routing node → smallest owner.

## Boundaries

- Keep global Codex guidance thin and workflow-specific.
- Put repo commands and conventions in repo-local `AGENTS.md`.
- Point to canonical docs instead of copying policy.
