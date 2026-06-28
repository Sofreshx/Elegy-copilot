# OpenCode Session Defaults — Harness Appendix

Composed at install time with the shared baseline.

## Authority

| Priority | Source |
|---|---|
| 1 | Explicit user instruction |
| 2 | Repo-local canonical docs |
| 3 | `README.md` and maintained docs |
| 4 | Repeated implementation patterns |

If sources conflict, follow the highest authority and report the conflict.

## Native agents

OpenCode's built-in agents stay primary:

- `Build` for execution
- `Plan` for planning without edits
- `Explore` for read-only discovery
- `Scout` for external research
- `General` for bounded delegated work

## Skills

Load shared skills only when they materially improve the result.

Common routes:

- `skill-discovery` to choose the right shared capability
- `elegy-planning` for durable planning state
- `planning-tools` and `project-workflow` for OpenCode project lanes
- `rubberduck-plan-review` and `implementation-review` for review gates
- `skill-authoring` and `agents-md-authoring` for shared authoring work

## Profiles

Treat profile and model routing as harness configuration, not repo policy.
Use the OpenCode setup surface or profile switch tooling when model routing
changes are required.

## Repo docs breadcrumb

For repo-specific policy, start at the repo's canonical docs entrypoint, then
the nearest routing node, then the smallest owning node.

## Boundaries

- Keep this global file workflow-specific, not repo-specific.
- Put build commands, test commands, and local conventions in repo-local
  `AGENTS.md` only when a repo actually needs them.
- Do not recreate repo policy, catalog maps, or workspace-specific authority in
  this global surface.
