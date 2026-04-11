# Troubleshooting: Test Execution Hangs

## Problem
Agents get stuck during test execution, unable to recognize when tests complete. This blocks workflow progress and sometimes prevents terminal access.

## Root Causes

### 1. Interactive/Watch Mode
**Symptom**: Terminal shows test output but doesn't return to prompt.

**Common triggers**:
- `dotnet watch test` instead of `dotnet test`
- npm/vitest without `--run` flag
- Missing `--no-restore` causing interactive package prompts

**Fix**: Always use non-interactive flags:
```bash
# ✅ Correct
dotnet test Project.Tests.csproj --no-restore --logger trx
npm test -- --run --reporter=verbose

# ❌ Wrong
dotnet watch test
dotnet test  # (might prompt for restore)
npm test  # (might enter interactive mode)
```

### 2. Missing Timeouts
**Symptom**: Command runs indefinitely, agent waits forever.

**Common triggers**:
- Using `run_in_terminal` without timeout parameter
- Timeout set to 0 (infinite wait)
- Timeout too short, causing premature termination detection

**Fix**: Always specify conservative timeouts:
```typescript
// ✅ Correct
run_in_terminal({
  command: "dotnet test ...",
  timeout: 90000,  // 90s for unit tests
  timeout: 600000  // 10 minutes for integration tests
})

// ❌ Wrong
run_in_terminal({
  command: "dotnet test ...",
  timeout: 0  // Infinite wait!
})
```

#### Hard enforcement (recommended)
If hooks are enabled for the repo, the pre-tool hook will **deny** terminal commands that:
- omit `timeout` or set `timeout=0`
- set `isBackground=true`
- use watch/interactive test modes
- run `dotnet test` without `--no-restore`

See: `docs/agent-hooks.md`.

### 3. Build/Restore Hangs
**Symptom**: Test command starts but never shows test output.

**Common triggers**:
- Package restore required but not completed
- NuGet source unreachable
- Circular dependency or corrupted cache

**Fix**: Use `--no-restore` and build separately:
```bash
# ✅ Correct
dotnet build Project.Tests.csproj -v minimal
dotnet test Project.Tests.csproj --no-restore --logger trx

# ❌ Wrong  
dotnet test Project.Tests.csproj  # implicit restore might hang
```

### 4. Terminal Shell Differences
**Symptom**: Works in PowerShell but hangs in Git Bash (or vice versa).

**Common triggers**:
- Different signal handling (Ctrl+C)
- TTY/PTY differences
- Line ending issues

**Fix**: Use explicit, portable commands:
```bash
# ✅ Portable
dotnet test --no-restore --logger trx

# ⚠️ Shell-specific
dotnet test | tee output.log  # May behave differently across shells
```

### 5. Wrong Execution Lane
**Symptom**: A generic implementation subagent starts running tests inline and then stalls or waits forever for more output.

**Common triggers**:
- `work-unit-runner` or `impl` runs a test command directly
- validation scope mixes builds and tests in one unbounded command
- caller treats stalled output as a reason to keep waiting instead of classifying the attempt

**Fix**: Route unit tests only through `unit-test-runner` and integration/E2E only through their dedicated runners. Generic implementation lanes may request test scope, but should limit themselves to targeted build, lint, or typecheck validation with explicit timeouts.

## Prevention Checklist

When executing tests via agents, ensure ALL of these:

- [ ] **Explicit timeout** specified (90s unit, 600s+ integration)
- [ ] **`--no-restore` flag** for all `dotnet test` commands
- [ ] **No watch mode** (never `dotnet watch`, always `--run` for npm)
- [ ] **Specific filters** when possible (`--filter "FullyQualifiedName~TestClass"`)
- [ ] **Logger flag** for capturing results (`--logger trx`)
- [ ] **Environment variables** set when required (e.g., `RUN_INTEGRATION_TESTS=1`)
- [ ] **Explicit timeout** always set on `run_in_terminal`
- [ ] **Dedicated lane ownership**: generic implementation agents request tests, but do not execute test commands directly

### If Hooks Are Enabled
If `.github/hooks/*.json` is enabled for the repo/session, the pre-tool hook will **deny** terminal test/E2E commands that:
- omit a timeout (or set it to 0)
- attempt background execution
- use watch/interactive modes
- run `dotnet test` without `--no-restore`

