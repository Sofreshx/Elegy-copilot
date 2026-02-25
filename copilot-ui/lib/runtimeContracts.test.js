'use strict';

const assert = require('assert');
const path = require('path');
const childProcess = require('child_process');
const runtimeContracts = require('./runtimeContracts');

const {
  RUNTIME_CONTRACT_VERSION,
  RUNTIME_MODES,
  CAPABILITY_STATES,
  RUNTIME_COMPATIBILITY_CAPABILITIES,
  DEFAULT_RUNTIME_MODE,
  DEFAULT_CAPABILITY_STATE,
  detectRuntimeMode,
  buildCompatibilityRuntimeContract,
  buildRuntimeContract,
} = runtimeContracts;

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

test('buildRuntimeContract is deterministic for same inputs', () => {
  const input = {
    mode: 'PACKAGED',
    capabilities: {
      zFeature: 'available',
      alphaFeature: 'unavailable',
    },
  };

  const resultA = buildRuntimeContract(input);
  const resultB = buildRuntimeContract(input);

  assert.deepStrictEqual(resultA, resultB);
  assert.deepStrictEqual(Object.keys(resultA.capabilities), ['alphaFeature', 'zFeature']);
});

test('normalizes invalid mode/state inputs to safe defaults', () => {
  const result = buildRuntimeContract({
    mode: 'not-a-real-mode',
    capabilities: {
      fs: 'broken-value',
    },
  });

  assert.strictEqual(result.mode, DEFAULT_RUNTIME_MODE);
  assert.strictEqual(result.capabilities.fs, DEFAULT_CAPABILITY_STATE);
});

test('contract version is always present', () => {
  const result = buildRuntimeContract();
  assert.strictEqual(result.contractVersion, RUNTIME_CONTRACT_VERSION);
});

test('detectRuntimeMode supports explicit, packaged, and fallback modes', () => {
  assert.strictEqual(detectRuntimeMode({ explicitMode: 'packaged' }), RUNTIME_MODES.PACKAGED);
  assert.strictEqual(detectRuntimeMode({ isPackaged: true }), RUNTIME_MODES.PACKAGED);
  assert.strictEqual(detectRuntimeMode({ engineRoot: '/tmp/app.asar/dist' }), RUNTIME_MODES.PACKAGED);
  assert.strictEqual(detectRuntimeMode({ explicitMode: 'invalid-value' }), DEFAULT_RUNTIME_MODE);
});

test('buildCompatibilityRuntimeContract fills compatibility capability defaults', () => {
  const result = buildCompatibilityRuntimeContract({
    mode: 'repo',
    capabilities: {
      docker: CAPABILITY_STATES.UNAVAILABLE,
    },
  });

  assert.strictEqual(result.contractVersion, RUNTIME_CONTRACT_VERSION);
  assert.strictEqual(result.mode, RUNTIME_MODES.REPO);
  for (const capability of RUNTIME_COMPATIBILITY_CAPABILITIES) {
    assert.ok(Object.prototype.hasOwnProperty.call(result.capabilities, capability));
  }
  assert.strictEqual(result.capabilities.docker, CAPABILITY_STATES.UNAVAILABLE);
  assert.strictEqual(result.capabilities.sandbox, DEFAULT_CAPABILITY_STATE);
  assert.strictEqual(result.capabilities.wsl2, DEFAULT_CAPABILITY_STATE);
});

test('CJS import smoke', () => {
  const imported = require('./runtimeContracts');
  assert.ok(imported);
  assert.strictEqual(typeof imported.buildRuntimeContract, 'function');
});

test('ESM createRequire smoke', () => {
  const modulePath = path.resolve(__dirname, 'runtimeContracts.js');
  const script = `
    import { createRequire } from 'module';
    const require = createRequire(import.meta.url);
    const m = require(${JSON.stringify(modulePath)});
    if (!m || typeof m.buildRuntimeContract !== 'function') {
      throw new Error('runtimeContracts import failed');
    }
  `;

  childProcess.execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    stdio: 'pipe',
  });
});

console.log(`\n${passed} tests passed`);
if (process.exitCode) {
  console.error('Some tests FAILED');
} else {
  console.log('All tests passed');
}