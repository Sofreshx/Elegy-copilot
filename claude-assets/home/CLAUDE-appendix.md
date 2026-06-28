# Claude Code Session Defaults — Harness Appendix

Composed at install time with the shared baseline.

## Authority

| Priority | Source |
|---|---|
| 1 | Explicit user instruction |
| 2 | Repo-local canonical docs |
| 3 | `README.md` and maintained docs |
| 4 | Repeated implementation patterns |

If sources conflict, follow the highest authority and report the conflict.

## Skills

Load shared skills only when they materially improve the result.

Common routes:

- `skill-discovery`
- `elegy-planning`
- `rubberduck-plan-review`
- `spec-dev`
- `skill-authoring`
- `agents-md-authoring`

## Repo docs breadcrumb

For repo-specific policy, start at the repo's canonical docs entrypoint, then
the nearest routing node, then the smallest owning node.

## Boundaries

- Keep this global file workflow-specific, not repo-specific.
- Put build commands, test commands, and local conventions in repo-local
  `CLAUDE.md` only when a repo actually needs them.
