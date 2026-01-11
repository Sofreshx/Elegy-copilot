---
name: system-editor
description: "Instruction file editor. Updates agent instructions, contexts, and architecture docs. Use this for internal system maintenance only."
---

# System Editor Skill

## Inputs
- Proposed change or gap.
- `.instructions/architecture.md`, `.instructions/contexts/project.memory.md`, relevant agent/context files.
- Feedback from `system.drift.agent.md` (if triggered by drift detection).

## Steps
1. Identify the change needed (new agent, context tweak, pipeline adjustment, pattern update).
2. Read `.instructions/contexts/project.memory.md` and recent task files (check `## Failures` sections) to understand prior issues—avoid reintroducing known problems.
3. **Version tracking**: Before editing, note current schema-version; increment patch version for minor fixes, minor version for new capabilities.
4. Apply updates to instructions/contexts; keep style consistent and follow Agent Template Schema from `onboarding.agent.md`.
5. **Backup**: Create backup of modified files in `.backup/` before applying changes.
6. If change impacts task flow, add/update tasks to document new behavior.
7. Add `../../warnings.md` entry if risk or debt is discovered.
8. **Changelog**: Append to `docs/instruction-changelog.md` with date, version, and change summary.

## Feedback Loop Integration
When called after task failures:
1. Read the failing task file (usually under `.instructions/tasks/`; if already completed, check `.instructions/tasks.archive/`).
2. Analyze **why** the instruction failed—missing context? wrong agent? unclear steps?
3. Propose specific instruction fix (add step, clarify scope, add context reference).
4. If fix is approved, apply and log in changelog.
5. Create a follow-up improvement task file under `.instructions/tasks/` (or use `.instructions/raw.tasks.md` if it needs clarification).

## Output
- Updated instruction and context files.
- Backup files in `.backup/`.
- Changelog entry in `docs/instruction-changelog.md`.
- New tasks or warnings if required.

## Session Summary Format
- **Done**: [what was completed]
- **Changes**: [files/links modified]
- **New tasks**: [any new task files created]
- **New raw.tasks.md**: [any new unrefined tasks]
- **Warnings**: [any warnings.md updates]
- **Next**: [suggested next actions]


