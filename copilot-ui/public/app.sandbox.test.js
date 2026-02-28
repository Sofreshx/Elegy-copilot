'use strict';

const assert = require('assert');

const {
  SANDBOX_ID_PATTERN,
  createSandboxDraftId,
  buildCreateSandboxPayload,
  resolveCanonicalSandboxId,
  getActionLogEntries,
  resetActionLogEntries,
  runActionWithLog,
} = require('./app');

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
  await test('createSandboxDraftId returns backend-valid sandbox IDs', () => {
    const value = createSandboxDraftId({ nowMs: Date.parse('2026-02-26T00:00:00.000Z'), entropy: 'Draft_UUID-ABC_123' });

    assert.strictEqual(typeof value, 'string');
    assert.ok(value.startsWith('sb-'));
    assert.ok(value.length <= 64);
    assert.ok(SANDBOX_ID_PATTERN.test(value));
  });

  await test('buildCreateSandboxPayload uses edited value for first persist payload', () => {
    const payload = buildCreateSandboxPayload('  sb-edited-before-create  ');

    assert.deepStrictEqual(payload, { sandboxId: 'sb-edited-before-create' });
  });

  await test('buildCreateSandboxPayload keeps backward-compatible blank create behavior', () => {
    const payload = buildCreateSandboxPayload('   ');

    assert.deepStrictEqual(payload, {});
  });

  await test('resolveCanonicalSandboxId prioritizes canonical result sandboxId then fallback sources', () => {
    const canonicalFromResult = resolveCanonicalSandboxId(
      { result: { sandboxId: 'sb-result' }, sandboxId: 'sb-response' },
      'sb-fallback',
      { sandboxId: 'sb-payload' },
    );
    assert.strictEqual(canonicalFromResult, 'sb-result');

    const canonicalFromResponse = resolveCanonicalSandboxId(
      { sandboxId: 'sb-response' },
      'sb-fallback',
      { sandboxId: 'sb-payload' },
    );
    assert.strictEqual(canonicalFromResponse, 'sb-response');

    const canonicalFromFallback = resolveCanonicalSandboxId({}, 'sb-fallback', { sandboxId: 'sb-payload' });
    assert.strictEqual(canonicalFromFallback, 'sb-fallback');

    const canonicalFromPayload = resolveCanonicalSandboxId({}, '', { sandboxId: 'sb-payload' });
    assert.strictEqual(canonicalFromPayload, 'sb-payload');
  });

  await test('runActionWithLog records deterministic start and success entries', async () => {
    resetActionLogEntries();

    const result = await runActionWithLog('sandbox.create', async () => ({ ok: true }), {
      startMessage: 'starting',
      successMessage: 'done',
    });

    assert.deepStrictEqual(result, { ok: true });

    const entries = getActionLogEntries();
    assert.strictEqual(entries.length, 2);
    assert.strictEqual(entries[0].action, 'sandbox.create');
    assert.strictEqual(entries[0].stage, 'start');
    assert.strictEqual(entries[0].details.deterministic, true);
    assert.strictEqual(entries[1].action, 'sandbox.create');
    assert.strictEqual(entries[1].stage, 'success');
    assert.strictEqual(entries[1].details.deterministic, true);
  });

  await test('runActionWithLog records deterministic failure details for API-style errors', async () => {
    resetActionLogEntries();

    await assert.rejects(
      () => runActionWithLog('sandbox.open-terminal', async () => {
        throw new Error('503 Service Unavailable: {"error":{"code":"tracker_timeout","reason":"tracker_request_timeout","message":"Tracker request timed out","deterministic":true}}');
      }, {
        failurePrefix: 'Sandbox open-terminal failed',
      }),
      /503 Service Unavailable/
    );

    const entries = getActionLogEntries();
    assert.strictEqual(entries.length, 2);
    assert.strictEqual(entries[0].action, 'sandbox.open-terminal');
    assert.strictEqual(entries[0].stage, 'start');
    assert.strictEqual(entries[1].action, 'sandbox.open-terminal');
    assert.strictEqual(entries[1].stage, 'failure');
    assert.strictEqual(entries[1].details.statusCode, 503);
    assert.strictEqual(entries[1].details.code, 'tracker_timeout');
    assert.strictEqual(entries[1].details.reason, 'tracker_request_timeout');
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
