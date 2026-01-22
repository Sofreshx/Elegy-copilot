---
name: frontend
description: "Frontend UI development for React and similar frameworks. Creates components, pages, and handles state management. Triggers on: UI, component, React, Vue, page, frontend."
---

# Frontend Skill

## Inputs
- Task from a task file under `.instructions/tasks/`.
- `../../warnings.md`, `../../contexts/project.patterns.md`, `../../contexts/frontend.context.md`.

## Aesthetics (Critical)
Apply this mindset to avoid generic "AI slop" UI:
> You tend to converge toward generic, "on distribution" outputs. Avoid this: make creative, distinctive frontends that surprise and delight.
> - **Typography**: Choose distinctive fonts (avoid Arial/Inter).
> - **Color**: Commit to a cohesive aesthetic with sharp accents.
> - **Motion**: Use staggered reveals and micro-interactions.
> - **Backgrounds**: Create atmosphere with gradients or patterns.
> - **Avoid**: Clich�d purple gradients, predictable layouts, and cookie-cutter designs.
> **Interpret creatively and make unexpected choices!**

## Architecture & Structure
Adopt a **Feature-based** organization to keep the codebase scalable and segmented.

- **`src/features/`**: Self-contained modules (e.g., `Auth`, `Cart`, `Dashboard`). Each feature should contain its own:
  - `components/`
  - `hooks/`
  - `api/` (or `services/`)
  - `types/`
- **`src/common/`**: Shared utilities used across multiple features.
  - `hooks/` (e.g., `useDebounce`)
  - `components/` (Base UI library, Buttons, Inputs)
  - `types/` (Global domain types)
- **`src/infrastructure/`**: Core plumbing and configuration.
  - `auth/`
  - `api/` (Axios/Fetch setup)
  - `logging/`

**State Management**
- Prefer using **Zustand** for global state: lightweight, hook-based stores that are easy to test and scale. Use local React state or Context for small, component-scoped state and avoid heavy global solutions unless necessary.

## Steps
1. Read warnings and patterns to align with existing frontend approach (framework, state mgmt, styling).
2. Mode selection: auto -> deep if prior failures or architectural smell; shallow for local component fixes.
3. Confirm scope; if unclear, add a clarifying entry to `raw.tasks.md` and pause.
4. Implement changes: components, hooks/composables, state, API integration, routing.
	- **Apply the Aesthetics guidelines above.**
5. Add/update tests (unit, integration, e2e as appropriate per `frontend.context.md`).
6. Note any inconsistencies in `../../warnings.md` (mixed patterns, outdated deps, accessibility gaps).

## Output
- Frontend code and tests.
- Updated docs/contexts if patterns evolve.
- Updated warnings/tasks/raw tasks as applicable.

## Session Summary Format
- **Done**: [what was completed]
- **Changes**: [files/links modified]
- **New tasks**: [any new task files created]
- **New raw.tasks.md**: [any new unrefined tasks]
- **Warnings**: [any ../../warnings.md updates]
- **Next**: [suggested next actions]


