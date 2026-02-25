#!/usr/bin/env node

const assert = require('assert');
const path = require('path');

const { buildPolicyCacheKey } = require('./cache');
const { createPolicyScanner } = require('./scanner');

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

test('cache key includes path + mtime + size + policyVersion + runtimeMode', () => {
  const base = {
    filePath: '/tmp/policy.json',
    mtimeMs: 1000,
    size: 128,
    policyVersion: '1.0.0',
    runtimeMode: 'repo',
  };

  const original = buildPolicyCacheKey(base);
  const changedMtime = buildPolicyCacheKey({ ...base, mtimeMs: 1001 });
  const changedSize = buildPolicyCacheKey({ ...base, size: 129 });
  const changedPolicyVersion = buildPolicyCacheKey({ ...base, policyVersion: '1.0.1' });
  const changedRuntimeMode = buildPolicyCacheKey({ ...base, runtimeMode: 'packaged' });

  assert.notStrictEqual(changedMtime, original);
  assert.notStrictEqual(changedSize, original);
  assert.notStrictEqual(changedPolicyVersion, original);
  assert.notStrictEqual(changedRuntimeMode, original);
});

test('scanner cache invalidates when one key field changes', () => {
  const scanPath = path.resolve('/tmp/a.json');
  const contentByPath = new Map([
    [scanPath, '{"ok":true}'],
  ]);

  let statState = {
    mtimeMs: 1000,
    size: 11,
  };

  const scanner = createPolicyScanner({
    policyVersion: '1.0.0',
    runtimeMode: 'repo',
    readText: (filePath) => {
      const txt = contentByPath.get(filePath);
      if (typeof txt !== 'string') throw new Error('missing content');
      return txt;
    },
    statFile: () => ({ ...statState }),
  });

  const first = scanner.scanFile(scanPath);
  const second = scanner.scanFile(scanPath);
  assert.strictEqual(first.fromCache, false);
  assert.strictEqual(second.fromCache, true);

  statState = { ...statState, mtimeMs: 1001 };
  const third = scanner.scanFile(scanPath);
  assert.strictEqual(third.fromCache, false);
});

console.log(`\n${passed} tests passed`);
if (process.exitCode) {
  console.error('Some tests FAILED');
} else {
  console.log('All tests passed');
}
