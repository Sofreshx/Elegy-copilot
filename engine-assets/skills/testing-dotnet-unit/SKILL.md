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
- Higher-layer validation is needed → use `alba-integration-tests` via the proper validation lane when policy, risk, or coverage gaps require it
- Frontend unit tests → use `testing-frontend-unit`
- Debugging failing tests due to runtime/environment → use `debug`

## Principles (Org Defaults)
- Prefer **unit tests** over integration tests for most logic.
- Keep tests fast, deterministic, and isolated.
- Avoid real network, real DB, real filesystem unless higher-layer validation is warranted by policy, risk, or coverage gaps; route that work through the proper validation lane.
- Follow `docs/system/testing-quality-governance.md`: passing tests are evidence, not the objective.
- Before finalizing scope, enumerate meaningful success, failure, edge, and adversarial cases for the unit under test.
- Do not weaken, narrow, or remove tests merely to get green. If an assertion or hard-case input must be removed or relaxed, add replacement coverage that preserves or improves confidence.
- Distinguish legitimate maintenance from weakening: intentional contract changes or incorrect prior expectations can justify updates, but the prior confidence target must remain covered or the new boundary must be stated explicitly.

## Tooling (Preferred Stack)
- Test runner: **xUnit**
- Mocks/stubs: **NSubstitute**
- Assertions: **Shouldly**
- Data generation: **AutoFixture** (use stable seeds when needed)

## Related docs

- Testing and E2E MOC: `docs/system/mocs/testing-and-e2e.md`
- E2E setup guide: `docs/system/e2e-setup-guide.md`
- Workflow planning contract: `docs/system/workflow-planning-contract.md`
- System docs index: `docs/system/index.md`

## Steps
1. Identify the unit boundary:
   - Pure logic (best) vs service/handler (mock external dependencies)
2. Enumerate behaviors:
   - happy-path, validation failures, authorization/guard rails, error paths
   - meaningful edge conditions and adversarial inputs
   - any prior hard-case coverage that must be preserved if tests are rewritten
3. Build fixtures:
   - Use AutoFixture to generate DTOs/entities
   - Freeze substitutes for dependencies (NSubstitute)
4. Write tests:
   - Prefer behavior-based names: `Given_When_Then` or `Method_Scenario_Expected`
   - Use Shouldly for readable assertions
   - Prefer stronger behavioral assertions over easier but weaker checks
   - When product behavior changed intentionally, update the test contract without dropping the original confidence target unless the new boundary is explicit
5. Run unit tests (default behavior):
   - Delegate to `unit-test-runner` agent; do not run tests directly from an implementation lane
   - If the user said "skip tests", do not run them in the current lane
   - If unit validation is still mandatory, route to the runner/validation lane or leave the validation gap explicit; do not imply it was satisfied
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


