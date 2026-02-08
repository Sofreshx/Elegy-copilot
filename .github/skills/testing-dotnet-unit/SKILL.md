---
name: testing-dotnet-unit
description: "Backend unit testing for .NET (xUnit + NSubstitute + Shouldly + AutoFixture). Use this when asked to write unit tests for C# backend code, add coverage for handlers/services, or validate business rules."
---

# .NET Unit Testing Skill

## When to Use (LLM Routing Guide)
- User asks: "write unit tests", "add coverage", "test this handler/service", "xUnit test", "Shouldly"
- New backend feature or major code change that risks regressions
- Refactoring backend code where behavior must remain stable

## When NOT to Use
- User explicitly asks for integration tests → use `alba-integration-tests` (write only; run only on explicit request)
- Frontend unit tests → use `testing-frontend-unit`
- Debugging failing tests due to runtime/environment → use `debug`

## Principles (Org Defaults)
- Prefer **unit tests** over integration tests for most logic.
- Keep tests fast, deterministic, and isolated.
- Avoid real network, real DB, real filesystem unless the user explicitly wants integration.

## Tooling (Preferred Stack)
- Test runner: **xUnit**
- Mocks/stubs: **NSubstitute**
- Assertions: **Shouldly**
- Data generation: **AutoFixture** (use stable seeds when needed)

## Steps
1. Identify the unit boundary:
   - Pure logic (best) vs service/handler (mock external dependencies)
2. Enumerate behaviors:
   - happy-path, validation failures, authorization/guard rails, error paths
3. Build fixtures:
   - Use AutoFixture to generate DTOs/entities
   - Freeze substitutes for dependencies (NSubstitute)
4. Write tests:
   - Prefer behavior-based names: `Given_When_Then` or `Method_Scenario_Expected`
   - Use Shouldly for readable assertions
5. Run unit tests (default behavior):
   - Delegate to `unit-test-runner` agent - never run tests directly
   - If the user said "skip tests", do not run them
   - Provide to unit-test-runner:
     - testType: unit
     - projectPath: <test project>
     - filter: "FullyQualifiedName~<TestClass>" (when targeting specific tests)
     - reason: "Validate unit tests for [component]"

## Output
- New/updated test files (xUnit)
- Small notes on coverage/edge cases
- Follow-up raw task entries if additional coverage gaps are discovered

## Session Summary Format
- **Done**: [tests written]
- **Changes**: [files modified]
- **New tasks**: [if follow-up needed]
- **Warnings**: [if a risky untested area remains]
- **Next**: [suggest running broader suite if requested]


