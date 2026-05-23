'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { DEFAULT_COPILOT_SUBDIRS } = require('./permissionsContracts');
const {
  listFirstLevelSubdirs,
  resolvePermissionLocations,
} = require('./permissionLocationsResolver');

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

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-perm-resolver-'));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('listFirstLevelSubdirs returns only first-level directories', () => {
  withTempDir((base) => {
    fs.mkdirSync(path.join(base, 'agents'));
    fs.mkdirSync(path.join(base, 'custom-folder'));
    fs.mkdirSync(path.join(base, 'nested', 'child'), { recursive: true });
    fs.writeFileSync(path.join(base, 'README.txt'), 'x', 'utf8');

    const subdirs = listFirstLevelSubdirs(base);
    assert.ok(subdirs.includes('agents'));
    assert.ok(subdirs.includes('custom-folder'));
    assert.ok(subdirs.includes('nested'));
    assert.ok(!subdirs.includes('nested/child'));
    assert.ok(!subdirs.includes('README.txt'));
  });
});

test('resolvePermissionLocations merges defaults with dynamic first-level folders', () => {
  withTempDir((base) => {
    fs.mkdirSync(path.join(base, 'custom-a'));
    fs.mkdirSync(path.join(base, 'custom-b'));

    const result = resolvePermissionLocations({
      baseRoots: [base],
      includeDefaultSubdirs: true,
      scanExistingSubdirs: true,
    });

    assert.ok(result.locations.includes(base));
    for (const subdir of DEFAULT_COPILOT_SUBDIRS) {
      assert.ok(result.locations.includes(path.join(base, subdir)));
    }
    assert.ok(result.locations.includes(path.join(base, 'custom-a')));
    assert.ok(result.locations.includes(path.join(base, 'custom-b')));
    assert.ok(Array.isArray(result.dynamicSubdirsByBase[base]));
    assert.ok(result.dynamicSubdirsByBase[base].includes('custom-a'));
  });
});

test('resolvePermissionLocations is deterministic and idempotent', () => {
  withTempDir((base) => {
    fs.mkdirSync(path.join(base, 'z-folder'));
    fs.mkdirSync(path.join(base, 'a-folder'));

    const first = resolvePermissionLocations({ baseRoots: [base] });
    const second = resolvePermissionLocations({ baseRoots: [base] });

    assert.deepStrictEqual(first, second);
    assert.deepStrictEqual(first.locations, [...first.locations].sort((a, b) => a.localeCompare(b)));
  });
});

console.log(`\n${passed} tests passed`);
if (process.exitCode) {
  console.error('Some tests FAILED');
} else {
  console.log('All tests passed');
}
