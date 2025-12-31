---
name: testing
description: "Test creation and strategy. Writes unit tests, integration tests, identifies coverage gaps. Use this when asked to write tests, improve test coverage, add unit tests, or work on testing strategy."
---

# Testing Skill

## When to Use (LLM Routing Guide)
- User says "write tests for this", "improve test coverage", "what should I test?"
- Test strategy planning
- Identifying untested code paths
- Test refactoring/cleanup
- Flaky test investigation

## When NOT to Use
- Aspire-specific integration tests → `aspire.tests.integration.agent.md`
- Debugging failing tests (runtime issue) → `debug.agent.md`
- General code quality → `quality.*.agent.md`

## Inputs
- Code to test or test strategy scope.
- `contexts/project.patterns.md` (testing conventions).
- Existing tests (to understand patterns).
- `warnings.md` (known testing gaps).

## Steps
1. Read project testing patterns (frameworks, conventions, coverage goals).
2. Analyze code to test:
   - Public API surface
   - Edge cases and error paths
   - Integration points
   - Complex logic branches
3. Identify test type needed:
   - **Unit**: Isolated, fast, mock dependencies
   - **Integration**: Multiple components, real dependencies
   - **E2E**: Full user flows
4. Write tests following project conventions.
5. Ensure tests are:
   - **Fast**: Don't slow down feedback loop
   - **Reliable**: No flakiness
   - **Readable**: Test name explains what's being tested
   - **Isolated**: No test interdependence
6. Check coverage impact if tooling available.

## Test Naming Convention
```
[MethodName]_[Scenario]_[ExpectedResult]
// or
[Given]_[When]_[Then]
```

## Output
- Test files created/updated.
- Coverage report if available.
- `warnings.md` entry if critical untested paths found.

## Session Summary Format
- **Done**: [tests written/improved]
- **Changes**: [test files modified]
- **New tasks.md**: [none]
- **New raw.tasks.md**: [if more testing needed]
- **Warnings**: [if coverage gaps critical]
- **Next**: [run tests, continue coverage improvement]


