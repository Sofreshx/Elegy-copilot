'use strict';

const assert = require('assert');

const {
  containsUnsafeShellSyntax,
  validateOpenTerminalLifecyclePayload,
} = require('./server');

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

async function run() {
  await test('validateOpenTerminalLifecyclePayload accepts strict valid payload', async () => {
    const result = validateOpenTerminalLifecyclePayload({
      sandboxId: 'sb-1',
      launcher: 'pwsh',
      profile: 'default',
    });

    assert.deepStrictEqual(result, {
      ok: true,
      value: {
        sandboxId: 'sb-1',
        launcher: 'pwsh',
        profile: 'default',
      },
    });
  });

  await test('validateOpenTerminalLifecyclePayload denies env injection', async () => {
    const result = validateOpenTerminalLifecyclePayload({
      sandboxId: 'sb-1',
      environment: { PATH: '/tmp' },
    });

    assert.deepStrictEqual(result, {
      ok: false,
      error: {
        code: 'env_injection_denied',
        reason: 'forbidden_field:environment',
      },
    });
  });

  await test('validateOpenTerminalLifecyclePayload rejects fuzz metacharacters', async () => {
    const fuzz = ['sb-1;whoami', 'sb-1&&echo', 'sb-1${HOME}', 'sb-1$(whoami)'];
    for (const sandboxId of fuzz) {
      const result = validateOpenTerminalLifecyclePayload({ sandboxId });
      assert.deepStrictEqual(result, {
        ok: false,
        error: {
          code: 'invalid_lifecycle_payload',
          reason: 'unsafe_shell_syntax:sandboxId',
        },
      });
    }
  });

  await test('containsUnsafeShellSyntax detects expansion markers', async () => {
    assert.strictEqual(containsUnsafeShellSyntax('safe-id'), false);
    assert.strictEqual(containsUnsafeShellSyntax('bad$HOME'), true);
    assert.strictEqual(containsUnsafeShellSyntax('bad%USERPROFILE%'), true);
  });

  console.log(`\n${passed} tests passed`);
  if (process.exitCode) {
    console.error('Some tests FAILED');
  } else {
    console.log('All tests passed');
  }
}

run().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});