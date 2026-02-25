#!/usr/bin/env node

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { signWaiverPayload, evaluateBreakGlassWaiver } = require('./policy/scanner');

const VALIDATOR_PATH = path.resolve(__dirname, 'validate-policy-waiver.js');
const SECRET = 'test-waiver-secret';

let passed = 0;
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

function withTempFile(content, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-waiver-test-'));
  const filePath = path.join(dir, 'waiver.json');
  try {
    fs.writeFileSync(filePath, JSON.stringify(content, null, 2), 'utf8');
    fn(filePath);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function runValidator(filePath, controlId) {
  const args = [VALIDATOR_PATH, filePath];
  if (controlId) args.push(controlId);
  return childProcess.execFileSync(process.execPath, args, {
    env: {
      ...process.env,
      INSTRUCTION_ENGINE_POLICY_WAIVER_SECRET: SECRET,
    },
    stdio: 'pipe',
  }).toString('utf8');
}

function expectValidatorFailure(filePath, controlId) {
  let threw = false;
  try {
    runValidator(filePath, controlId);
  } catch {
    threw = true;
  }
  assert.strictEqual(threw, true, 'validator should fail');
}

function buildValidWaiver() {
  const waiver = {
    schemaVersion: '1.0.0',
    waiverId: 'waiver.test.policy-gate',
    policyVersion: '1.0.0',
    controls: ['api.block.invalid-policy-evidence'],
    issuedAt: new Date(Date.now() - 60_000).toISOString(),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    reason: 'Temporary emergency override for operational continuity.',
    signature: {
      algorithm: 'hmac-sha256',
      keyId: 'test-key',
      value: '',
    },
  };
  waiver.signature.value = signWaiverPayload(waiver, SECRET);
  return waiver;
}

test('validator accepts a valid signed waiver', () => {
  withTempFile(buildValidWaiver(), (filePath) => {
    const out = runValidator(filePath, 'api.block.invalid-policy-evidence');
    assert.ok(out.includes('Policy waiver validation passed'));
  });
});

test('validator rejects tampered waiver payload', () => {
  const waiver = buildValidWaiver();
  waiver.reason = 'Tampered reason should break signature';

  withTempFile(waiver, (filePath) => {
    expectValidatorFailure(filePath, 'api.block.invalid-policy-evidence');
  });
});

test('validator rejects expired waiver', () => {
  const waiver = buildValidWaiver();
  waiver.expiresAt = new Date(Date.now() - 10_000).toISOString();
  waiver.signature.value = signWaiverPayload(waiver, SECRET);

  withTempFile(waiver, (filePath) => {
    expectValidatorFailure(filePath, 'api.block.invalid-policy-evidence');
  });
});

test('validator rejects scope mismatch', () => {
  withTempFile(buildValidWaiver(), (filePath) => {
    expectValidatorFailure(filePath, 'ci.block.missing-policy-lock');
  });
});

test('scanner waiver evaluator fails closed for invalid signature', () => {
  const waiver = buildValidWaiver();
  waiver.signature.value = '0'.repeat(64);

  const result = evaluateBreakGlassWaiver({
    waiver,
    controlId: 'api.block.invalid-policy-evidence',
    policyVersion: '1.0.0',
    secret: SECRET,
  });

  assert.strictEqual(result.allowed, false);
  assert.strictEqual(result.reason, 'signature_mismatch');
});

console.log(`\n${passed} tests passed`);
if (process.exitCode) {
  console.error('Some tests FAILED');
} else {
  console.log('All tests passed');
}
