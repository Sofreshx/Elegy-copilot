# Antigravity Session Defaults — Harness Appendix

Composed at install time with the shared baseline.

## Authority

| Priority | Source |
|---|---|
| 1 | Explicit user instruction |
| 2 | Repo-local canonical docs |
| 3 | `README.md` and maintained docs |
| 4 | Repeated implementation patterns |

If sources conflict, follow the highest authority and report the conflict.

## Skills and routing

Shared routing starts with `skill-discovery`.

Common routes:

- `elegy-planning` for durable planning state
- `rubberduck-plan-review` and `implementation-review` for review gates
- `spec-dev` and `spec-authoring` for spec-driven work
- `skill-authoring` and `agents-md-authoring` for shared authoring work

Load skills only when the current step needs them.

## Repo docs breadcrumb

For repo-specific policy, start at the repo's canonical docs entrypoint, then
the nearest routing node, then the smallest owning node.
