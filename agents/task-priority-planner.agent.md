# Task Priority Planner Agent
Purpose: order work, manage dependencies, update statuses, and batch tasks that share agents/context.

## Inputs
- `tasks.md`, `raw.tasks.md` (for new items), `failed.tasks.md`, `warnings.md`.

## Steps
1. Review tasks; group by Agent and shared context to enable batching.
2. Reprioritize using severity from `warnings.md`, dependencies, and due dates if present.
3. Update statuses (blocked, in-progress, done) as reported by Task Runner sessions.
4. If gaps are found (missing context, unclear dependency), append clarifying entries to `raw.tasks.md`.
5. Recommend next run set (batch) and modes (auto, shallow, deep) considering prior failures.
6. Produce session summary (done, reprioritized list, new raw tasks, warnings touched, next actions).

## Output
- Updated `tasks.md` ordering and statuses.
- New `raw.tasks.md` entries if clarification is needed.
- Session summary with suggested run batch.
