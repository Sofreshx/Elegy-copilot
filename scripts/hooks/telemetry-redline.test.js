#!/usr/bin/env node

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const LOG_PROMPT_PS1 = path.resolve(__dirname, 'log-prompt.ps1');
const LOG_PROMPT_SH = path.resolve(__dirname, 'log-prompt.sh');
const POST_TOOL_USE_PS1 = path.resolve(__dirname, 'post-tool-use.ps1');
const POST_TOOL_USE_SH = path.resolve(__dirname, 'post-tool-use.sh');
const ERROR_OCCURRED_PS1 = path.resolve(__dirname, 'error-occurred.ps1');
const ERROR_OCCURRED_SH = path.resolve(__dirname, 'error-occurred.sh');

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-telemetry-redline-'));
  try {
    fn(dir);
  } finally {
    removeDirWithRetry(dir);
  }
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function removeDirWithRetry(dir) {
  const maxAttempts = 30;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
      return;
    } catch (error) {
      if (!['EBUSY', 'ENOTEMPTY', 'EPERM'].includes(error && error.code) || attempt === maxAttempts) {
        throw error;
      }
      sleep(100);
    }
  }
}

function hasCommand(command) {
  try {
    childProcess.execFileSync(command, ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function readSingleJsonlEntry(cwd, fileName) {
  const filePath = path.join(cwd, '.instructions-output', 'hooks', fileName);
  assert.ok(fs.existsSync(filePath), `expected log file to exist: ${fileName}`);
  const lines = fs
    .readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  assert.strictEqual(lines.length, 1, `expected exactly one line in ${fileName}`);
  return JSON.parse(lines[0]);
}

function runPowerShellHook(scriptPath, payload, env) {
  childProcess.execFileSync('pwsh', ['-NoProfile', '-File', scriptPath], {
    cwd: payload.cwd,
    env: {
      ...process.env,
      ...env,
    },
    input: JSON.stringify(payload),
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function runBashHook(scriptPath, payload, env) {
  childProcess.execFileSync('bash', ['-lc', buildBashScriptCommand(payload.cwd, scriptPath)], {
    cwd: payload.cwd,
    env: {
      ...process.env,
      ...env,
    },
    input: JSON.stringify(payload),
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function buildBashScriptCommand(cwd, scriptPath) {
  const relativePath = path.relative(cwd, scriptPath).replace(/\\/g, '/');
  return `${quoteForBash(relativePath)} <&0`;
}

function quoteForBash(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function assertNoSensitiveOrUnexpectedKeys(entry, expectedAllowedKeys) {
  for (const key of Object.keys(entry)) {
    assert.ok(expectedAllowedKeys.includes(key), `unexpected key found: ${key}`);
  }
}

function bashHasSupportedPython() {
  try {
    childProcess.execFileSync(
      'bash',
      ['-lc', 'command -v python3 >/dev/null 2>&1 || command -v python >/dev/null 2>&1 || command -v python.exe >/dev/null 2>&1 || command -v py.exe >/dev/null 2>&1 || command -v py >/dev/null 2>&1'],
      { stdio: 'ignore' }
    );
    return true;
  } catch {
    return false;
  }
}

const canRunBashPath = hasCommand('bash') && bashHasSupportedPython();

// PowerShell-focused tests (required on Windows).
test('PowerShell log-prompt drops denylisted sensitive prompt and enforces allowlist', () => {
  withTempDir((cwd) => {
    const payload = {
      timestamp: '2026-02-25T00:00:00Z',
      cwd,
      prompt: 'Authorization: Bearer sk-test-secret-token-value',
      unexpected: 'drop-me',
    };

    runPowerShellHook(LOG_PROMPT_PS1, payload, { HOOK_TELEMETRY_OPTOUT: 'false' });

    const entry = readSingleJsonlEntry(cwd, 'prompts.jsonl');
    assert.strictEqual(entry.event, 'userPromptSubmitted');
    assert.strictEqual(entry.timestamp, payload.timestamp);
    assert.strictEqual(entry.schemaVersion, '1.0.0');
    assert.strictEqual(entry.optOut, false);
    assert.ok(!Object.prototype.hasOwnProperty.call(entry, 'prompt'), 'prompt must be removed when denylisted');
    assertNoSensitiveOrUnexpectedKeys(entry, ['event', 'timestamp', 'schemaVersion', 'optOut', 'prompt', 'promptLength']);
  });
});

test('PowerShell log-prompt opt-out emits minimum audit fields', () => {
  withTempDir((cwd) => {
    const payload = {
      timestamp: '2026-02-25T00:00:00Z',
      cwd,
      prompt: 'hello world',
    };

    runPowerShellHook(LOG_PROMPT_PS1, payload, { HOOK_TELEMETRY_OPTOUT: 'true' });

    const entry = readSingleJsonlEntry(cwd, 'prompts.jsonl');
    assert.strictEqual(entry.event, 'userPromptSubmitted');
    assert.strictEqual(entry.timestamp, payload.timestamp);
    assert.strictEqual(entry.schemaVersion, '1.0.0');
    assert.strictEqual(entry.optOut, true);
    assert.strictEqual(entry.promptLength, 11);
    assert.ok(!Object.prototype.hasOwnProperty.call(entry, 'prompt'));
    assert.deepStrictEqual(
      Object.keys(entry).sort(),
      ['event', 'timestamp', 'schemaVersion', 'optOut', 'promptLength'].sort()
    );
  });
});

test('PowerShell post-tool-use drops denylisted resultType and keeps minimal identifiers', () => {
  withTempDir((cwd) => {
    const payload = {
      timestamp: '2026-02-25T00:00:00Z',
      cwd,
      toolName: 'read_file',
      toolResult: {
        resultType: 'token=top-secret-value',
      },
      toolArgs: '{"unexpected":"drop"}',
    };

    runPowerShellHook(POST_TOOL_USE_PS1, payload, { HOOK_TELEMETRY_OPTOUT: 'false' });

    const entry = readSingleJsonlEntry(cwd, 'post-tool-use.jsonl');
    assert.strictEqual(entry.event, 'postToolUse');
    assert.strictEqual(entry.timestamp, payload.timestamp);
    assert.strictEqual(entry.schemaVersion, '1.0.0');
    assert.strictEqual(entry.optOut, false);
    assert.strictEqual(entry.toolName, 'read_file');
    assert.ok(!Object.prototype.hasOwnProperty.call(entry, 'resultType'));
    assertNoSensitiveOrUnexpectedKeys(entry, ['event', 'timestamp', 'schemaVersion', 'optOut', 'toolName', 'resultType']);
  });
});

test('PowerShell post-tool-use opt-out emits minimum audit fields', () => {
  withTempDir((cwd) => {
    const payload = {
      timestamp: '2026-02-25T00:00:00Z',
      cwd,
      toolName: 'write_file',
      toolResult: {
        resultType: 'ok',
      },
    };

    runPowerShellHook(POST_TOOL_USE_PS1, payload, { HOOK_TELEMETRY_OPTOUT: 'true' });

    const entry = readSingleJsonlEntry(cwd, 'post-tool-use.jsonl');
    assert.strictEqual(entry.event, 'postToolUse');
    assert.strictEqual(entry.timestamp, payload.timestamp);
    assert.strictEqual(entry.schemaVersion, '1.0.0');
    assert.strictEqual(entry.optOut, true);
    assert.strictEqual(entry.toolName, 'write_file');
    assert.ok(!Object.prototype.hasOwnProperty.call(entry, 'resultType'));
    assert.deepStrictEqual(
      Object.keys(entry).sort(),
      ['event', 'timestamp', 'schemaVersion', 'optOut', 'toolName'].sort()
    );
  });
});

test('PowerShell error-occurred drops denylisted message and enforces allowlist', () => {
  withTempDir((cwd) => {
    const payload = {
      timestamp: '2026-02-25T00:00:00Z',
      cwd,
      error: {
        name: 'ValidationError',
        message: 'password=super-secret',
        stack: 'drop-this',
      },
      context: {
        drop: true,
      },
    };

    runPowerShellHook(ERROR_OCCURRED_PS1, payload, { HOOK_TELEMETRY_OPTOUT: 'false' });

    const entry = readSingleJsonlEntry(cwd, 'errors.jsonl');
    assert.strictEqual(entry.event, 'errorOccurred');
    assert.strictEqual(entry.timestamp, payload.timestamp);
    assert.strictEqual(entry.schemaVersion, '1.0.0');
    assert.strictEqual(entry.optOut, false);
    assert.strictEqual(entry.name, 'ValidationError');
    assert.ok(!Object.prototype.hasOwnProperty.call(entry, 'message'));
    assertNoSensitiveOrUnexpectedKeys(entry, ['event', 'timestamp', 'schemaVersion', 'optOut', 'name', 'message']);
  });
});

test('PowerShell error-occurred opt-out emits minimum audit fields', () => {
  withTempDir((cwd) => {
    const payload = {
      timestamp: '2026-02-25T00:00:00Z',
      cwd,
      error: {
        name: 'RuntimeError',
        message: 'non-sensitive message',
      },
    };

    runPowerShellHook(ERROR_OCCURRED_PS1, payload, { HOOK_TELEMETRY_OPTOUT: '1' });

    const entry = readSingleJsonlEntry(cwd, 'errors.jsonl');
    assert.strictEqual(entry.event, 'errorOccurred');
    assert.strictEqual(entry.timestamp, payload.timestamp);
    assert.strictEqual(entry.schemaVersion, '1.0.0');
    assert.strictEqual(entry.optOut, true);
    assert.strictEqual(entry.name, 'RuntimeError');
    assert.ok(!Object.prototype.hasOwnProperty.call(entry, 'message'));
    assert.deepStrictEqual(
      Object.keys(entry).sort(),
      ['event', 'timestamp', 'schemaVersion', 'optOut', 'name'].sort()
    );
  });
});

// Bash coverage with capability-based skip.
testIf(canRunBashPath, 'Bash log-prompt drops denylisted prompt and supports opt-out minimum fields', () => {
  withTempDir((cwd) => {
    const denyPayload = {
      timestamp: '2026-02-25T00:00:00Z',
      cwd,
      prompt: 'token=redline-value',
    };

    runBashHook(LOG_PROMPT_SH, denyPayload, { HOOK_TELEMETRY_OPTOUT: 'false' });
    const denyEntry = readSingleJsonlEntry(cwd, 'prompts.jsonl');
    assert.ok(!Object.prototype.hasOwnProperty.call(denyEntry, 'prompt'));

    const optOutPayload = {
      timestamp: '2026-02-25T00:00:00Z',
      cwd,
      prompt: 'hello bash',
    };

    runBashHook(LOG_PROMPT_SH, optOutPayload, { HOOK_TELEMETRY_OPTOUT: 'true' });
    const filePath = path.join(cwd, '.instructions-output', 'hooks', 'prompts.jsonl');
    const lines = fs
      .readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line));

    assert.strictEqual(lines.length, 2);
    const entry = lines[1];
    assert.strictEqual(entry.event, 'userPromptSubmitted');
    assert.strictEqual(entry.schemaVersion, '1.0.0');
    assert.strictEqual(entry.optOut, true);
    assert.strictEqual(entry.promptLength, 10);
    assert.ok(!Object.prototype.hasOwnProperty.call(entry, 'prompt'));
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
