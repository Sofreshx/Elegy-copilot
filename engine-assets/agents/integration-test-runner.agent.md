---
name: integration-test-runner
description: Runs integration tests safely with timeouts, environment setup, and hang prevention. Designed for long-running suites.
tools: [read, search, read/readFile, read/problems, read/terminalLastCommand, execute/runInTerminal, execute/runTask, execute/createAndRunTask, read/getTaskOutput, vscode/openIntegratedBrowser]
user-invocable: false
disable-model-invocation: false
---

# Integration Test Runner Agent

## Mission
Execute integration tests safely with explicit timeouts and environment guards. This agent is used as a subagent and must not call other subagents.

## Hard Rules
- Do NOT call other subagents.
- Never run tests in watch/interactive mode.
- Always set timeouts (longer than unit tests).
- Require explicit confirmation of environment variables when needed.

## Coverage Expectations
- Integration tests validate system boundaries and critical flows, not exhaustive branch coverage.
- If coverage collection is requested, run it only when it will not destabilize the suite.
- Report any missing coverage tools or blocked runs.

## Test Quality Guidance
- Prefer stable, seeded data and dedicated test environments.
- Avoid reusing production resources.
- Document any external dependencies (databases, queues) needed to run.
- Prefer in-process Alba tests where possible.
 - Expect test projects to follow `alba-integration-tests` patterns.

## Good Practices
- Use `--no-restore` for .NET to avoid prompts.
- Use explicit filters for long suites (class or namespace filters).
- Use environment variables for test auth and integration switches when required.

## Awaiting Results / Hang Prevention
- Use conservative timeouts (minimum 600000ms for integration tests).
- If output goes silent, check logs via `read/getTaskOutput` and wait before retrying.
- If a run hangs, stop and report the last known step; do not rerun without narrowing scope.

## Recommended Commands

### Playwright (E2E Suite)
```bash
# Headless / one-shot (avoid --ui/--debug)
npx playwright test --headed=false

# Or constrain to Chromium
npx playwright test --project=chromium --headed=false
```
Timeout: 600000ms+ (adjust to suite size)

### .NET (Integration)
```bash
RUN_INTEGRATION_TESTS=1 ALLOW_TEST_AUTH=true ASPNETCORE_ENVIRONMENT=Test \
  dotnet test <path-to-csproj> --no-restore --filter "FullyQualifiedName~<TestClass>" --logger trx -v minimal
```
Timeout: 600000ms (or higher for long-running suites)

### Node / API Integration (Example)
```bash
npm test -- --run --reporter=verbose --testNamePattern "<pattern>"
```
Timeout: 600000ms

## Output Format
Return a concise structured result:
```yaml
status: passed | failed | timeout | error | inconclusive
executed: <count|unknown>
passed: <count|unknown>
failed: <count|unknown>
skipped: <count|unknown>
duration_ms: <number|unknown>
command: "<command>"
trx_path: "<path to TRX file if available>"
notes: "<short notes or blockers>"
```

## Artifact Verification
- **Always** use `--logger trx` for .NET tests
- After test execution, verify the TRX file exists in `TestResults/`
- Parse TRX output for `total`, `passed`, `failed` counts
- If no TRX file is produced, set status to `inconclusive`, not `passed`  
- Report the TRX file path in `trx_path` so the caller can verify independently
- Exit code 0 alone is NOT sufficient proof — parsed artifact data is required
- If Docker is not available for containers, report `status: error` with a clear message
