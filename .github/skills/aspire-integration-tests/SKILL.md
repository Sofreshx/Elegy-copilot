---
name: aspire-integration-tests
description: "Aspire integration testing. Creates and maintains integration tests for Aspire-based applications. Use this when asked to create Aspire tests, write integration tests with Aspire, or work on Aspire testing."
---

# Aspire Integration Tests Skill

## Execution Policy (Important)
- You may write or update integration tests as requested.
- Do **not** execute integration tests unless the user explicitly asks you to run them.
- When not requested, provide the exact command(s) the user can run.

## Inputs
- Task from a task file under `.instructions/tasks/`.
- `warnings.md`, `contexts/aspire.context.md`, `contexts/project.patterns.md`.

## Steps
1. Read patterns for testing stack (Aspire fixtures, composition, env vars).
2. Mode selection: auto -> deep if prior failures or changing test infrastructure; shallow for adding tests.
3. Scope the test change; if unclear, add a clarifying `raw.tasks.md` entry.
4. Implement integration tests respecting compose/env configuration, test data seeding, and isolation.
5. Ensure CI compatibility; note required services.
6. Log inconsistencies in `warnings.md` (e.g., divergent test harnesses between services).

## Output
- Integration tests and config adjustments.
- Updated warnings/tasks/raw tasks where applicable.

## Session Summary Format
- **Done**: [what was completed]
- **Changes**: [files/links modified]
- **New tasks**: [any new task files created]
- **New raw.tasks.md**: [any new unrefined tasks]
- **Warnings**: [any warnings.md updates]
- **Next**: [suggested next actions]


