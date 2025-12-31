---
name: frontend
description: "Frontend UI development for React, Vue, or Angular. Creates components, pages, and handles state management. Use this when asked to create components, add pages, build UI, style elements, or work on any frontend tasks."
---

# Frontend Skill

## Inputs
- Task from `tasks.md`.
- `warnings.md`, `contexts/project.patterns.md`, `contexts/frontend.context.md`.

## Steps
1. Read warnings and patterns to align with existing frontend approach (framework, state mgmt, styling).
2. Mode selection: auto -> deep if prior failures or architectural smell; shallow for local component fixes.
3. Confirm scope; if unclear, add a clarifying entry to `raw.tasks.md` and pause.
4. Implement changes: components, hooks/composables, state, API integration, routing.
5. Add/update tests (unit, integration, e2e as appropriate per `frontend.context.md`).
6. Note any inconsistencies in `warnings.md` (mixed patterns, outdated deps, accessibility gaps).

## Output
- Frontend code and tests.
- Updated docs/contexts if patterns evolve.
- Updated warnings/tasks/raw tasks as applicable.

## Session Summary Format
- **Done**: [what was completed]
- **Changes**: [files/links modified]
- **New tasks.md**: [any new structured tasks]
- **New raw.tasks.md**: [any new unrefined tasks]
- **Warnings**: [any warnings.md updates]
- **Next**: [suggested next actions]


