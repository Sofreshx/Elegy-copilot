'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  PLANNING_INTAKE_ARTIFACT_KIND,
  PLANNING_INTAKE_ARTIFACT_SCHEMA_VERSION,
  PLANNING_INTAKE_CATEGORIES,
  resolvePlanningIntakeDirectoryPath,
  createPlanningIntakeArtifact,
  updatePlanningIntakeArtifact,
  listPlanningIntakeArtifacts,
  parsePlanningIntakeArtifactDocument,
  serializePlanningIntakeArtifact,
} = require('./planningIntakeArtifacts');

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

function withTempRepo(fn) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'planning-intake-artifacts-'));
  try {
    fs.mkdirSync(path.join(repoRoot, '.git'), { recursive: true });
    return fn(repoRoot);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
}

test('serializePlanningIntakeArtifact round-trips canonical planning intake JSON', () => {
  const serialized = serializePlanningIntakeArtifact({
    id: 'PI-001',
    category: 'idea',
    title: 'Capture planning intake',
    summary: 'Persist unscheduled tracked work items.',
    acceptanceCriteria: ['Write deterministic json', 'Expose route helpers'],
    targetRepoIds: ['repo-b', 'repo-a'],
    planningState: 'thought',
    createdAt: '2026-03-18T00:00:00.000Z',
    updatedAt: '2026-03-18T00:05:00.000Z',
  });

  const parsed = parsePlanningIntakeArtifactDocument(serialized);
  assert.deepEqual(parsed, {
    kind: PLANNING_INTAKE_ARTIFACT_KIND,
    schemaVersion: PLANNING_INTAKE_ARTIFACT_SCHEMA_VERSION,
    id: 'PI-001',
    category: 'idea',
    title: 'Capture planning intake',
    summary: 'Persist unscheduled tracked work items.',
    acceptanceCriteria: ['Write deterministic json', 'Expose route helpers'],
    targetRepoIds: ['repo-a', 'repo-b'],
    planningState: 'thought',
    createdAt: '2026-03-18T00:00:00.000Z',
    updatedAt: '2026-03-18T00:05:00.000Z',
  });
});

test('createPlanningIntakeArtifact stores deterministic files under docs/planning/intake', () => {
  withTempRepo((repoRoot) => {
    const created = createPlanningIntakeArtifact(repoRoot, {
      category: 'review-prep',
      title: 'Draft intake artifact',
      summary: 'Typed planning intake foundation.',
      acceptanceCriteria: ['Add helper library'],
      targetRepoIds: ['repo-2', 'repo-1'],
      planningState: 'research',
      createdAt: '2026-03-18T01:00:00.000Z',
      updatedAt: '2026-03-18T01:00:00.000Z',
    });

    assert.equal(created.id, 'PI-001');
    assert.equal(created.category, 'review-prep');
    assert.equal(
      created.filePath,
      path.join(repoRoot, 'docs', 'planning', 'intake', 'PI-001.json'),
    );
    assert.equal(created.repoRelativePath, 'docs/planning/intake/PI-001.json');

    const persisted = fs.readFileSync(created.filePath, 'utf8');
    assert.match(persisted, /"kind": "planning.intake.artifact"/);
    assert.match(persisted, /"targetRepoIds": \[/);
  });
});

test('listPlanningIntakeArtifacts returns canonical empty and populated states', () => {
  withTempRepo((repoRoot) => {
    const empty = listPlanningIntakeArtifacts(repoRoot);
    assert.equal(empty.exists, false);
    assert.equal(empty.artifactCount, 0);
    assert.deepEqual(empty.supportedCategories, PLANNING_INTAKE_CATEGORIES);

    createPlanningIntakeArtifact(repoRoot, {
      category: 'idea',
      title: 'First artifact',
      summary: 'Persist first item.',
    });
    createPlanningIntakeArtifact(repoRoot, {
      category: 'audit-request',
      title: 'Second artifact',
      summary: 'Persist second item.',
    });

    const listed = listPlanningIntakeArtifacts(repoRoot);
    assert.equal(listed.exists, true);
    assert.equal(listed.artifactCount, 2);
    assert.deepEqual(listed.artifacts.map((entry) => entry.id), ['PI-001', 'PI-002']);
    assert.equal(listed.artifacts[1].category, 'audit-request');
  });
});

test('updatePlanningIntakeArtifact preserves stable id and createdAt while updating fields', () => {
  withTempRepo((repoRoot) => {
    const created = createPlanningIntakeArtifact(repoRoot, {
      category: 'idea',
      title: 'Initial title',
      summary: 'Initial summary',
      createdAt: '2026-03-18T02:00:00.000Z',
      updatedAt: '2026-03-18T02:00:00.000Z',
    });

    const updated = updatePlanningIntakeArtifact(repoRoot, created.id, {
      title: 'Updated title',
      category: 'research',
      acceptanceCriteria: ['One', 'Two'],
      targetRepoIds: ['repo-z'],
    }, {
      now: '2026-03-18T02:30:00.000Z',
    });

    assert.equal(updated.id, 'PI-001');
    assert.equal(updated.createdAt, '2026-03-18T02:00:00.000Z');
    assert.equal(updated.updatedAt, '2026-03-18T02:30:00.000Z');
    assert.equal(updated.category, 'research');
    assert.deepEqual(updated.acceptanceCriteria, ['One', 'Two']);
    assert.deepEqual(updated.targetRepoIds, ['repo-z']);
  });
});

console.log(`\n${passed} tests passed`);
if (process.exitCode) {
  console.error('Some tests FAILED');
} else {
  console.log('All tests passed');
}
