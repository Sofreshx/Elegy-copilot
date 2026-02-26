'use strict';

const assert = require('assert');

const {
  SANDBOX_ID_PATTERN,
  createSandboxDraftId,
  buildCreateSandboxPayload,
  resolveCanonicalSandboxId,
} = require('./app');

let passed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  PASS: ${name}`);
  } catch (error) {
    console.error(`  FAIL: ${name}`);
    console.error(`    ${error.message}`);
    process.exitCode = 1;
  }
}

function run() {
  test('createSandboxDraftId returns backend-valid sandbox IDs', () => {
    const value = createSandboxDraftId({ nowMs: Date.parse('2026-02-26T00:00:00.000Z'), entropy: 'Draft_UUID-ABC_123' });

    assert.strictEqual(typeof value, 'string');
    assert.ok(value.startsWith('sb-'));
    assert.ok(value.length <= 64);
    assert.ok(SANDBOX_ID_PATTERN.test(value));
  });

  test('buildCreateSandboxPayload uses edited value for first persist payload', () => {
    const payload = buildCreateSandboxPayload('  sb-edited-before-create  ');

    assert.deepStrictEqual(payload, { sandboxId: 'sb-edited-before-create' });
  });

  test('buildCreateSandboxPayload keeps backward-compatible blank create behavior', () => {
    const payload = buildCreateSandboxPayload('   ');

    assert.deepStrictEqual(payload, {});
  });

  test('resolveCanonicalSandboxId prioritizes canonical result sandboxId then fallback sources', () => {
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

  console.log(`\n${passed} tests passed`);
  if (process.exitCode) {
    console.error('Some tests FAILED');
  } else {
    console.log('All tests passed');
  }
}

run();
