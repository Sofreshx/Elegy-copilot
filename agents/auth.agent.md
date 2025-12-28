# Auth Agent
---
schema-version: "1.0"
---
Purpose: implement or adjust authentication/identity flows consistent with project patterns.

## Inputs
- Task from `tasks.md`.
- `warnings.md`, `contexts/project.patterns.md`, `contexts/auth.context.md`.

## Steps
1. Read warnings and patterns to align with existing auth approach (e.g., Firebase, Auth0).
2. Mode selection: auto -> deep if prior failures or touching shared auth infra; shallow for config tweaks.
3. Confirm scope; if unclear, add a clarifying entry to `raw.tasks.md` and pause.
4. Implement changes: config, middleware/filters, token handling, user model impacts.
5. Update tests or add them (unit/integration as appropriate).
6. Note any inconsistencies in `warnings.md` (e.g., mixed providers).

## Output
- Auth changes plus tests.
- Updated tasks/raw tasks/warnings as applicable.

## Session Summary Format
- **Done**: [what was completed]
- **Changes**: [files/links modified]
- **New tasks.md**: [any new structured tasks]
- **New raw.tasks.md**: [any new unrefined tasks]
- **Warnings**: [any warnings.md updates]
- **Next**: [suggested next actions]
