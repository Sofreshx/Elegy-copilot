---
name: testing-frontend-unit
description: "Frontend unit/component testing (React/Vue/Angular). Use this when asked to write frontend unit tests, component tests, or to add coverage for UI behavior. Prefers React Testing Library + Vitest when applicable."
---

# Frontend Unit Testing Skill

## When to Use (LLM Routing Guide)
- User asks: "write frontend tests", "component test", "RTL", "Vitest/Jest"
- New UI feature or major UI refactor
- Bug fix where regression is likely

## When NOT to Use
- Backend unit tests → `testing-dotnet-unit`
- Integration/E2E testing → `alba-integration-tests` or `e2e-browser`
- User is debugging a failing UI test run due to environment → `debug`

## Principles
- Test user-visible behavior (rendering, interactions, accessibility), not implementation details.
- Keep tests deterministic: avoid timers/network unless mocked.
- Prefer mocking at the boundary (API client layer) over mocking deep internals.
- Follow `docs/system/testing-quality-governance.md`: passing tests are evidence, not the objective.
- Before deciding test scope, enumerate meaningful success, failure, edge, and adversarial UI cases.
- Do not weaken, narrow, or remove tests merely to get green. If an assertion or hard case must be relaxed, add replacement coverage that preserves or improves confidence.
- Distinguish legitimate test maintenance from weakening: intentional UI contract changes or wrong prior expectations can justify updates, but the previous confidence target must stay covered or the new boundary must be explicit.

## Preferred Libraries (if React)
- Runner: **Vitest** (or Jest if repo already uses it)
- DOM utilities: **@testing-library/react** (+ user-event)

## Related docs

- Testing and E2E MOC: `docs/system/mocs/testing-and-e2e.md`
- E2E setup guide: `docs/system/e2e-setup-guide.md`
- Agent hooks: `docs/system/agent-hooks.md`
- System docs index: `docs/system/index.md`

## Steps
1. Detect existing test tooling in repo (Vitest vs Jest, RTL vs alternatives).
2. Identify the behavior to test:
   - rendering states (loading/empty/error)
   - interactions (click/type/submit)
   - conditional UI
   - edge and adversarial states (disabled/unauthorized/race-prone/error-recovery flows)
   - any existing hard-case coverage that must be preserved if tests are rewritten
3. Mock external calls:
   - mock fetch/client functions, not internal component state
4. Write tests:
   - keep setup minimal
   - assert via screen queries (role/text/label)
   - prefer behavioral assertions over implementation-detail checks or convenience snapshots
   - when product behavior changed intentionally, rewrite expectations without dropping the original confidence target unless the new boundary is explicit
5. Run unit tests (default behavior):
   - Delegate to `unit-test-runner`; do not run tests directly from an implementation lane
   - Run the closest package/workspace tests
   - If the user said "skip tests", do not run them in the current lane
   - If unit validation is still mandatory, route to the runner/validation lane or leave the validation gap explicit; do not imply it was satisfied

## Output
- New/updated frontend test files
- Notes on missing edge cases

## Session Summary Format
- **Done**: [tests written]
- **Changes**: [files modified]
- **Next**: [optional: add higher-layer validation if policy, risk, or coverage gaps require it]


