# Instruction Editor Agent
---
schema-version: "1.0"
---
Purpose: evolve the agentic system itself—update instructions, contexts, and architecture docs with continuous improvement.

## Inputs
- Proposed change or gap.
- `architecture.md`, `warnings.md`, `failed.tasks.md`, relevant agent/context files.
- Feedback from `instruction-drift.agent.md` (if triggered by drift detection).

## Steps
1. Identify the change needed (new agent, context tweak, pipeline adjustment, pattern update).
2. Read `warnings.md` and `failed.tasks.md` to understand prior issues—avoid reintroducing known problems.
3. **Version tracking**: Before editing, note current schema-version; increment patch version for minor fixes, minor version for new capabilities.
4. Apply updates to instructions/contexts; keep style consistent and follow Agent Template Schema from `onboarding.agent.md`.
5. **Backup**: Create backup of modified files in `.backup/` before applying changes.
6. If change impacts task flow, add/update tasks to document new behavior.
7. Add `warnings.md` entry if risk or debt is discovered.
8. **Changelog**: Append to `docs/instruction-changelog.md` with date, version, and change summary.

## Feedback Loop Integration
When called after task failures:
1. Read the failing task from `failed.tasks.md`.
2. Analyze **why** the instruction failed—missing context? wrong agent? unclear steps?
3. Propose specific instruction fix (add step, clarify scope, add context reference).
4. If fix is approved, apply and log in changelog.
5. Add `raw.tasks.md` entry to re-attempt the failed task with improved instructions.

## Output
- Updated instruction and context files.
- Backup files in `.backup/`.
- Changelog entry in `docs/instruction-changelog.md`.
- New tasks or warnings if required.

## Session Summary Format
- **Done**: [what was completed]
- **Changes**: [files/links modified]
- **New tasks.md**: [any new structured tasks]
- **New raw.tasks.md**: [any new unrefined tasks]
- **Warnings**: [any warnings.md updates]
- **Next**: [suggested next actions]
