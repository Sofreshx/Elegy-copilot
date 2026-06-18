'use strict';

const assert = require('node:assert/strict');

const {
  CLI_TOOLING_CATALOG,
  resolveCliToolingCommand,
  runCliInstall,
  detectCliTool,
} = require('./cliTooling');

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

function createMockChildProcess(execSyncImpl) {
  return {
    execSync(command, options) {
      if (execSyncImpl) {
        return execSyncImpl(command, options);
      }
      return '';
    },
  };
}

async function run() {
  console.log('\nCLI Tooling Tests\n');

  await test('catalog has five tools', () => {
    assert.equal(CLI_TOOLING_CATALOG.length, 5);
    const ids = CLI_TOOLING_CATALOG.map((entry) => entry.id).sort();
    assert.deepEqual(ids, ['claude-cli', 'codex-cli', 'elegy-planning', 'gemini-cli', 'opencode-cli']);
  });

  await test('resolveCliToolingCommand returns npm install command for opencode-cli', () => {
    const cmd = resolveCliToolingCommand('opencode-cli');
    assert.equal(cmd, 'npm install -g opencode-ai@latest');
  });

  await test('resolveCliToolingCommand returns npm install command for codex-cli', () => {
    const cmd = resolveCliToolingCommand('codex-cli');
    assert.equal(cmd, 'npm install -g @openai/codex@latest');
  });

  await test('resolveCliToolingCommand returns npm install command for claude-cli', () => {
    const cmd = resolveCliToolingCommand('claude-cli');
    assert.equal(cmd, 'npm install -g @anthropic-ai/claude-code@latest');
  });

  await test('resolveCliToolingCommand honors custom version', () => {
    const cmd = resolveCliToolingCommand('codex-cli', { version: '1.2.3' });
    assert.equal(cmd, 'npm install -g @openai/codex@1.2.3');
  });

  await test('resolveCliToolingCommand returns null for unknown tool', () => {
    const cmd = resolveCliToolingCommand('nonexistent');
    assert.equal(cmd, null);
  });

  await test('runCliInstall returns error for unknown tool', () => {
    const result = runCliInstall('nonexistent');
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('Unknown CLI tool'));
  });

  await test('runCliInstall in dryRun mode returns command without executing', () => {
    let execCalled = false;
    const childProcess = createMockChildProcess(() => {
      execCalled = true;
      return '';
    });

    const result = runCliInstall('opencode-cli', { dryRun: true, childProcess });
    assert.equal(result.ok, true);
    assert.equal(result.dryRun, true);
    assert.equal(result.command, 'npm install -g opencode-ai@latest');
    assert.equal(execCalled, false);
  });

  await test('runCliInstall calls execSync when not dryRun', () => {
    let capturedCommand = null;
    const childProcess = createMockChildProcess((command) => {
      capturedCommand = command;
      return 'installed successfully';
    });

    const result = runCliInstall('codex-cli', { childProcess });
    assert.equal(result.ok, true);
    assert.equal(result.dryRun, false);
    assert.ok(capturedCommand.includes('npm install -g @openai/codex@latest'));
    assert.equal(result.output, 'installed successfully');
  });

  await test('runCliInstall returns error when execSync throws', () => {
    const childProcess = createMockChildProcess(() => {
      throw new Error('npm EPERM');
    });

    const result = runCliInstall('claude-cli', { childProcess });
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('npm EPERM'));
    assert.ok(result.command.includes('@anthropic-ai/claude-code'));
  });

  await test('detectCliTool returns not installed for unknown tool', () => {
    const result = detectCliTool('nonexistent');
    assert.equal(result.installed, false);
    assert.equal(result.error, 'Unknown CLI tool: nonexistent');
  });

  await test('detectCliTool returns installed true when npx succeeds', () => {
    const childProcess = createMockChildProcess(() => '1.2.3\n');
    const result = detectCliTool('opencode-cli', { childProcess });
    assert.equal(result.installed, true);
    assert.equal(result.version, '1.2.3');
    assert.equal(result.title, 'OpenCode CLI');
  });

  await test('detectCliTool returns installed false when npx throws', () => {
    const childProcess = createMockChildProcess(() => {
      throw new Error('command not found: npx');
    });
    const result = detectCliTool('codex-cli', { childProcess });
    assert.equal(result.installed, false);
    assert.equal(result.lastError, 'command not found: npx');
  });

  if (!process.exitCode) {
    console.log(`\nCLI tooling tests passed (${passed})`);
  }
}

run().catch((error) => {
  console.error('CLI tooling tests failed');
  console.error(error);
  process.exitCode = 1;
});
