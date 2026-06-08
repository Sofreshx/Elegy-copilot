'use strict';

const assert = require('node:assert/strict');

const {
  KNOWN_CLI_TOOLS,
  getCliToolStatus,
  listCliToolStatuses,
  installCliTool,
  isNpmAvailable,
} = require('./toolCliInstallers');

let passed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  PASS: ${name}`);
  } catch (error) {
    console.error(`  FAIL: ${name}`);
    console.error(`    ${error.message}`);
    process.exitCode = 1;
  }
}

function createMockSpawnSync(result = {}) {
  return (command, args, options) => {
    if (result.error) {
      return { error: result.error, status: null, stdout: '', stderr: '' };
    }
    return {
      error: null,
      status: result.status ?? 0,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
    };
  };
}

function createMockExecFile(result = {}) {
  return (command, args, options, callback) => {
    if (result.error) {
      callback(result.error, result.stdout ?? '', result.stderr ?? '');
      return;
    }
    callback(null, result.stdout ?? '', result.stderr ?? '');
  };
}

async function run() {
  console.log('\nTool CLI Installers Tests\n');

  await test('KNOWN_CLI_TOOLS has four entries', () => {
    assert.equal(KNOWN_CLI_TOOLS.length, 4);
    const ids = KNOWN_CLI_TOOLS.map((t) => t.id).sort();
    assert.deepEqual(ids, ['claude-code-cli', 'codex-cli', 'gemini-cli', 'opencode-cli']);
  });

  await test('KNOWN_CLI_TOOLS entries have required fields', () => {
    for (const tool of KNOWN_CLI_TOOLS) {
      assert.ok(tool.id, `tool ${JSON.stringify(tool)} missing id`);
      assert.ok(tool.label, `tool ${tool.id} missing label`);
      assert.ok(tool.command, `tool ${tool.id} missing command`);
      assert.ok(tool.packageName, `tool ${tool.id} missing packageName`);
      assert.ok(tool.installCommand, `tool ${tool.id} missing installCommand`);
    }
  });

  await test('getCliToolStatus returns installed=false when command not found (ENOENT)', () => {
    const spawnSync = createMockSpawnSync({
      error: Object.assign(new Error('not found'), { code: 'ENOENT' }),
    });
    const status = getCliToolStatus('claude-code-cli', spawnSync);
    assert.equal(status.installed, false);
    assert.equal(status.lastError, null);
  });

  await test('getCliToolStatus returns installed=false with error for non-ENOENT errors', () => {
    const spawnSync = createMockSpawnSync({
      error: Object.assign(new Error('permission denied'), { code: 'EPERM' }),
    });
    const status = getCliToolStatus('codex-cli', spawnSync);
    assert.equal(status.installed, false);
    assert.ok(status.lastError.includes('permission denied'));
  });

  await test('getCliToolStatus returns installed=true when command succeeds', () => {
    const spawnSync = createMockSpawnSync({ stdout: '1.2.3\n', status: 0 });
    const status = getCliToolStatus('opencode-cli', spawnSync);
    assert.equal(status.installed, true);
    assert.equal(status.version, '1.2.3');
    assert.equal(status.lastError, null);
  });

  await test('getCliToolStatus returns installed=false on non-zero exit', () => {
    const spawnSync = createMockSpawnSync({ status: 1, stderr: 'error output' });
    const status = getCliToolStatus('gemini-cli', spawnSync);
    assert.equal(status.installed, false);
    assert.equal(status.lastError, 'error output');
  });

  await test('getCliToolStatus throws for unknown tool id', () => {
    const spawnSync = createMockSpawnSync();
    assert.throws(() => getCliToolStatus('nonexistent', spawnSync), /Unknown CLI tool id/);
  });

  await test('getCliToolStatus passes shell: true to spawnSync', () => {
    let capturedOptions = null;
    const spawnSync = (command, args, options) => {
      capturedOptions = options;
      return { error: null, status: 0, stdout: '1.0.0\n', stderr: '' };
    };
    getCliToolStatus('claude-code-cli', spawnSync);
    assert.equal(capturedOptions.shell, true);
  });

  await test('listCliToolStatuses returns status for all tools', () => {
    const spawnSync = createMockSpawnSync({ stdout: '1.0.0\n', status: 0 });
    const statuses = listCliToolStatuses(spawnSync);
    assert.equal(statuses.length, 4);
    for (const status of statuses) {
      assert.equal(status.installed, true);
    }
  });

  await test('installCliTool returns error when npm is not available', async () => {
    const originalIsNpmAvailable = isNpmAvailable;
    const toolCliInstallers = require('./toolCliInstallers');

    const result = await installCliTool('claude-code-cli', createMockExecFile());
    if (!isNpmAvailable()) {
      assert.equal(result.ok, false);
      assert.ok(result.error.includes('npm is not available'));
    } else {
      assert.equal(result.ok, true);
    }
  });

  await test('installCliTool returns error on ENOENT from execFile', async () => {
    if (!isNpmAvailable()) {
      return;
    }
    const execFile = createMockExecFile({
      error: Object.assign(new Error('not found'), { code: 'ENOENT' }),
    });
    const result = await installCliTool('codex-cli', execFile);
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('npm is not available'));
  });

  await test('installCliTool returns error message from stderr on failure', async () => {
    if (!isNpmAvailable()) {
      return;
    }
    const execFile = createMockExecFile({
      error: Object.assign(new Error('install failed'), { code: 'ELifecycle' }),
      stderr: 'npm ERR! code EPERM',
    });
    const result = await installCliTool('opencode-cli', execFile);
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('npm ERR! code EPERM'));
  });

  await test('installCliTool passes shell: true to execFile', async () => {
    if (!isNpmAvailable()) {
      return;
    }
    let capturedOptions = null;
    const execFile = (command, args, options, callback) => {
      capturedOptions = options;
      callback(null, '', '');
    };
    await installCliTool('gemini-cli', execFile);
    assert.equal(capturedOptions.shell, true);
  });

  await test('installCliTool returns error for unknown tool id', async () => {
    await assert.rejects(() => installCliTool('nonexistent'), /Unknown CLI tool id/);
  });

  if (!process.exitCode) {
    console.log(`\nTool CLI installers tests passed (${passed})`);
  }
}

run().catch((error) => {
  console.error('Tool CLI installers tests failed');
  console.error(error);
  process.exitCode = 1;
});
