#!/usr/bin/env node
'use strict';

const assert = require('assert');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS: ${name}`);
  } catch (error) {
    failed++;
    console.error(`  FAIL: ${name}`);
    console.error(`    ${error.message}`);
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------------
// Inline sortRoadmaps utility matching the explorer contract
// ---------------------------------------------------------------------------

function sortRoadmaps(roadmaps, mode) {
  const items = Array.isArray(roadmaps) ? roadmaps : [];
  const field = mode === 'created' ? 'createdAt' : 'updatedAt';

  return [...items].sort((a, b) => {
    const aDate = a[field] ? new Date(a[field]).getTime() : null;
    const bDate = b[field] ? new Date(b[field]).getTime() : null;

    if (aDate === null && bDate === null) return 0;
    if (aDate === null) return 1;
    if (bDate === null) return -1;

    return bDate - aDate; // descending
  });
}

function makeRoadmap(id, updatedAt, createdAt) {
  return { id, title: `Roadmap ${id}`, updatedAt: updatedAt || null, createdAt: createdAt || null };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('sortRoadmaps sorts by updatedAt descending', () => {
  const older = makeRoadmap('older', '2026-01-01T00:00:00Z');
  const newer = makeRoadmap('newer', '2026-06-01T00:00:00Z');

  const result = sortRoadmaps([older, newer], 'updated');
  assert.strictEqual(result.length, 2);
  assert.strictEqual(result[0].id, 'newer');
  assert.strictEqual(result[1].id, 'older');
});

test('empty input returns empty array', () => {
  const result = sortRoadmaps([], 'updated');
  assert.ok(Array.isArray(result));
  assert.strictEqual(result.length, 0);
});

test('single-element input returns single element', () => {
  const roadmap = makeRoadmap('only-one', '2026-06-01T00:00:00Z');
  const result = sortRoadmaps([roadmap], 'updated');
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].id, 'only-one');
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
