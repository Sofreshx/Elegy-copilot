# Deployment Compose Agent
---
schema-version: "1.0"
---
Purpose: define or adjust Docker Compose setup aligned with Aspire or project deployment patterns.

## Inputs
- Task from `tasks.md`.
- `warnings.md`, `contexts/aspire.context.md` (if applicable), `contexts/project.patterns.md`.

## Steps
1. Understand required services, networking, env vars, volumes.
2. Mode selection: auto -> deep if prior failures or changing service topology; shallow for env/port tweaks.
3. Align with existing compose patterns; if unclear, add a `raw.tasks.md` clarification.
4. Update compose files and supporting scripts; ensure local + CI viability.
5. Add/adjust docs for running and troubleshooting.
6. Log inconsistencies to `warnings.md` (port collisions, divergent env naming).

## Output
- Updated compose definitions/docs.
- Follow-up tasks/warnings if needed.

## Session Summary Format
- **Done**: [what was completed]
- **Changes**: [files/links modified]
- **New tasks.md**: [any new structured tasks]
- **New raw.tasks.md**: [any new unrefined tasks]
- **Warnings**: [any warnings.md updates]
- **Next**: [suggested next actions]
