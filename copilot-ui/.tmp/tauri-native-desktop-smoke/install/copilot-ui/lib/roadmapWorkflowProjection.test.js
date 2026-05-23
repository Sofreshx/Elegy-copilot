'use strict';

const assert = require('assert');
const {
  buildRoadmapWorkflowProjection,
} = require('./roadmapWorkflowProjection');

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
  await test('projection builds deterministic newest-first history and latest summary per slice', async () => {
    const roadmap = {
      slug: 'platform-foundation',
      items: [{
        id: 'RM-platform-foundation-001',
        status: 'planned',
      }],
    };
    const artifacts = [
      {
        artifactId: 'artifact-b',
        roadmapId: 'RM-platform-foundation',
        sliceId: 'RM-platform-foundation-001',
        kind: 'roadmap.review.result',
        phase: 'review',
        status: 'pass',
        updatedAt: '2026-05-17T12:05:00.000Z',
        createdAt: '2026-05-17T12:00:00.000Z',
        structuredState: {
          requiresUserDecision: false,
        },
      },
      {
        artifactId: 'artifact-a',
        roadmapId: 'RM-platform-foundation',
        sliceId: 'RM-platform-foundation-001',
        kind: 'roadmap.plan.result',
        phase: 'plan',
        status: 'proposed',
        updatedAt: '2026-05-16T12:05:00.000Z',
        createdAt: '2026-05-16T12:00:00.000Z',
        structuredState: {
          requiresUserDecision: true,
        },
      },
    ];

    const projected = buildRoadmapWorkflowProjection(roadmap, artifacts);

    assert.deepStrictEqual(
      projected.items[0].workflowProjection.history.map((entry) => entry.artifactId),
      ['artifact-b', 'artifact-a'],
    );
    assert.strictEqual(projected.items[0].workflowProjection.latest.artifactId, 'artifact-b');
  });

  await test('projection emits explicit desync reasons for status mismatch and pending decision', async () => {
    const roadmap = {
      slug: 'platform-foundation',
      items: [{
        id: 'RM-platform-foundation-001',
        status: 'planned',
      }],
    };
    const artifacts = [{
      artifactId: 'artifact-review',
      roadmapId: 'RM-platform-foundation',
      sliceId: 'RM-platform-foundation-001',
      kind: 'roadmap.review.result',
      phase: 'review',
      status: 'pass',
      updatedAt: '2026-05-17T12:05:00.000Z',
      structuredState: {
        requiresUserDecision: true,
        acceptance: {
          allPassed: true,
          failedChecks: [],
        },
      },
    }];

    const projected = buildRoadmapWorkflowProjection(roadmap, artifacts);

    assert.deepStrictEqual(projected.items[0].desync.reasons, [
      'requires_user_decision_pending',
      'status_mismatch',
    ]);
    assert.strictEqual(projected.workflowProjection.desyncCount, 1);
    assert.strictEqual(projected.workflowProjection.synced, false);
  });

  await test('projection treats completion-result aligned with done roadmap status as synced', async () => {
    const roadmap = {
      slug: 'platform-foundation',
      items: [{
        id: 'RM-platform-foundation-001',
        status: 'done',
      }],
    };
    const artifacts = [{
      artifactId: 'artifact-complete',
      roadmapId: 'RM-platform-foundation',
      sliceId: 'RM-platform-foundation-001',
      kind: 'roadmap.completion.result',
      phase: 'completion',
      status: 'completed',
      updatedAt: '2026-05-17T12:05:00.000Z',
      structuredState: {
        requiresUserDecision: false,
      },
    }];

    const projected = buildRoadmapWorkflowProjection(roadmap, artifacts);

    assert.deepStrictEqual(projected.items[0].desync.reasons, []);
    assert.strictEqual(projected.items[0].desync.workflowStatus, 'done');
    assert.strictEqual(projected.workflowProjection.synced, true);
  });

  await test('projection surfaces unmatched workflow slices explicitly', async () => {
    const roadmap = {
      slug: 'platform-foundation',
      items: [],
    };
    const artifacts = [{
      artifactId: 'artifact-orphan',
      roadmapId: 'RM-platform-foundation',
      sliceId: 'RM-platform-foundation-999',
      kind: 'roadmap.plan.result',
      phase: 'plan',
      status: 'proposed',
      updatedAt: '2026-05-17T12:05:00.000Z',
      structuredState: {
        requiresUserDecision: false,
      },
    }];

    const projected = buildRoadmapWorkflowProjection(roadmap, artifacts);

    assert.strictEqual(projected.workflowProjection.unmatchedWorkflowArtifacts.length, 1);
    assert.strictEqual(projected.workflowProjection.unmatchedWorkflowArtifacts[0].sliceId, 'RM-platform-foundation-999');
    assert.deepStrictEqual(projected.workflowProjection.unmatchedWorkflowArtifacts[0].reasons, ['repo_item_missing_for_slice']);
    assert.strictEqual(projected.workflowProjection.synced, false);
  });

  if (!process.exitCode) {
    console.log(`roadmap workflow projection tests passed: ${passed}`);
  }
}

run();
