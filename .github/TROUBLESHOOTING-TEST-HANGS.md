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

## Prevention Checklist

When executing tests via agents, ensure ALL of these:

- [ ] **Explicit timeout** specified (90s unit, 600s+ integration)
- [ ] **`--no-restore` flag** for all `dotnet test` commands
- [ ] **No watch mode** (never `dotnet watch`, always `--run` for npm)
- [ ] **Specific filters** when possible (`--filter "FullyQualifiedName~TestClass"`)
- [ ] **Logger flag** for capturing results (`--logger trx`)
- [ ] **Environment variables** set when required (e.g., `RUN_INTEGRATION_TESTS=1`)
- [ ] **`runTests` tool preferred** over `run_in_terminal` when available

## Agent Configuration

Test execution is centralized in the `test-runner` agent:

- **`test-runner.agent.md`** - The ONLY agent authorized to execute tests via run_in_terminal
  - Contains all test execution safety rules
  - Handles timeouts, non-interactive mode, proper flags
  - Used by all other agents for test execution

Other agents delegate to test-runner:
- `test-executive.agent.md` - Orchestrates test planning, delegates execution to test-runner
- `unit-test-gen.agent.md` - Generates tests, delegates execution to test-runner
- `integration-test-gen.agent.md` - Generates tests, delegates execution to test-runner
- `task-runner.agent.md` - Validates tasks, delegates test execution to test-runner
- `executive2.agent.md` - Calls test-runner for validation phase
- Skills reference test-runner:
  - `testing-dotnet-unit/SKILL.md`
  - `aspire-integration-tests/SKILL.md`

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

1. **Default to `runTests` tool** - It has built-in safety mechanisms
2. **Use timeouts liberally** - Conservative (longer) is safer than aggressive
3. **Build before testing** - Separate build and test phases when debugging hangs
4. **Test incrementally** - Run small batches to isolate hanging tests
5. **Use filters** - Target specific test classes to reduce run time and scope
6. **Monitor logs** - Always use `--logger trx` to capture output for diagnosis
7. **Set environment explicitly** - Don't rely on shell defaults for integration tests

## Related Files

- [.github/copilot-instructions.md](./copilot-instructions.md#testing) - Global testing guidelines
- [agents/test-executive.agent.md](./agents/test-executive.agent.md) - Test orchestration
- [agents/task-runner.agent.md](./agents/task-runner.agent.md) - Task validation
- [skills/testing-dotnet-unit/SKILL.md](./skills/testing-dotnet-unit/SKILL.md) - Unit test patterns
- [skills/aspire-integration-tests/SKILL.md](./skills/aspire-integration-tests/SKILL.md) - Integration test patterns
