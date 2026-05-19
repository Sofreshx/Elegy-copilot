'use strict';

const assert = require('node:assert/strict');

const {
  resolveRetiredRepoFilePlanningSurface,
} = require('./server');

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

async function run() {
  console.log('\nRetired Planning Route Tests\n');

  await test('resolveRetiredRepoFilePlanningSurface identifies retired file-backed planning endpoints', async () => {
    assert.deepEqual(
      resolveRetiredRepoFilePlanningSurface('/api/planning/roadmaps', 'GET'),
      { kind: 'planning.roadmaps.list', surfaceLabel: 'planning roadmaps' },
    );
    assert.deepEqual(
      resolveRetiredRepoFilePlanningSurface('/api/planning/roadmaps/platform-foundation', 'GET'),
      { kind: 'planning.roadmaps.read', surfaceLabel: 'planning roadmaps' },
    );
    assert.deepEqual(
      resolveRetiredRepoFilePlanningSurface('/api/planning/roadmaps/platform-foundation/reconcile', 'POST'),
      { kind: 'planning.roadmaps.reconcile', surfaceLabel: 'planning roadmaps' },
    );
    assert.deepEqual(
      resolveRetiredRepoFilePlanningSurface('/api/planning/backlog', 'GET'),
      { kind: 'planning.backlog.read', surfaceLabel: 'planning backlog' },
    );
    assert.deepEqual(
      resolveRetiredRepoFilePlanningSurface('/api/planning/artifacts/bullets', 'POST'),
      { kind: 'planning.artifacts.create', surfaceLabel: 'planning artifacts' },
    );
    assert.equal(resolveRetiredRepoFilePlanningSurface('/api/planning/workflow-artifacts', 'POST'), null);
    assert.equal(resolveRetiredRepoFilePlanningSurface('/api/health', 'GET'), null);
  });

  if (!process.exitCode) {
    console.log(`Retired planning route tests passed: ${passed}`);
  }
}

run();
