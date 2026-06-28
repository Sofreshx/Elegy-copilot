# Codex Session Defaults — Harness Appendix

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

Load shared skills only when they materially change the result.

Common routes:

- `elegy-planning` for durable planning state when available
- `skill-discovery` when the right shared skill is still ambiguous
- `rubberduck-plan-review` before complex plan execution
- `implementation-review` before handoff when self-review is needed
- `skill-authoring` and `agents-md-authoring` for shared skill or instruction work

## Planning Availability

Before planning work, check whether `elegy-planning` is on PATH.

If it is available, prefer it for durable planning state. If not, fall back to
repo-local planning surfaces.

## Repo docs breadcrumb

For repo-specific policy, start at the repo's canonical docs entrypoint, then
open the nearest routing node, then the smallest owning node.

## Boundaries

- Keep this global file workflow-specific, not repo-specific.
- Put build commands, test commands, and local conventions in repo-local
  `AGENTS.md` only when a repo actually needs them.
- Keep the global Codex surface thin; point to canonical docs instead of
  carrying repo policy here.
