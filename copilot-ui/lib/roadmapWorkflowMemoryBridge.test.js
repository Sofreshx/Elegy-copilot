'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');

const { createRoadmapWorkflowMemoryBridge } = require('./roadmapWorkflowMemoryBridge');

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
  await test('roadmap workflow memory bridge writes fallback artifact memories through elegy-memory json add', async () => {
    const recorded = [];
    const bridge = createRoadmapWorkflowMemoryBridge({
      copilotHome: path.join('C:', 'copilot'),
      childProcess: {
        execFile(command, args, options, callback) {
          recorded.push({ command, args, options });
          callback(null, JSON.stringify({
            command: 'add',
            data: {
              memory: {
                id: 'memory-1',
              },
            },
          }), '');
        },
      },
      env: {},
      processObject: {
        env: {},
        platform: 'win32',
      },
    });

    const result = await bridge.persistArtifact({
      artifactId: 'wf-artifact-001',
      repoId: 'instruction-engine',
      roadmapId: 'RM-core',
      sliceId: 'RM-core-001',
      kind: 'roadmap.review.result',
      phase: 'review',
      status: 'pass',
      sessionId: 'session-1',
      updatedAt: '2026-05-17T12:00:00.000Z',
      structuredState: {
        followUps: ['Ship the review status to the UI'],
        requiresUserDecision: false,
        suggestedNextAction: 'plan-next-slice',
      },
    });

    assert.deepEqual(result, {
      status: 'synced',
      attempted: 1,
      synced: 1,
      memoryIds: ['memory-1'],
    });
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0].command, 'elegy-memory');
    assert.deepEqual(recorded[0].args.slice(0, 3), ['--format', 'json', 'add']);
    assert.equal(recorded[0].args[4], '--db');
    assert.equal(recorded[0].args[5], path.join('C:', 'copilot', 'elegy-memory.db'));
    assert.equal(recorded[0].args[6], '--scope');
    assert.equal(recorded[0].args[7], 'workspace');
    assert.equal(recorded[0].args[8], '--type');
    assert.equal(recorded[0].args[9], 'observation');
    assert.equal(recorded[0].args[10], '--importance');
    assert.equal(recorded[0].args[11], '0.75');
    assert.equal(recorded[0].args[12], '--provenance');
    assert.equal(recorded[0].args[13], 'imported');
    assert.match(recorded[0].args[3], /roadmapId: RM-core/);
    assert.match(recorded[0].args[3], /Summary: roadmap.review.result for RM-core \/ RM-core-001 is pass in review\./);
    assert.match(recorded[0].args[3], /Next action: plan-next-slice/);
    assert.match(recorded[0].args[3], /- Ship the review status to the UI/);
  });

  await test('roadmap workflow memory bridge fails open when elegy-memory is unavailable', async () => {
    const bridge = createRoadmapWorkflowMemoryBridge({
      copilotHome: path.join('C:', 'copilot'),
      childProcess: {
        execFile(command, args, options, callback) {
          const error = new Error('spawn elegy-memory ENOENT');
          error.code = 'ENOENT';
          callback(error, '', '');
        },
      },
      env: {},
      processObject: {
        env: {},
        platform: 'win32',
      },
    });

    const result = await bridge.persistArtifact({
      artifactId: 'wf-artifact-002',
      roadmapId: 'RM-core',
      sliceId: 'RM-core-001',
      kind: 'roadmap.plan.result',
      phase: 'plan',
      status: 'proposed',
      structuredState: {
        followUps: [],
        requiresUserDecision: true,
      },
    });

    assert.equal(result.status, 'failed_open');
    assert.equal(result.attempted, 1);
    assert.equal(result.synced, 0);
    assert.deepEqual(result.memoryIds, []);
    assert.deepEqual(result.errors, [{
      code: 'ENOENT',
      message: 'spawn elegy-memory ENOENT',
    }]);
  });

  if (!process.exitCode) {
    console.log(`roadmap workflow memory bridge tests passed: ${passed}`);
  }
}

run();
