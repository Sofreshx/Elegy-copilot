'use strict';

const assert = require('assert');

const {
  isNonLoopback,
  checkAuth,
  resolveToken,
  derivePlanningActorId,
} = require('./auth');

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

function createRequest(remoteAddress, authorization = null) {
  return {
    socket: {
      remoteAddress,
    },
    headers: authorization ? { authorization } : {},
  };
}

async function run() {
  await test('checkAuth allows loopback bypass unless explicitly disabled', async () => {
    assert.strictEqual(checkAuth(createRequest('127.0.0.1'), 'secret-token'), true);
    assert.strictEqual(
      checkAuth(createRequest('127.0.0.1'), 'secret-token', { allowLoopbackBypass: false }),
      false
    );
  });

  await test('checkAuth enforces bearer auth for non-loopback requests', async () => {
    assert.strictEqual(checkAuth(createRequest('10.0.0.2', 'Bearer secret-token'), 'secret-token'), true);
    assert.strictEqual(checkAuth(createRequest('10.0.0.2', 'Bearer wrong-token'), 'secret-token'), false);
    assert.strictEqual(checkAuth(createRequest('10.0.0.2'), 'secret-token'), false);
  });

  await test('resolveToken preserves precedence and non-loopback auto-generation', async () => {
    assert.strictEqual(resolveToken({ token: 'arg-token' }, '0.0.0.0', { COPILOT_UI_TOKEN: 'env-token' }), 'arg-token');
    assert.strictEqual(resolveToken({}, '0.0.0.0', { COPILOT_UI_TOKEN: 'env-token' }), 'env-token');

    const generated = resolveToken({}, '0.0.0.0', {});
    assert.match(generated, /^[a-f0-9]{64}$/);
    assert.strictEqual(resolveToken({}, '127.0.0.1', {}), null);
  });

  await test('derivePlanningActorId stays deterministic for auth and loopback users', async () => {
    assert.ok(isNonLoopback('0.0.0.0'));
    assert.strictEqual(derivePlanningActorId(null), 'local-loopback-user');
    assert.strictEqual(derivePlanningActorId('  demo-token '), derivePlanningActorId('demo-token'));
    assert.match(derivePlanningActorId('demo-token'), /^auth-[a-f0-9]{16}$/);
  });

  if (!process.exitCode) {
    console.log(`Passed ${passed} auth module tests`);
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
