---
name: testing-frontend-unit
description: "Frontend unit/component testing (React/Vue/Angular). Use this when asked to write frontend unit tests, component tests, or to add coverage for UI behavior. Prefers React Testing Library + Vitest when applicable. Triggers on:"Vitest", "Jest", "RTL", "React Testing Library", "component test", "frontend unit test"."
---

# Frontend Unit Testing Skill

## When to Use (LLM Routing Guide)
- User asks: "write frontend tests", "component test", "RTL", "Vitest/Jest"
- New UI feature or major UI refactor
- Bug fix where regression is likely

## When NOT to Use
- Backend unit tests → `testing-dotnet-unit`
- Integration/E2E testing → `aspire-integration-tests` or project-specific E2E skills
- User is debugging a failing UI test run due to environment → `debug`

## Principles
- Test user-visible behavior (rendering, interactions, accessibility), not implementation details.
- Keep tests deterministic: avoid timers/network unless mocked.
- Prefer mocking at the boundary (API client layer) over mocking deep internals.

## Preferred Libraries (if React)
- Runner: **Vitest** (or Jest if repo already uses it)
- DOM utilities: **@testing-library/react** (+ user-event)

## Steps
1. Detect existing test tooling in repo (Vitest vs Jest, RTL vs alternatives).
2. Identify the behavior to test:
   - rendering states (loading/empty/error)
   - interactions (click/type/submit)
   - conditional UI
3. Mock external calls:
   - mock fetch/client functions, not internal component state
4. Write tests:
   - keep setup minimal
   - assert via screen queries (role/text/label)
5. Run unit tests (default behavior):
   - Run the closest package/workspace tests
   - If the user said "skip tests", do not run them

## Output
- New/updated frontend test files
- Notes on missing edge cases

## Session Summary Format
- **Done**: [tests written]
- **Changes**: [files modified]
- **Next**: [optional: add integration tests only if user requests]


