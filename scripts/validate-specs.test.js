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

function createTempFixture(content, extraFiles) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-validate-specs-fixture-'));
  const specDir = path.join(tempRoot, 'temp-test-spec');
  fs.mkdirSync(specDir, { recursive: true });
  fs.writeFileSync(path.join(specDir, 'spec.md'), content, 'utf8');
  if (extraFiles) {
    for (const [relPath, fileContent] of Object.entries(extraFiles)) {
      const fullPath = path.join(tempRoot, relPath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, fileContent, 'utf8');
    }
  }
  return { root: tempRoot, specDir };
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

test('fails when both supersedes and superseded_by are set', () => {
  const fixturePath = path.join(FIXTURES_ROOT, 'negative-supersedes-both');
  const result = runValidator(['--require', fixturePath]);

  assert.notStrictEqual(result.status, 0, 'expected validator to fail');
  assert.match(result.stderr, /both 'supersedes' and 'superseded_by' are set/i);
});

test('fails when status is superseded without superseded_by', () => {
  const fixturePath = path.join(FIXTURES_ROOT, 'negative-superseded-no-target');
  const result = runValidator(['--require', fixturePath]);

  assert.notStrictEqual(result.status, 0, 'expected validator to fail');
  assert.match(result.stderr, /superseded.*superseded_by/i);
});

test('fails for invalid date format in optional date key', () => {
  const fixturePath = path.join(FIXTURES_ROOT, 'negative-invalid-date');
  const result = runValidator(['--require', fixturePath]);

  assert.notStrictEqual(result.status, 0, 'expected validator to fail');
  assert.match(result.stderr, /invalid 'created'/i);
});

test('--json outputs valid JSON with spec count', () => {
  const fixturePath = path.join(FIXTURES_ROOT, 'positive');
  const result = runValidator(['--require', '--json', fixturePath]);

  assert.strictEqual(result.status, 0, `expected success, stderr: ${result.stderr}`);
  const parsed = JSON.parse(result.stdout.trim());
  assert.strictEqual(parsed.targetPath, path.resolve(fixturePath));
  assert.strictEqual(parsed.specFiles.length, 1);
  assert.strictEqual(parsed.errors.length, 0);
});

test('--strict reports missing context evidence paths', () => {
  const specBody = `---
spec_id: test-strict-liveness
title: Test Strict Liveness
status: draft
type: feature
updated: 2026-06-04
---

# Test Strict Liveness

## Intent

Test strict mode liveness detection.

## Context Evidence

- \`nonexistent-dir/missing-file.js\`: does not exist

## Requirements

- Test requirement.

## Non-Goals

- Test non-goal.

## Acceptance Checks

- Test check one.
  → verify: node scripts/validate-specs.js
- Test check two.
  → verify: node scripts/validate-specs.js

## Implementation Links

- \`nonexistent-dir/missing-file.js\`

## Validation Evidence

- Pending.

## Drift Notes

- None.
`;

  const { root } = createTempFixture(specBody);
  try {
    const result = runValidator(['--strict', root]);

    assert.notStrictEqual(result.status, 0, 'expected validator to fail in strict mode');
    assert.match(result.stderr, /Context Evidence: referenced path 'nonexistent-dir\/missing-file.js' not found/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('--strict passes when all referenced paths exist', () => {
  // Create a fixture with a Context Evidence path that actually exists
  const specBody = `---
spec_id: test-strict-pass
title: Test Strict Pass
status: draft
type: feature
updated: 2026-06-04
---

# Test Strict Pass

## Intent

Test strict mode passes with valid paths.

## Context Evidence

- \`scripts/validate-specs.js\`: this file exists

## Requirements

- Test requirement.

## Non-Goals

- Test non-goal.

## Acceptance Checks

- Test check one.
  → verify: node scripts/validate-specs.js
- Test check two.
  → verify: node scripts/validate-specs.js

## Implementation Links

- \`scripts/validate-specs.js\`

## Validation Evidence

- Pending.

## Drift Notes

- None.
`;

  const { root } = createTempFixture(specBody);
  try {
    const result = runValidator(['--strict', root]);

    assert.strictEqual(result.status, 0, `expected success, stderr: ${result.stderr}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

console.log(`\n${passed} tests passed`);
if (process.exitCode) {
  console.error('Some tests FAILED');
} else {
  console.log('All tests passed');
}
