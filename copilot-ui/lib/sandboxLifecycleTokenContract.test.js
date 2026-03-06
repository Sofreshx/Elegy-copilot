'use strict';

const assert = require('assert');
const {
  SANDBOX_TOKEN_CANONICAL_STATE,
  SANDBOX_TOKEN_CANONICAL_CODE,
  isKnownMissingTokenIndicator,
  toCanonicalMissingTokenError,
} = require('./sandboxLifecycleTokenContract');

let passed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  PASS: ${name}`);
  } catch (error) {
    process.exitCode = 1;
    console.error(`  FAIL: ${name}`);
    console.error(`    ${error.message}`);
  }
}

test('exports canonical literals', () => {
  assert.strictEqual(SANDBOX_TOKEN_CANONICAL_STATE, 'token_missing');
  assert.strictEqual(SANDBOX_TOKEN_CANONICAL_CODE, 'MISSING_SANDBOX_TOKEN');
});

test('WS05-I1 isKnownMissingTokenIndicator strict predicate truth table', () => {
  const cases = [
    { payload: 'missing_token', expected: true },
    { payload: ' tracker_token_missing ', expected: true },
    { payload: 'Tracker token not configured', expected: true },
    { payload: 'MISSING_SANDBOX_TOKEN', expected: true },
    { payload: { status: 'missing_token' }, expected: true },
    { payload: { code: 'tracker_token_missing' }, expected: true },
    { payload: { reason: 'tracker_token_missing' }, expected: true },
    { payload: { error: 'Tracker token not configured' }, expected: true },
    { payload: { message: 'Tracker token not configured' }, expected: true },
    { payload: { error: { message: 'Tracker token not configured' } }, expected: true },
    { payload: { status: 'ready' }, expected: false },
    { payload: { code: 'tracker_auth_failed' }, expected: false },
    { payload: { message: 'Tracker unavailable' }, expected: false },
    { payload: null, expected: false },
    { payload: '', expected: false },
  ];

  for (const entry of cases) {
    assert.strictEqual(
      isKnownMissingTokenIndicator(entry.payload),
      entry.expected,
      `Expected ${JSON.stringify(entry.payload)} => ${entry.expected}`,
    );
  }
});

test('toCanonicalMissingTokenError maps known indicator with default message', () => {
  const mapped = toCanonicalMissingTokenError({ status: 'missing_token' });
  assert.ok(mapped);
  assert.strictEqual(mapped.status, SANDBOX_TOKEN_CANONICAL_STATE);
  assert.strictEqual(mapped.code, SANDBOX_TOKEN_CANONICAL_CODE);
  assert.strictEqual(mapped.reason, SANDBOX_TOKEN_CANONICAL_STATE);
  assert.strictEqual(mapped.message, 'Tracker token not configured');
  assert.strictEqual(mapped.legacyCode, 'tracker_token_missing');
});

test('toCanonicalMissingTokenError preserves explicit message when provided', () => {
  const mapped = toCanonicalMissingTokenError({
    code: 'tracker_token_missing',
    message: 'Tracker token not configured. Set --tracker-token',
  });

  assert.ok(mapped);
  assert.strictEqual(mapped.message, 'Tracker token not configured. Set --tracker-token');
});

test('toCanonicalMissingTokenError returns null for unknown payloads', () => {
  const mapped = toCanonicalMissingTokenError({ code: 'tracker_auth_failed' });
  assert.strictEqual(mapped, null);
});

console.log(`\n${passed} tests passed`);
if (process.exitCode) {
  console.error('Some tests FAILED');
} else {
  console.log('All tests passed');
}
