'use strict';

const assert = require('assert');
const path = require('path');
const childProcess = require('child_process');
const permissionsContracts = require('./permissionsContracts');

const {
  PERMISSIONS_CONTRACT_VERSION,
  DEFAULT_COPILOT_SUBDIRS,
  buildPermissionLocations,
  isPathUnderRoot,
} = permissionsContracts;

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

test('default subdirs are included for each base root', () => {
  const base = path.resolve(__dirname, '..');
  const locations = buildPermissionLocations({ baseRoots: [base] });

  assert.ok(locations.includes(base));
  for (const subdir of DEFAULT_COPILOT_SUBDIRS) {
    assert.ok(locations.includes(path.resolve(base, subdir)));
  }
});

test('locations are unique, absolute, and deterministically ordered', () => {
  const baseA = path.resolve(__dirname, '..');
  const baseB = path.resolve(__dirname, '../..');

  const locations = buildPermissionLocations({
    baseRoots: [baseB, baseA, baseA],
    additionalSubdirsByBase: {
      [baseA]: ['agents', 'custom-z', 'custom-a'],
      [baseB]: ['custom-b'],
    },
  });

  assert.ok(locations.every((entry) => path.isAbsolute(entry)));

  const deduped = Array.from(new Set(locations.map((entry) => (process.platform === 'win32' ? entry.toLowerCase() : entry))));
  assert.strictEqual(locations.length, deduped.length);

  const sorted = [...locations].sort((a, b) => a.localeCompare(b));
  assert.deepStrictEqual(locations, sorted);
});

test('dynamic subdirs merge with defaults and ignore escaping entries', () => {
  const base = path.resolve(__dirname, '..');
  const locations = buildPermissionLocations({
    baseRoots: [base],
    additionalSubdirsByBase: {
      [base]: ['dynamic-tools', 'agents', 'nested/child', '../escape-attempt'],
    },
  });

  assert.ok(locations.includes(path.resolve(base, 'dynamic-tools')));
  assert.ok(locations.includes(path.resolve(base, 'nested/child')));
  assert.ok(!locations.includes(path.resolve(base, '../escape-attempt')));
});

test('path-under-root check accepts in-root and rejects escaped paths', () => {
  const root = path.resolve(__dirname, '..');
  const inRoot = path.resolve(root, 'agents/example.agent.md');
  const escaped = path.resolve(root, '../outside.txt');

  assert.strictEqual(isPathUnderRoot(root, inRoot), true);
  assert.strictEqual(isPathUnderRoot(root, escaped), false);
});

test('permission contract version is exposed', () => {
  assert.strictEqual(typeof PERMISSIONS_CONTRACT_VERSION, 'string');
  assert.ok(PERMISSIONS_CONTRACT_VERSION.length > 0);
});

test('CJS import smoke', () => {
  const imported = require('./permissionsContracts');
  assert.ok(imported);
  assert.strictEqual(typeof imported.buildPermissionLocations, 'function');
});

test('ESM createRequire smoke', () => {
  const modulePath = path.resolve(__dirname, 'permissionsContracts.js');
  const script = `
    import { createRequire } from 'module';
    const require = createRequire(import.meta.url);
    const m = require(${JSON.stringify(modulePath)});
    if (!m || typeof m.buildPermissionLocations !== 'function') {
      throw new Error('permissionsContracts import failed');
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