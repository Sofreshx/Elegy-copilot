#!/usr/bin/env node
'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const VALIDATOR_PATH = path.resolve(__dirname, 'validate-specs.js');
const FIXTURES_ROOT = path.resolve(__dirname, 'fixtures', 'validate-specs');

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

function runValidator(args = []) {
  return childProcess.spawnSync(process.execPath, [VALIDATOR_PATH, ...args], {
    encoding: 'utf8',
    stdio: 'pipe',
  });
}

test('passes a valid spec fixture root', () => {
  const fixturePath = path.join(FIXTURES_ROOT, 'positive');
  const result = runValidator(['--require', fixturePath]);

  assert.strictEqual(result.status, 0, `expected success, stderr: ${result.stderr}`);
  assert.match(result.stdout, /specs ok \(1 specs\)/i);
  assert.strictEqual(result.stderr.trim(), '');
});

test('fails invalid frontmatter and missing required headings', () => {
  const fixturePath = path.join(FIXTURES_ROOT, 'negative-frontmatter');
  const result = runValidator(['--require', fixturePath]);

  assert.notStrictEqual(result.status, 0, 'expected validator to fail');
  assert.match(result.stderr, /missing required frontmatter key 'type'/i);
  assert.match(result.stderr, /invalid status 'active'/i);
  assert.match(result.stderr, /missing required heading '## Non-Goals'/i);
});

test('fails when Acceptance Checks has fewer than two bullets', () => {
  const fixturePath = path.join(FIXTURES_ROOT, 'negative-acceptance-count');
  const result = runValidator(['--require', fixturePath]);

  assert.notStrictEqual(result.status, 0, 'expected validator to fail');
  assert.match(result.stderr, /Acceptance Checks must include at least 2 bullet items \(found 1\)/i);
});

test('fails when implemented specs have no validation evidence', () => {
  const fixturePath = path.join(FIXTURES_ROOT, 'negative-implemented-no-validation');
  const result = runValidator(['--require', fixturePath]);

  assert.notStrictEqual(result.status, 0, 'expected validator to fail');
  assert.match(result.stderr, /Validation Evidence must be non-empty when status is implemented/i);
});

test('missing spec root exits zero without --require', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-validate-specs-missing-'));
  try {
    const missingPath = path.join(tempRoot, 'missing-specs-root');
    const result = runValidator([missingPath]);

    assert.strictEqual(result.status, 0, `expected success, stderr: ${result.stderr}`);
    assert.match(result.stdout, /specs ok \(no specs directory at /i);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('missing spec root fails with --require', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-validate-specs-required-'));
  try {
    const missingPath = path.join(tempRoot, 'missing-specs-root');
    const result = runValidator(['--require', missingPath]);

    assert.notStrictEqual(result.status, 0, 'expected validator to fail');
    assert.match(result.stderr, /spec root not found:/i);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

console.log(`\n${passed} tests passed`);
if (process.exitCode) {
  console.error('Some tests FAILED');
} else {
  console.log('All tests passed');
}
