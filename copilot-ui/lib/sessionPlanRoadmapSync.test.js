'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  createRepositoryBacklogItem,
  readRepositoryBacklogFile,
  updateRepositoryBacklogFile,
} = require('./repositoryBacklogFile');
const {
  readRoadmapDocument,
  writeRoadmapDocument,
} = require('./roadmapArtifacts');
const {
  PLAN_SYNC_MARKER_NAMES,
  parsePlanSyncMarkers,
  syncSessionPlanToRoadmap,
} = require('./sessionPlanRoadmapSync');

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
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'session-plan-roadmap-sync-'));
  try {
    fs.mkdirSync(path.join(repoRoot, '.git'), { recursive: true });
    return fn(repoRoot);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
}

test('parsePlanSyncMarkers reads explicit sync markers deterministically', () => {
  const markers = parsePlanSyncMarkers([
    `<!-- ${PLAN_SYNC_MARKER_NAMES.linkedBacklogIds}: RB-002, RB-001 -->`,
    `<!-- ${PLAN_SYNC_MARKER_NAMES.linkedRoadmapIds}: RM-platform-foundation-002, RM-platform-foundation-001 -->`,
    `<!-- ${PLAN_SYNC_MARKER_NAMES.planRef}: session:20260316_010203_ABCD -->`,
    `<!-- ${PLAN_SYNC_MARKER_NAMES.outcome}: completed -->`,
  ].join('\n'));

  assert.deepStrictEqual(markers, {
    linkedBacklogIds: ['RB-001', 'RB-002'],
    linkedRoadmapIds: ['RM-platform-foundation-001', 'RM-platform-foundation-002'],
    planRef: 'session:20260316_010203_ABCD',
    outcome: 'completed',
  });
});

test('syncSessionPlanToRoadmap reconciles linked roadmap and backlog items from plan markers', () => {
  withTempRepo((repoRoot) => {
    updateRepositoryBacklogFile(repoRoot, (backlog) =>
      createRepositoryBacklogItem(backlog, {
        title: 'Simplify planning intake',
        status: 'planned',
        summary: 'Move planning intake to repo-backed backlog files.',
        keyPoints: [{ date: '2026-03-16', text: 'Seeded from roadmap sync test.' }],
      }),
    );

    const roadmap = writeRoadmapDocument(repoRoot, {
      slug: 'platform-foundation',
      title: 'Platform Foundation',
      overview: 'Sequence the planning workflow changes.',
      items: [
        {
          title: 'Ship repo-backed backlog sync',
          phase: 'foundation',
          status: 'planned',
          summary: 'Link plan completion to roadmap and backlog state.',
          backlogIds: ['RB-001'],
        },
      ],
    });

    const roadmapId = roadmap.items[0].id;
    const planText = [
      `<!-- ${PLAN_SYNC_MARKER_NAMES.linkedBacklogIds}: RB-001 -->`,
      `<!-- ${PLAN_SYNC_MARKER_NAMES.linkedRoadmapIds}: ${roadmapId} -->`,
      `<!-- ${PLAN_SYNC_MARKER_NAMES.planRef}: session:20260316_020304_ABCD -->`,
      `<!-- ${PLAN_SYNC_MARKER_NAMES.outcome}: completed -->`,
      '',
      '# Plan Pack — Repo-backed backlog sync',
    ].join('\n');

    const result = syncSessionPlanToRoadmap(repoRoot, 'session-sync-1', planText);

    assert.strictEqual(result.deterministic, true);
    assert.strictEqual(result.planRef, 'session:20260316_020304_ABCD');
    assert.strictEqual(result.outcome, 'completed');
    assert.deepStrictEqual(result.linkedBacklogIds, ['RB-001']);
    assert.deepStrictEqual(result.linkedRoadmapIds, [roadmapId]);

    const backlogItem = readRepositoryBacklogFile(repoRoot).backlog.items[0];
    assert.strictEqual(backlogItem.status, 'satisfied');
    assert.strictEqual(backlogItem.satisfiedByPlanRef, 'session:20260316_020304_ABCD');
    assert.deepStrictEqual(backlogItem.roadmapIds, [roadmapId]);
    assert.deepStrictEqual(backlogItem.planRefs, ['session:20260316_020304_ABCD']);

    const syncedRoadmapItem = readRoadmapDocument(repoRoot, 'platform-foundation').items[0];
    assert.strictEqual(syncedRoadmapItem.status, 'done');
    assert.strictEqual(syncedRoadmapItem.satisfiedByPlanRef, 'session:20260316_020304_ABCD');
    assert.deepStrictEqual(syncedRoadmapItem.planRefs, ['session:20260316_020304_ABCD']);
  });
});

if (!process.exitCode) {
  console.log(`session plan roadmap sync tests passed (${passed})`);
}
