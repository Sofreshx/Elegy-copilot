---
name: quality-typescript
description: "TypeScript quality standards enforcement. Checks types, state management, error handling. Use this when asked to improve TypeScript code quality, enforce TS patterns, or fix TypeScript-specific quality issues."
---

# Quality TypeScript Skill

## Inputs
- Task from `tasks.md`.
- `warnings.md`, `contexts/project.patterns.md`, frontend/backend TS conventions.

## Steps
1. Review patterns (state mgmt, API clients, types, error handling).
2. Mode selection: auto -> deep if prior failures or architectural smell; shallow for small fixes.
3. Improve types, safety, and clarity; avoid behavior changes unless requested.
4. Add/adjust tests as needed.
5. Log systemic issues to `warnings.md`; add follow-up tasks for larger refactors.

## Output
- Improved TS code and tests.
- Updated warnings/tasks/raw tasks if applicable.

## Session Summary Format
- **Done**: [what was completed]
- **Changes**: [files/links modified]
- **New tasks.md**: [any new structured tasks]
- **New raw.tasks.md**: [any new unrefined tasks]
- **Warnings**: [any warnings.md updates]
- **Next**: [suggested next actions]


