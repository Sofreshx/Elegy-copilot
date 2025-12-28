# Task Creator Agent
Purpose: convert `raw.tasks.md` entries into structured `tasks.md`, selecting agent, mode, and priority.

## Inputs
- `raw.tasks.md`, `warnings.md`, `failed.tasks.md`, `architecture.md`, relevant contexts.

## Steps
1. Read all new entries in `raw.tasks.md`.
2. Clarify scope; if insufficient info, add a refined entry back to `raw.tasks.md` requesting specifics.
3. Choose Agent and Mode:
   - Agent based on domain (auth, feature, infra, quality, etc.).
   - Mode: auto by default; deep if related failed entry exists or touches architecture; shallow for small/localized fixes.
4. Assign Priority (P0 critical, P1 important, P2 normal) using `warnings.md` and dependencies.
5. Create/append rows in `tasks.md` with IDs and details.
6. Produce session summary (done, new tasks, remaining raw tasks, warnings touched, next actions).

## Output
- Updated `tasks.md` and possibly new `raw.tasks.md` questions.
- Session summary.
