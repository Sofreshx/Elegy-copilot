'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');

const { createRoadmapWorkflowPlanningBridge } = require('./roadmapWorkflowPlanningBridge');

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

function buildMachineEnvelope(data, overrides = {}) {
  return JSON.stringify({
    status: 'ok',
    data,
    ...overrides,
  });
}

function createExecFileStub(handler) {
  return {
    execFile(command, args, options, callback) {
      handler({ command, args, options, callback });
    },
  };
}

async function run() {
  await test('roadmap workflow planning bridge seeds goal roadmap and work point through elegy-planning json commands', async () => {
    const recorded = [];
    const bridge = createRoadmapWorkflowPlanningBridge({
      enabled: true,
      copilotHome: path.join('C:', 'copilot'),
      dbPath: path.join('C:', 'planning', 'elegy-planning.db'),
      cliPath: __filename,
      childProcess: createExecFileStub(({ command, args, options, callback }) => {
        recorded.push({ command, args, options });
        const commandKey = args.slice(6, 8).join(' ');
        if (commandKey === 'roadmap show' && recorded.length === 1) {
          callback(null, JSON.stringify({ status: 'invalid', error: 'entity not found: roadmap RM-core' }), '');
          return;
        }
        if (commandKey === 'roadmap show' && recorded.length === 6) {
          callback(null, buildMachineEnvelope({
            roadmap: {
              id: 'RM-core',
              goalId: 'ie-goal-RM-core',
            },
            workPoints: [{ id: 'RM-core-001' }],
            validation: {
              status: 'valid',
            },
          }), '');
          return;
        }
        if (commandKey === 'goal show') {
          callback(null, JSON.stringify({ status: 'invalid', error: 'entity not found: goal ie-goal-RM-core' }), '');
          return;
        }
        if (commandKey === 'goal create') {
          callback(null, buildMachineEnvelope({
            record: {
              id: 'ie-goal-RM-core',
            },
            validation: {
              status: 'warning',
            },
          }), '');
          return;
        }
        if (commandKey === 'roadmap create') {
          callback(null, buildMachineEnvelope({
            record: {
              id: 'RM-core',
              goalId: 'ie-goal-RM-core',
            },
            validation: {
              status: 'warning',
            },
          }), '');
          return;
        }
        if (commandKey === 'roadmap add-work-point') {
          callback(null, buildMachineEnvelope({
            record: {
              id: 'RM-core-001',
            },
            validation: {
              status: 'valid',
            },
          }), '');
          return;
        }
        callback(null, buildMachineEnvelope({
          roadmap: {
            id: 'RM-core',
            goalId: 'ie-goal-RM-core',
          },
          workPoints: [{ id: 'RM-core-001' }],
          validation: {
            status: 'valid',
          },
        }), '');
      }),
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
      structuredState: {
        roadmapId: 'RM-core',
        sliceId: 'RM-core-001',
        kind: 'roadmap.review.result',
        phase: 'review',
        status: 'pass',
        followUps: [],
        requiresUserDecision: false,
        acceptance: {
          allPassed: true,
          failedChecks: [],
          passedChecks: ['node copilot-ui/routes/planning.test.js'],
        },
      },
    }, {
      requestId: 'req-123',
    });

    assert.deepEqual(result, {
      status: 'synced',
      attempted: 3,
      synced: 3,
      validationStatus: 'valid',
      entities: {
        goalId: 'ie-goal-RM-core',
        roadmapId: 'RM-core',
        workPointId: 'RM-core-001',
      },
      operations: [
        {
          entityType: 'goal',
          entityId: 'ie-goal-RM-core',
          action: 'created',
          validationStatus: 'warning',
        },
        {
          entityType: 'roadmap',
          entityId: 'RM-core',
          action: 'created',
          validationStatus: 'warning',
        },
        {
          entityType: 'work-point',
          entityId: 'RM-core-001',
          action: 'created',
          validationStatus: 'valid',
        },
      ],
    });
    assert.equal(recorded.length, 6);
    assert.equal(recorded[0].command, __filename);
    assert.deepEqual(recorded[0].args.slice(0, 6), [
      '--json',
      '--non-interactive',
      '--correlation-id',
      'req-123',
      '--db',
      path.join('C:', 'planning', 'elegy-planning.db'),
    ]);
    assert.deepEqual(recorded.map((entry) => entry.args.slice(6, 8).join(' ')), [
      'roadmap show',
      'goal show',
      'goal create',
      'roadmap create',
      'roadmap add-work-point',
      'roadmap show',
    ]);
    assert.match(recorded[2].args.join(' '), /--id ie-goal-RM-core/);
    assert.match(recorded[3].args.join(' '), /--goal-id ie-goal-RM-core/);
    assert.match(recorded[4].args.join(' '), /--validation node copilot-ui\/routes\/planning.test.js/);
  });

  await test('roadmap workflow planning bridge verifies existing roadmap instead of seeding duplicate goal', async () => {
    const recorded = [];
    const bridge = createRoadmapWorkflowPlanningBridge({
      enabled: true,
      copilotHome: path.join('C:', 'copilot'),
      dbPath: path.join('C:', 'planning', 'elegy-planning.db'),
      cliPath: __filename,
      childProcess: createExecFileStub(({ command, args, callback }) => {
        recorded.push({ command, args });
        callback(null, buildMachineEnvelope({
          roadmap: {
            id: 'RM-core',
            goalId: 'goal-existing',
          },
          workPoints: [{ id: 'RM-core-001' }],
          validation: {
            status: 'warning',
          },
        }), '');
      }),
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
      kind: 'roadmap.review.result',
      phase: 'review',
      status: 'pass',
      structuredState: {
        roadmapId: 'RM-core',
        sliceId: 'RM-core-001',
        kind: 'roadmap.review.result',
        phase: 'review',
        status: 'pass',
        followUps: [],
        requiresUserDecision: false,
      },
    }, {
      requestId: 'req-existing',
    });

    assert.deepEqual(result, {
      status: 'synced',
      attempted: 2,
      synced: 2,
      validationStatus: 'warning',
      entities: {
        goalId: 'goal-existing',
        roadmapId: 'RM-core',
        workPointId: 'RM-core-001',
      },
      operations: [
        {
          entityType: 'roadmap',
          entityId: 'RM-core',
          action: 'verified',
          validationStatus: 'warning',
        },
        {
          entityType: 'work-point',
          entityId: 'RM-core-001',
          action: 'verified',
          validationStatus: null,
        },
      ],
    });
    assert.equal(recorded.length, 2);
    assert.deepEqual(recorded.map((entry) => entry.args.slice(6, 8).join(' ')), [
      'roadmap show',
      'roadmap show',
    ]);
  });

  await test('roadmap workflow planning bridge fails open when elegy-planning returns invalid json', async () => {
    const bridge = createRoadmapWorkflowPlanningBridge({
      enabled: true,
      copilotHome: path.join('C:', 'copilot'),
      dbPath: path.join('C:', 'planning', 'elegy-planning.db'),
      cliPath: __filename,
      childProcess: createExecFileStub(({ callback }) => {
        callback(null, 'not-json', '');
      }),
      env: {},
      processObject: {
        env: {},
        platform: 'win32',
      },
    });

    const result = await bridge.persistArtifact({
      artifactId: 'wf-artifact-003',
      roadmapId: 'RM-core',
      kind: 'roadmap.review.result',
      phase: 'review',
      status: 'pass',
      structuredState: {
        roadmapId: 'RM-core',
        kind: 'roadmap.review.result',
        phase: 'review',
        status: 'pass',
        followUps: [],
        requiresUserDecision: false,
      },
    }, {
      requestId: 'req-invalid-json',
    });

    assert.equal(result.status, 'failed_open');
    assert.equal(result.attempted, 1);
    assert.equal(result.synced, 0);
    assert.deepEqual(result.entities, {
      goalId: 'ie-goal-RM-core',
      roadmapId: 'RM-core',
    });
    assert.deepEqual(result.operations, []);
    assert.deepEqual(result.errors, [{
      code: 'elegy_planning_invalid_json',
      message: 'Elegy planning command returned invalid JSON output.',
    }]);
  });

  await test('roadmap workflow planning bridge fails closed when authority is not configured', async () => {
    const bridge = createRoadmapWorkflowPlanningBridge({
      env: {},
      processObject: {
        env: {},
        platform: 'win32',
      },
    });

    const result = await bridge.persistArtifact({
      artifactId: 'wf-artifact-004',
      roadmapId: 'RM-core',
      kind: 'roadmap.review.result',
      phase: 'review',
      status: 'pass',
      structuredState: {
        roadmapId: 'RM-core',
        kind: 'roadmap.review.result',
        phase: 'review',
        status: 'pass',
        followUps: [],
        requiresUserDecision: false,
      },
    });

    assert.deepEqual(result, {
      status: 'failed_closed',
      attempted: 0,
      synced: 0,
      reason: 'bridge_not_configured',
      errors: [{
        code: 'bridge_not_configured',
        message: 'elegy-planning authority is not configured for workflow artifact persistence.',
      }],
    });
  });

  if (!process.exitCode) {
    console.log(`roadmap workflow planning bridge tests passed: ${passed}`);
  }
}

run();
