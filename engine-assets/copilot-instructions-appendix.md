# Elegy Copilot Harness Appendix

Installed target: `~/.elegy/copilot-instructions.md`

## Terminal rule

`run_in_terminal` must always use `isBackground: false`.

Do not use background terminal execution for builds, tests, commits, or health
checks. Always use a non-zero timeout for long-running commands.

## Clarification rule

When the host provides `vscode/askQuestions`, use it for targeted clarification
instead of ending work with a plain-text question.

## Planning and execution

- `/plan` should use the host plan flow. For mutating or multi-phase work,
  include phased steps and validation; add rollback or recovery only for
  stateful or destructive changes.
- `/goal` and durable planning runs may auto-commit validated atomic work-unit
  checkpoints inside the approved goal or plan. Non-goal runs should offer a
  commit instead of creating one automatically.
- Use the host's native plan-review flow when available.
- Use `/fleet` only for genuinely independent streams. Define narrow validation
  at integration points when their outputs converge.

## Skills

Load shared skills only when they materially improve the result.

Common routes:

- `skill-discovery` to resolve the smallest relevant capability
- `rubberduck-plan-review` before complex plan execution
- `implementation-review` before final handoff
- `skill-authoring` and `agents-md-authoring` for shared authoring work

Prefer canonical docs and minimal routing over large copied policy blocks.