This is intentional: it prevents a hang from ever starting.

## Agent Configuration

Test execution is centralized in two agents:

- **`unit-test-runner.agent.md`** - The ONLY agent authorized to execute unit tests via run_in_terminal
- **`integration-test-runner.agent.md`** - The ONLY agent authorized to execute integration tests via run_in_terminal

Execution flow:
- `orchestrator.agent.md` and `orchestrator-cli.agent.md` delegate unit-test checkpoints to `unit-test-runner`.
- They escalate to `integration-test-runner` when policy, risk, or coverage requires broader validation, and should ask before long-running browser/E2E work.
- `work-unit-runner.agent.md` and `impl.agent.md` can carry test requests but do not own long-running test execution policy.

## Emergency Recovery

If agent is stuck in subagent with no terminal access:

1. **Cancel the agent**: Click the stop button in VS Code Copilot Chat
2. **Kill hanging processes**:
   ```bash
   # Windows
   taskkill /F /IM dotnet.exe /T
   
   # Linux/macOS
   pkill -9 dotnet
   ```
3. **Clear terminal**: Open new terminal instance
4. **Resume work**: Restart agent with corrected command

## Example Safe Commands

### Unit Tests
```bash
# Minimal, focused
dotnet test Libraries/MyLib.Tests/MyLib.Tests.csproj \
  --no-restore \
  --filter "FullyQualifiedName~MyTestClass" \
  --logger trx

# With timeout in agent: 90000ms
```

### Integration Tests
```bash
# With environment variables
RUN_INTEGRATION_TESTS=1 \
ALLOW_TEST_AUTH=true \
ASPNETCORE_ENVIRONMENT=Test \
dotnet test SAASTools.AppHost.Tests/SAASTools.AppHost.Tests.csproj \
  --no-restore \
  --filter "FullyQualifiedName~WorkflowIntegrationTests" \
  --logger trx

# With timeout in agent: 600000ms (10 min) to 1200000ms (20 min)
```

### Playwright (E2E, non-UI)
```bash
# Headless / one-shot (avoid --ui/--debug)
npx playwright test --headed=false
npx playwright test --project=chromium --headed=false

# With timeout in agent: 600000ms+ depending on suite size
```

### Playwright helper scripts deadline
The Node Playwright helper scripts in `scripts/e2e-*.js` enforce a global deadline.
Override via:

```bash
E2E_DEADLINE_MS=180000 npm run e2e:verify
```

### Frontend Tests
```bash
# Vitest non-interactive
npm test -- --run --reporter=verbose

# With timeout in agent: 60000ms
```

## Monitoring & Diagnosis

### Check if process is still running
```bash
# Windows
Get-Process dotnet
tasklist | findstr dotnet

# Linux/macOS  
ps aux | grep dotnet
```

### Check test output
```bash
# Look for TRX files
ls TestResults/*.trx

# Check for log files
tail -f TestResults/*.log
```

### Identify hung tests
If timeout triggers but process still running:
- Process is truly hung (deadlock, waiting for input)
- Timeout value too short for actual test duration
- Check logs for last test that started

## Best Practices Summary

1. **Use `run_in_terminal` with explicit timeouts** - Conservative (longer) is safer than aggressive
2. **Use timeouts liberally** - Conservative (longer) is safer than aggressive
3. **Build before testing** - Separate build and test phases when debugging hangs
4. **Test incrementally** - Run small batches to isolate hanging tests
5. **Use filters** - Target specific test classes to reduce run time and scope
6. **Monitor logs** - Always use `--logger trx` to capture output for diagnosis
7. **Set environment explicitly** - Don't rely on shell defaults for integration tests

## Related Files

- [.github/copilot-instructions.md](./copilot-instructions.md#testing) - Global testing guidelines
- [agents/unit-test-runner.agent.md](./agents/unit-test-runner.agent.md) - Unit test execution
- [agents/integration-test-runner.agent.md](./agents/integration-test-runner.agent.md) - Integration test execution
- [agents/task-runner.agent.md](./agents/task-runner.agent.md) - Task validation
- [skills/testing-dotnet-unit/SKILL.md](./skills/testing-dotnet-unit/SKILL.md) - Unit test patterns
- [skills/alba-integration-tests/SKILL.md](./skills/alba-integration-tests/SKILL.md) - Integration test patterns
