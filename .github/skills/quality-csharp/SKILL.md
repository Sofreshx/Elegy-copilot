---
name: quality-csharp
description: "C# quality standards enforcement. Checks DI patterns, async usage, nullability, naming conventions. Use this when asked to improve C# code quality, enforce .NET patterns, or fix C#-specific quality issues."
---

# Quality C# Skill

## Inputs
- Task from `tasks.md`.
- `warnings.md`, `contexts/project.patterns.md`, any coding standards doc.

## Steps
1. Review target code and patterns (DI, logging, naming, error handling, async, nullability).
2. Mode selection: auto -> deep if prior failures or architectural smell; shallow for local lint-level fixes.
3. Apply improvements (structure, readability, safety) without altering behavior unless requested.
4. Add/update tests if risk of regression.
5. Log systemic issues to `warnings.md` and add follow-up tasks if needed.

## Output
- Refined code and tests.
- Updated warnings/tasks/raw tasks as needed.

## Session Summary Format
- **Done**: [what was completed]
- **Changes**: [files/links modified]
- **New tasks.md**: [any new structured tasks]
- **New raw.tasks.md**: [any new unrefined tasks]
- **Warnings**: [any warnings.md updates]
- **Next**: [suggested next actions]


