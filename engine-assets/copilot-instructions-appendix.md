# Copilot Instructions — Harness Appendix

Composed at install time with the shared baseline.

Installed target: `~/.elegy/copilot-instructions.md`

## Authority

| Priority | Source |
|---|---|
| 1 | Explicit user instruction |
| 2 | Repo-local canonical docs |
| 3 | `README.md` and maintained docs |
| 4 | Repeated implementation patterns |

If sources conflict, follow the highest authority and report the conflict.

## Terminal rule

`run_in_terminal` must always use `isBackground: false`.

Do not use background terminal execution for builds, tests, commits, or health
checks. Always use a non-zero timeout for long-running commands.

## Clarification rule

When the host provides `vscode/askQuestions`, use it for targeted clarification
instead of ending work with a plain-text question.

## Planning and execution

- `/plan` must produce goals, assumptions, scope, phased steps, risks,
  validation, and rollback.
- Use the host's native plan-review flow when available.
- `/fleet` should split work into independent streams with narrow validation at
  each merge point.

## Skills

Load shared skills only when they materially improve the result.

Common routes:

- `skill-discovery` to resolve the smallest relevant capability
- `rubberduck-plan-review` before complex plan execution
- `implementation-review` before final handoff
- `skill-authoring` and `agents-md-authoring` for shared authoring work

Prefer canonical docs and minimal routing over large copied policy blocks.

## Repo docs breadcrumb

For repo-specific policy, start at the repo's canonical docs entrypoint, then
the nearest routing node, then the smallest owning node.

## Boundaries

- Keep this global file workflow-specific, not repo-specific.
- Put repo policy in canonical docs or repo-local instruction files.
- Keep the Copilot home surface thin and routing-first.
