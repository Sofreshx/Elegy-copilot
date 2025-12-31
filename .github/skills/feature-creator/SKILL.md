---
name: feature-creator
description: "Backend feature implementation. Creates endpoints, services, and data access following project patterns. Use this when asked to add an endpoint, create a feature, implement an API, or do backend development."
---

# Feature Creator Skill

## When NOT to Use
- For frontend/UI work → use `frontend`
- For Wolverine HTTP endpoints specifically → use `wolverine-http`
- For Marten document operations → use `marten-documents`
- For refactoring existing code → use `refactor`

## Inputs
- Task from `tasks.md`
- `warnings.md`, `contexts/project.patterns.md`
- Search for similar features in codebase to match patterns

## Discovery First
Before implementing, search for:
1. **Similar endpoints**: How are other endpoints structured?
2. **Data access patterns**: EF Core? Marten? Raw SQL?
3. **Validation approach**: FluentValidation? Data annotations? Manual?
4. **Response patterns**: Result types? Exceptions? HTTP status codes?

## Steps
1. **Understand**: Map domain, data flow, endpoints. Search existing code for patterns.
2. **Mode**: Deep if new domain/boundaries; shallow for similar endpoint additions.
3. **Pattern Match**: Follow `project.patterns.md` exactly (don't invent new patterns).
4. **Implement**: Logic → data access → wiring → validation (in that order).
5. **Test**: Unit tests for logic, integration for data access. Use Aspire if available.
6. **Document**: Update context if patterns evolve or new conventions emerge.

## Output
- Feature code and tests.
- Updated docs/contexts if patterns change.
- New tasks/raw tasks as needed.

## Session Summary Format
- **Done**: [what was completed]
- **Changes**: [files/links modified]
- **New tasks.md**: [any new structured tasks]
- **New raw.tasks.md**: [any new unrefined tasks]
- **Warnings**: [any warnings.md updates]
- **Next**: [suggested next actions]


