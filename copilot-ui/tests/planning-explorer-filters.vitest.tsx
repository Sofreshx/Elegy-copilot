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
// Inline filter helpers matching the explorer FilterBar logic
// ---------------------------------------------------------------------------

function filterByEntityType(entities, entityType) {
  if (!entityType || entityType === 'all') return entities;
  return (Array.isArray(entities) ? entities : []).filter((e) => e.entityType === entityType);
}

function filterByTag(entities, tag) {
  if (!tag) return entities;
  const lowerTag = tag.toLowerCase();
  return (Array.isArray(entities) ? entities : []).filter((e) =>
    Array.isArray(e.tags) && e.tags.some((t) => t.toLowerCase() === lowerTag),
  );
}

function filterByCombined(entities, filters) {
  const opts = filters || {};
  let result = Array.isArray(entities) ? entities : [];
  if (opts.entityType && opts.entityType !== 'all') {
    result = result.filter((e) => e.entityType === opts.entityType);
  }
  if (opts.tag) {
    const lowerTag = opts.tag.toLowerCase();
    result = result.filter((e) =>
      Array.isArray(e.tags) && e.tags.some((t) => t.toLowerCase() === lowerTag),
    );
  }
  return result;
}

function makeEntity(id, entityType, tags) {
  return { id, entityType: entityType || 'roadmap', tags: tags || [] };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('entity type filter narrows results', () => {
  const entities = [
    makeEntity('g1', 'goal', ['repo:test']),
    makeEntity('rm1', 'roadmap', ['repo:test']),
    makeEntity('rm2', 'roadmap', ['repo:test']),
    makeEntity('p1', 'plan', ['repo:test']),
  ];

  const filtered = filterByEntityType(entities, 'roadmap');
  assert.strictEqual(filtered.length, 2);
  assert.strictEqual(filtered[0].id, 'rm1');
  assert.strictEqual(filtered[1].id, 'rm2');
});

test('tag filter narrows results', () => {
  const entities = [
    makeEntity('e1', 'roadmap', ['repo:74af0f7b5cc4']),
    makeEntity('e2', 'roadmap', ['repo:instruction-engine']),
    makeEntity('e3', 'roadmap', ['repo:elegy']),
  ];

  const filtered = filterByTag(entities, 'repo:instruction-engine');
  assert.strictEqual(filtered.length, 1);
  assert.strictEqual(filtered[0].id, 'e2');
});

test('combined filters (entity type + tag) work together', () => {
  const entities = [
    makeEntity('g1', 'goal', ['repo:test', 'phase:1']),
    makeEntity('rm1', 'roadmap', ['repo:test', 'phase:1']),
    makeEntity('rm2', 'roadmap', ['repo:test', 'phase:2']),
    makeEntity('p1', 'plan', ['repo:test', 'phase:1']),
  ];

  const filtered = filterByCombined(entities, { entityType: 'roadmap', tag: 'phase:1' });
  assert.strictEqual(filtered.length, 1);
  assert.strictEqual(filtered[0].id, 'rm1');
});

test('empty filter returns all entities', () => {
  const entities = [
    makeEntity('g1', 'goal', ['repo:test']),
    makeEntity('rm1', 'roadmap', ['repo:test']),
    makeEntity('p1', 'plan', ['repo:test']),
  ];

  const filtered = filterByCombined(entities, {});
  assert.strictEqual(filtered.length, 3);

  const filtered2 = filterByCombined(entities, { entityType: 'all' });
  assert.strictEqual(filtered2.length, 3);
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
