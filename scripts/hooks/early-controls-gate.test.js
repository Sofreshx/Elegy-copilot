#!/usr/bin/env node

const assert = require('assert');
const crypto = require('crypto');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PRE_TOOL_USE_PS1 = path.resolve(__dirname, 'pre-tool-use.ps1');
const PRE_TOOL_USE_SH = path.resolve(__dirname, 'pre-tool-use.sh');
const SESSION_START_PS1 = path.resolve(__dirname, 'session-start.ps1');
const SESSION_START_SH = path.resolve(__dirname, 'session-start.sh');

let passed = 0;
let skipped = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS: ${name}`);
  } catch (e) {
    console.error(`  FAIL: ${name}`);
    console.error(`    ${e.message}`);
    process.exitCode = 1;
  }
}

function testIf(condition, name, fn) {
  if (!condition) {
    skipped++;
    console.log(`  SKIP: ${name}`);
    return;
  }
  test(name, fn);
}

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-early-controls-'));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function getStatePath(cwd) {
  return path.join(cwd, '.instructions-output', 'hooks', 'early-controls.json');
}

function writeAllRulesEnabled(dir) {
  const configPath = path.join(dir, 'hook-rules.json');
  const allRules = [
    'safety-early-control-gate', 'safety-secrets-env', 'safety-git-push',
    'safety-git-reset-hard', 'safety-git-clean', 'safety-git-force-checkout',
    'safety-git-rebase-interactive', 'safety-gh-repo-delete', 'safety-rm-rf',
    'safety-os-shutdown', 'safety-disk-ops', 'safety-remove-item',
    'safety-production-access', 'anti-hang-timeout', 'anti-hang-background',
    'anti-hang-watch-interactive', 'anti-hang-vitest-run', 'anti-hang-playwright',
    'anti-hang-dotnet-restore',
  ];
  const overrides = {};
  for (const id of allRules) overrides[id] = true;
  fs.writeFileSync(configPath, JSON.stringify({ schemaVersion: 1, overrides }));
  return configPath;
}

function writePassingEarlyControlState(cwd) {
  const statePath = getStatePath(cwd);
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  const safetyToken = 'test-safety-token';
  const safetyTokenParity = crypto.createHash('sha256').update(safetyToken, 'utf8').digest('hex');
  const state = {
    schemaVersion: '1.0.0',
    generatedAt: '2026-02-25T00:00:00Z',
    requiredControls: ['safetyTokenParity', 'hookEnforcement', 'telemetrySchemaValidation'],
    controls: {
      safetyTokenParity: { status: 'pass', detail: 'token_parity_valid' },
      hookEnforcement: { status: 'pass', detail: 'pre_tool_use_hook_present' },
      telemetrySchemaValidation: { status: 'pass', detail: 'schema_valid' },
    },
    controlData: {
      safetyToken,
      safetyTokenParity,
    },
    allPassed: true,
  };
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function buildRunInTerminalPayload(cwd, command) {
  return {
    timestamp: '2026-02-25T00:00:00Z',
    cwd,
    toolName: 'execute/runInTerminal',
    toolArgs: JSON.stringify({
      command,
      timeout: 1000,
      isBackground: false,
    }),
  };
}

function runPowerShellPreToolUse(payload, env) {
  return childProcess.execFileSync(
    'pwsh',
    ['-NoProfile', '-File', PRE_TOOL_USE_PS1],
    {
      cwd: payload.cwd,
      env: {
        ...process.env,
        ...env,
      },
      input: JSON.stringify(payload),
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }
  );
}

function runPowerShellSessionStart(payload, env) {
  return childProcess.execFileSync(
    'pwsh',
    ['-NoProfile', '-File', SESSION_START_PS1],
    {
      cwd: payload.cwd,
      env: {
        ...process.env,
        ...env,
      },
      input: JSON.stringify(payload),
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }
  );
}

function runBashPreToolUse(payload, env) {
  return childProcess.execFileSync(
    'bash',
    [PRE_TOOL_USE_SH],
    {
      cwd: payload.cwd,
      env: {
        ...process.env,
        ...env,
      },
      input: JSON.stringify(payload),
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }
  );
}

function runBashSessionStart(payload, env) {
  return childProcess.execFileSync(
    'bash',
    [SESSION_START_SH],
    {
      cwd: payload.cwd,
      env: {
        ...process.env,
        ...env,
      },
      input: JSON.stringify(payload),
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }
  );
}

function parseDenyJson(output) {
  const trimmed = (output || '').trim();
  assert.ok(trimmed.length > 0, 'expected deny output JSON');
  return JSON.parse(trimmed);
}

function hasCommand(command) {
  try {
    childProcess.execFileSync(command, ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const canRunBashPath = hasCommand('bash') && hasCommand('python');

test('PowerShell privileged action is denied when early-control state is missing', () => {
  withTempDir((cwd) => {
    const rulesPath = writeAllRulesEnabled(cwd);
    const output = runPowerShellPreToolUse(
      buildRunInTerminalPayload(cwd, 'echo safe-command'),
      {
        HOOK_EARLY_CONTROLS_STATE_FILE: '.instructions-output/hooks/early-controls.json',
        HOOK_RULES_FILE: rulesPath,
      }
    );

    const deny = parseDenyJson(output);
    assert.strictEqual(deny.permissionDecision, 'deny');
    assert.ok(deny.permissionDecisionReason.includes('early controls unavailable'));
  });
});

test('PowerShell session-start writes deterministic early-control state', () => {
  withTempDir((cwd) => {
    const payload = {
      timestamp: '2026-02-25T00:00:00Z',
      cwd,
      source: 'test',
      initialPrompt: 'test prompt',
    };

    runPowerShellSessionStart(payload, {
      HOOK_EARLY_CONTROLS_STATE_FILE: '.instructions-output/hooks/early-controls.json',
    });

    const statePath = getStatePath(cwd);
    assert.ok(fs.existsSync(statePath), 'expected early-controls state file to be written');
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    assert.strictEqual(state.schemaVersion, '1.0.0');
    assert.deepStrictEqual(state.requiredControls, ['safetyTokenParity', 'hookEnforcement', 'telemetrySchemaValidation']);
    assert.strictEqual(state.controls.safetyTokenParity.status, 'pass');
    assert.ok(state.controlData && typeof state.controlData.safetyToken === 'string' && state.controlData.safetyToken.length > 0);
    assert.ok(state.controlData && typeof state.controlData.safetyTokenParity === 'string' && state.controlData.safetyTokenParity.length === 64);
    assert.strictEqual(state.controls.hookEnforcement.status, 'pass');
    assert.strictEqual(state.controls.telemetrySchemaValidation.status, 'pass');
    assert.strictEqual(state.allPassed, true);
  });
});

test('PowerShell privileged action is denied when safety token parity is mismatched', () => {
  withTempDir((cwd) => {
    writePassingEarlyControlState(cwd);
    const rulesPath = writeAllRulesEnabled(cwd);

    const statePath = getStatePath(cwd);
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    state.controlData.safetyTokenParity = '0'.repeat(64);
    fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');

    const output = runPowerShellPreToolUse(
      buildRunInTerminalPayload(cwd, 'echo safe-command'),
      {
        HOOK_EARLY_CONTROLS_STATE_FILE: '.instructions-output/hooks/early-controls.json',
        HOOK_RULES_FILE: rulesPath,
      }
    );

    const deny = parseDenyJson(output);
    assert.strictEqual(deny.permissionDecision, 'deny');
    assert.ok(deny.permissionDecisionReason.includes('safetyTokenParity:token_parity_mismatch'));
  });
});

test('PowerShell non-privileged action remains allowed when early-control state is missing', () => {
  withTempDir((cwd) => {
    const rulesPath = writeAllRulesEnabled(cwd);
    const payload = {
      timestamp: '2026-02-25T00:00:00Z',
      cwd,
      toolName: 'read_file',
      toolArgs: JSON.stringify({ filePath: 'README.md' }),
    };

    const output = runPowerShellPreToolUse(payload, {
      HOOK_EARLY_CONTROLS_STATE_FILE: '.instructions-output/hooks/early-controls.json',
      HOOK_RULES_FILE: rulesPath,
    });

    assert.strictEqual(output.trim(), '');
  });
});

test('PowerShell privileged action is allowed when all early controls pass', () => {
  withTempDir((cwd) => {
    writePassingEarlyControlState(cwd);
    const rulesPath = writeAllRulesEnabled(cwd);

    const output = runPowerShellPreToolUse(
      buildRunInTerminalPayload(cwd, 'echo safe-command'),
      {
        HOOK_EARLY_CONTROLS_STATE_FILE: '.instructions-output/hooks/early-controls.json',
        HOOK_RULES_FILE: rulesPath,
      }
    );

    assert.strictEqual(output.trim(), '');
  });
});

testIf(canRunBashPath, 'Bash privileged action is denied when early-control state is missing', () => {
  withTempDir((cwd) => {
    const rulesPath = writeAllRulesEnabled(cwd);
    const output = runBashPreToolUse(
      buildRunInTerminalPayload(cwd, 'echo safe-command'),
      {
        HOOK_EARLY_CONTROLS_STATE_FILE: '.instructions-output/hooks/early-controls.json',
        HOOK_RULES_FILE: rulesPath,
      }
    );

    const deny = parseDenyJson(output);
    assert.strictEqual(deny.permissionDecision, 'deny');
    assert.ok(deny.permissionDecisionReason.includes('early controls unavailable'));
  });
});

testIf(canRunBashPath, 'Bash privileged action is denied when early-control state shape is invalid', () => {
  withTempDir((cwd) => {
    const rulesPath = writeAllRulesEnabled(cwd);
    const statePath = getStatePath(cwd);
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, '["invalid-state-shape"]\n', 'utf8');

    const output = runBashPreToolUse(
      buildRunInTerminalPayload(cwd, 'echo safe-command'),
      {
        HOOK_EARLY_CONTROLS_STATE_FILE: '.instructions-output/hooks/early-controls.json',
        HOOK_RULES_FILE: rulesPath,
      }
    );

    const deny = parseDenyJson(output);
    assert.strictEqual(deny.permissionDecision, 'deny');
    assert.ok(deny.permissionDecisionReason.includes('early controls unavailable'));
    assert.ok(deny.permissionDecisionReason.includes('state invalid'));
  });
});

testIf(canRunBashPath, 'Bash session-start writes deterministic early-control state', () => {
  withTempDir((cwd) => {
    const payload = {
      timestamp: '2026-02-25T00:00:00Z',
      cwd,
      source: 'test',
      initialPrompt: 'test prompt',
    };

    runBashSessionStart(payload, {
      HOOK_EARLY_CONTROLS_STATE_FILE: '.instructions-output/hooks/early-controls.json',
    });

    const state = JSON.parse(fs.readFileSync(getStatePath(cwd), 'utf8'));
    assert.strictEqual(state.schemaVersion, '1.0.0');
    assert.strictEqual(state.controls.safetyTokenParity.status, 'pass');
    assert.ok(state.controlData && typeof state.controlData.safetyToken === 'string' && state.controlData.safetyToken.length > 0);
    assert.ok(state.controlData && typeof state.controlData.safetyTokenParity === 'string' && state.controlData.safetyTokenParity.length === 64);
    assert.strictEqual(state.controls.hookEnforcement.status, 'pass');
    assert.strictEqual(state.controls.telemetrySchemaValidation.status, 'pass');
    assert.strictEqual(state.allPassed, true);
  });
});

testIf(canRunBashPath, 'Bash privileged action is allowed when all early controls pass', () => {
  withTempDir((cwd) => {
    writePassingEarlyControlState(cwd);
    const rulesPath = writeAllRulesEnabled(cwd);

    const output = runBashPreToolUse(
      buildRunInTerminalPayload(cwd, 'echo safe-command'),
      {
        HOOK_EARLY_CONTROLS_STATE_FILE: '.instructions-output/hooks/early-controls.json',
        HOOK_RULES_FILE: rulesPath,
      }
    );

    assert.strictEqual(output.trim(), '');
  });
});

test('PowerShell rules default to off when no hook rules config exists', () => {
  withTempDir((cwd) => {
    const output = runPowerShellPreToolUse(
      buildRunInTerminalPayload(cwd, 'echo safe-command'),
      {
        HOOK_EARLY_CONTROLS_STATE_FILE: '.instructions-output/hooks/early-controls.json',
        HOOK_RULES_FILE: path.join(cwd, 'nonexistent-hook-rules.json'),
      }
    );

    assert.strictEqual(output.trim(), '');
  });
});

console.log(`\n${passed} tests passed`);
if (skipped > 0) {
  console.log(`${skipped} tests skipped`);
}
if (process.exitCode) {
  console.error('Some tests FAILED');
} else {
  console.log('All tests passed');
}
