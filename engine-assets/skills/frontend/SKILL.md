---
name: frontend
description: "Frontend UI development for React and similar frameworks. Creates components, pages, and handles state management. Triggers on: UI, component, React, Vue, page, frontend."
---

# Frontend Skill

## Inputs
- Explicit task request or active host/session work unit.
- Relevant repo docs, area READMEs, and established frontend patterns already present in the codebase.

## Aesthetics (Critical)
Apply this mindset to avoid generic "AI slop" UI:
> You tend to converge toward generic, "on distribution" outputs. Avoid this: make creative, distinctive frontends that surprise and delight.
> - **Typography**: Choose distinctive fonts (avoid Arial/Inter).
> - **Color**: Commit to a cohesive aesthetic with sharp accents.
> - **Motion**: Use staggered reveals and micro-interactions.
> - **Backgrounds**: Create atmosphere with gradients or patterns.
> - **Avoid**: Clich?d purple gradients, predictable layouts, and cookie-cutter designs.
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
1. Read repo docs, existing feature structure, and established frontend conventions to align with the current approach (framework, state management, styling).
2. Mode selection: auto -> deep if prior failures or architectural smell; shallow for local component fixes.
3. Confirm scope; if unclear, capture the blocker in host/session context or a user-requested note instead of assuming legacy task files.
4. Implement changes: components, hooks/composables, state, API integration, routing.
	- **Apply the Aesthetics guidelines above.**
5. Add/update tests using the repo-documented validation surface for the area you changed.
6. Record any systemic inconsistencies in chat, host/session artifacts, or a user-requested destination instead of assuming legacy warning/context files.

## Output
- Frontend code and tests.
- Updated docs or area documentation if patterns evolve.
- Follow-up notes only in chat, host/session artifacts, or a user-requested destination.

## Session Summary Format
- **Done**: [what was completed]
- **Changes**: [files/links modified]
- **New follow-ups**: [any tracked follow-up work]
- **Risks/notes**: [any systemic frontend concerns]
- **Next**: [suggested next actions]



