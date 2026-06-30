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
- `ui-system` for repo-grounded UI implementation and reuse
- `ui-runtime-exploration` for browser/Tauri runtime routing
- `ui-visual-review` for read-only UI evidence review
- `rubberduck-plan-review` before complex plan execution
- `implementation-review` before handoff when self-review is needed
- `sweeper-cleanup` for dead code, unused dependency, stale asset, and unshipping work
- `agents-md-authoring` for shared instruction work

## Codex lanes

| Lane | Surface | Use |
|---|---|---|
| planning | `elegy-planning` skill | Durable goals, roadmaps, plans, and multi-session work |
| review | `reviewer` subagent | Read-heavy plan, diff, and evidence review |
| sweeper | `sweeper` subagent + `sweeper-cleanup` skill | Evidence-backed removal of dead code, stale assets, and unused dependencies |

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
