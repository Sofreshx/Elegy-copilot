'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');

const { createRoadmapWorkflowPlanningBridge, resolvePlanningDbPath } = require('./roadmapWorkflowPlanningBridge');

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

function getCommandKey(args) {
  // args layout: [--json, --non-interactive, --correlation-id, <requestId>, --db, <dbPath>, (--scope, <scope>), <command>, <subcommand>, ...]
  // The command starts at index 6 normally, or index 8 when --scope is present
  let i = 6;
  if (args[i] === '--scope') {
    i += 2; // skip --scope and its value
  }
  return args.slice(i, i + 2).join(' ');
}

async function run() {
  await test('roadmap workflow planning bridge seeds goal roadmap and work point through elegy-planning json commands', async () => {
    const recorded = [];
    const explicitDbPath = path.join('C:', 'planning', 'elegy-planning.db');
    const bridge = createRoadmapWorkflowPlanningBridge({
      enabled: true,
      elegyHome: path.join('C:', 'copilot'),
      dbPath: explicitDbPath,
      cliPath: __filename,
      fsModule: {
        existsSync(p) { return p === explicitDbPath; },
        statSync(p) { return { size: 4096 }; },
      },
      childProcess: createExecFileStub(({ command, args, options, callback }) => {
        recorded.push({ command, args, options });
        const commandKey = getCommandKey(args);
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
    assert.deepEqual(recorded.map((entry) => getCommandKey(entry.args)), [
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
    const explicitDbPath = path.join('C:', 'planning', 'elegy-planning.db');
    const bridge = createRoadmapWorkflowPlanningBridge({
      enabled: true,
      elegyHome: path.join('C:', 'copilot'),
      dbPath: explicitDbPath,
      cliPath: __filename,
      fsModule: {
        existsSync(p) { return p === explicitDbPath; },
        statSync(p) { return { size: 4096 }; },
      },
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
    assert.deepEqual(recorded.map((entry) => getCommandKey(entry.args)), [
      'roadmap show',
      'roadmap show',
    ]);
  });

  await test('roadmap workflow planning bridge fails open when elegy-planning returns invalid json', async () => {
    const explicitDbPath = path.join('C:', 'planning', 'elegy-planning.db');
    const bridge = createRoadmapWorkflowPlanningBridge({
      enabled: true,
      elegyHome: path.join('C:', 'copilot'),
      dbPath: explicitDbPath,
      cliPath: __filename,
      fsModule: {
        existsSync(p) { return p === explicitDbPath; },
        statSync(p) { return { size: 4096 }; },
      },
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
        message: 'elegy-planning authority is not configured.',
      }],
    });
  });

  await test('resolvePlanningDbPath prefers explicit existing path', async () => {
    const explicitDb = path.join('/', 'test', 'planning.db');
    const result = resolvePlanningDbPath({
      dbPath: explicitDb,
      elegyHome: path.join('/', 'copilot'),
      homedir: path.join('/', 'Users', 'test'),
      pathModule: path,
      fsModule: {
        existsSync(p) {
          return p === explicitDb;
        },
        statSync(p) {
          if (p === explicitDb) return { size: 4096 };
          return { size: 0 };
        },
      },
      env: {},
    });

    assert.equal(result.dbPath, explicitDb);
    assert.equal(result.source, 'explicit');
    assert.ok(result.reason.includes('explicit'));
  });

  await test('resolvePlanningDbPath uses home-elegy even when a copilot DB exists', async () => {
    const copilotDb = path.join('/', 'copilot', 'elegy-planning.db');
    const elegyDb = path.join('/', 'Users', 'test', '.elegy', 'planning.db');
    const result = resolvePlanningDbPath({
      dbPath: '',
      elegyHome: path.join('/', 'copilot'),
      homedir: path.join('/', 'Users', 'test'),
      pathModule: path,
      fsModule: {
        existsSync(p) {
          return p === elegyDb || p === copilotDb;
        },
        statSync(p) {
          if (p === elegyDb) return { size: 8192 };
          if (p === copilotDb) return { size: 0 };
          return { size: 0 };
        },
      },
      env: {},
    });

    assert.equal(result.dbPath, elegyDb);
    assert.equal(result.source, 'home-elegy');
    assert.ok(result.reason.includes('populated'));
  });

  await test('resolvePlanningDbPath ignores non-elegy elegyHome when both are populated', async () => {
    const copilotDb = path.join('/', 'copilot', 'elegy-planning.db');
    const elegyDb = path.join('/', 'Users', 'test', '.elegy', 'planning.db');
    const result = resolvePlanningDbPath({
      dbPath: '',
      elegyHome: path.join('/', 'copilot'),
      homedir: path.join('/', 'Users', 'test'),
      pathModule: path,
      fsModule: {
        existsSync(p) {
          return p === path.join('/', 'copilot', 'elegy-planning.db')
            || p === path.join('/', 'Users', 'test', '.elegy', 'planning.db');
        },
        statSync(p) {
          return { size: 4096 };
        },
      },
      env: {},
    });

    assert.equal(result.dbPath, elegyDb);
    assert.equal(result.source, 'home-elegy');
  });

  await test('bridge getStatus includes dbResolution with candidates', async () => {
    const bridge = createRoadmapWorkflowPlanningBridge({
      enabled: true,
      elegyHome: path.join('C:', 'copilot'),
      homedir: path.join('C:', 'Users', 'test'),
      cliPath: __filename,
      childProcess: createExecFileStub(({ callback }) => {
        callback(null, JSON.stringify({ status: 'ok', data: {} }), '');
      }),
      env: {},
      processObject: {
        env: {},
        platform: 'win32',
      },
    });

    const status = bridge.getStatus();
    assert.ok(status.dbResolution);
    assert.ok(Array.isArray(status.dbResolution.candidates));
    assert.ok(status.dbResolution.candidates.length > 0);
    assert.equal(typeof status.dbResolution.source, 'string');
  });

  await test('bridge listRoadmaps with repoLabel attempts multi-scope query', async () => {
    const recorded = [];
    const explicitDbPath = path.join('C:', 'planning', 'elegy-planning.db');
    const bridge = createRoadmapWorkflowPlanningBridge({
      enabled: true,
      elegyHome: path.join('C:', 'copilot'),
      dbPath: explicitDbPath,
      cliPath: __filename,
      fsModule: {
        existsSync(p) { return p === explicitDbPath; },
        statSync(p) { return { size: 4096 }; },
      },
      childProcess: createExecFileStub(({ command, args, callback }) => {
        recorded.push({ command, args });
        const commandKey = getCommandKey(args);
        if (commandKey === 'scope list') {
          callback(null, JSON.stringify({
            status: 'ok',
            data: {
              scopes: [
                { scopeKey: 'default', tags: [] },
                { scopeKey: 'holon', tags: ['holon', 'SAASTools'] },
              ],
            },
          }), '');
          return;
        }
        if (commandKey === 'roadmap list') {
          // Check which scope
          const scopeIdx = args.indexOf('--scope');
          const scopeVal = scopeIdx >= 0 ? args[scopeIdx + 1] : 'default';
          if (scopeVal === 'holon') {
            callback(null, JSON.stringify({
              status: 'ok',
              data: {
                roadmaps: [
                  { id: 'RM-holon-1', title: 'Holon Roadmap', status: 'active', tags: ['holon'] },
                ],
              },
            }), '');
          } else {
            callback(null, JSON.stringify({
              status: 'ok',
              data: {
                roadmaps: [
                  { id: 'RM-default', title: 'Default Roadmap', status: 'draft', tags: [] },
                ],
              },
            }), '');
          }
          return;
        }
        callback(null, JSON.stringify({ status: 'ok', data: {} }), '');
      }),
      env: {},
      processObject: {
        env: {},
        platform: 'win32',
      },
    });

    const result = await bridge.listRoadmaps({
      requestId: 'multi-scope-test',
      repoLabel: 'holon',
    });

    assert.ok(Array.isArray(result.roadmaps));
    // Should have default scope first (active), then holon scope matches
    const ids = result.roadmaps.map((r) => r.id);
    assert.ok(ids.includes('RM-default') || ids.includes('RM-holon-1'));
    // Verify scope list was called
    const scopeCalls = recorded.filter((r) => getCommandKey(r.args) === 'scope list');
    assert.equal(scopeCalls.length, 1);
  });

  await test('bridge listGoals runs goal list and returns goals', async () => {
    const recorded = [];
    const explicitDbPath = path.join('C:', 'planning', 'elegy-planning.db');
    const bridge = createRoadmapWorkflowPlanningBridge({
      enabled: true,
      elegyHome: path.join('C:', 'copilot'),
      dbPath: explicitDbPath,
      cliPath: __filename,
      fsModule: {
        existsSync(p) { return p === explicitDbPath; },
        statSync(p) { return { size: 4096 }; },
      },
      childProcess: createExecFileStub(({ command, args, callback }) => {
        recorded.push({ command, args });
        const commandKey = getCommandKey(args);
        if (commandKey === 'goal list') {
          callback(null, JSON.stringify({
            status: 'ok',
            data: {
              goals: [
                { id: 'GOAL-one', title: 'Goal One', status: 'active' },
              ],
            },
          }), '');
          return;
        }
        callback(null, JSON.stringify({ status: 'ok', data: {} }), '');
      }),
      env: {},
      processObject: {
        env: {},
        platform: 'win32',
      },
    });

    const result = await bridge.listGoals({ requestId: 'goal-list-test' });

    assert.deepEqual(result.goals.map((goal) => goal.id), ['GOAL-one']);
    assert.equal(recorded.length, 1);
    assert.equal(getCommandKey(recorded[0].args), 'goal list');
  });

  await test('bridge listPlans with repoLabel de-dupes by scopeKey and id', async () => {
    const recorded = [];
    const explicitDbPath = path.join('C:', 'planning', 'elegy-planning.db');
    const bridge = createRoadmapWorkflowPlanningBridge({
      enabled: true,
      elegyHome: path.join('C:', 'copilot'),
      dbPath: explicitDbPath,
      cliPath: __filename,
      fsModule: {
        existsSync(p) { return p === explicitDbPath; },
        statSync(p) { return { size: 4096 }; },
      },
      childProcess: createExecFileStub(({ command, args, callback }) => {
        recorded.push({ command, args });
        const commandKey = getCommandKey(args);
        if (commandKey === 'scope list') {
          callback(null, JSON.stringify({
            status: 'ok',
            data: {
              scopes: [
                { scopeKey: 'default', tags: ['holon'] },
                { scopeKey: 'holon', tags: ['holon'] },
              ],
            },
          }), '');
          return;
        }
        if (commandKey === 'plan list') {
          const scopeIdx = args.indexOf('--scope');
          const scopeVal = scopeIdx >= 0 ? args[scopeIdx + 1] : 'default';
          if (scopeVal === 'holon') {
            callback(null, JSON.stringify({
              status: 'ok',
              data: {
                plans: [
                  { id: 'PLAN-shared', title: 'Shared Plan', tags: ['holon'] },
                  { id: 'PLAN-holon-only', title: 'Holon Only', tags: [] },
                ],
              },
            }), '');
          } else {
            callback(null, JSON.stringify({
              status: 'ok',
              data: {
                plans: [
                  { id: 'PLAN-shared', title: 'Shared Plan', tags: [] },
                  { id: 'PLAN-default-only', title: 'Default Only', tags: [] },
                ],
              },
            }), '');
          }
          return;
        }
        callback(null, JSON.stringify({ status: 'ok', data: {} }), '');
      }),
      env: {},
      processObject: {
        env: {},
        platform: 'win32',
      },
    });

    const result = await bridge.listPlans({
      requestId: 'de-dupe-test',
      repoLabel: 'holon',
    });

    assert.ok(Array.isArray(result.plans));
    const ids = result.plans.map((p) => p.id);
    // Both 'default' and 'holon' scopes have tag 'holon' → both match labels
    // PLAN-shared appears in both scopes; dedupe is per scopeKey+id, so both copies kept
    assert.ok(ids.includes('PLAN-shared'));
    assert.ok(ids.includes('PLAN-holon-only'));
    assert.ok(ids.includes('PLAN-default-only'));
  });

  await test('scope matching handles scopeKey field from elegy-planning CLI output', async () => {
    const explicitDbPath = path.join('C:', 'planning', 'elegy-planning.db');
    const bridge = createRoadmapWorkflowPlanningBridge({
      enabled: true,
      elegyHome: path.join('C:', 'copilot'),
      dbPath: explicitDbPath,
      cliPath: __filename,
      fsModule: {
        existsSync(p) { return p === explicitDbPath; },
        statSync(p) { return { size: 4096 }; },
      },
      childProcess: createExecFileStub(({ args, callback }) => {
        const commandKey = getCommandKey(args);
        if (commandKey === 'scope list') {
          callback(null, JSON.stringify({
            status: 'ok',
            data: {
              scopes: [
                { scopeKey: 'default', tags: [] },
                { scopeKey: 'holon', tags: ['holon'] },
              ],
            },
          }), '');
          return;
        }
        if (commandKey === 'roadmap list') {
          const scopeIdx = args.indexOf('--scope');
          const scopeVal = scopeIdx >= 0 ? args[scopeIdx + 1] : 'default';
          if (scopeVal === 'holon') {
            callback(null, JSON.stringify({
              status: 'ok',
              data: {
                roadmaps: [
                  { id: 'RM-holon', title: 'Holon Roadmap', status: 'active', tags: ['holon'] },
                ],
              },
            }), '');
          } else {
            callback(null, JSON.stringify({
              status: 'ok',
              data: { roadmaps: [] },
            }), '');
          }
          return;
        }
        callback(null, JSON.stringify({ status: 'ok', data: {} }), '');
      }),
      env: {},
      processObject: { env: {}, platform: 'win32' },
    });

    const result = await bridge.listRoadmaps({
      requestId: 'scopeKey-test',
      repoLabel: 'holon',
    });

    assert.ok(Array.isArray(result.roadmaps));
    assert.equal(result.roadmaps.length, 1);
    assert.equal(result.roadmaps[0].id, 'RM-holon');
  });

  await test('label derivation splits holon-repo into holon and repo tokens', async () => {
    const explicitDbPath = path.join('C:', 'planning', 'elegy-planning.db');
    const bridge = createRoadmapWorkflowPlanningBridge({
      enabled: true,
      elegyHome: path.join('C:', 'copilot'),
      dbPath: explicitDbPath,
      cliPath: __filename,
      fsModule: {
        existsSync(p) { return p === explicitDbPath; },
        statSync(p) { return { size: 4096 }; },
      },
      childProcess: createExecFileStub(({ args, callback }) => {
        const commandKey = getCommandKey(args);
        if (commandKey === 'scope list') {
          callback(null, JSON.stringify({
            status: 'ok',
            data: {
              scopes: [
                { scopeKey: 'default', tags: [] },
                { scopeKey: 'holon', tags: ['holon'] },
              ],
            },
          }), '');
          return;
        }
        if (commandKey === 'roadmap list') {
          const scopeIdx = args.indexOf('--scope');
          const scopeVal = scopeIdx >= 0 ? args[scopeIdx + 1] : 'default';
          if (scopeVal === 'holon') {
            callback(null, JSON.stringify({
              status: 'ok',
              data: {
                roadmaps: [
                  { id: 'RM-derived', title: 'Derived Match', status: 'draft', tags: [] },
                ],
              },
            }), '');
          } else {
            callback(null, JSON.stringify({
              status: 'ok',
              data: { roadmaps: [] },
            }), '');
          }
          return;
        }
        callback(null, JSON.stringify({ status: 'ok', data: {} }), '');
      }),
      env: {},
      processObject: { env: {}, platform: 'win32' },
    });

    // holon-repo should derive tokens: holon-repo, holon, repo
    const result = await bridge.listRoadmaps({
      requestId: 'derive-test',
      repoLabel: 'holon-repo',
    });

    assert.ok(Array.isArray(result.roadmaps));
    assert.equal(result.roadmaps.length, 1);
    assert.equal(result.roadmaps[0].id, 'RM-derived');
  });

  await test('fallback DB trial can query canonical .elegy DB after an explicit primary has no matching scopes', async () => {
    const primaryDbPath = path.join('C:', 'copilot', 'elegy-planning.db');
    const elegyDbPath = path.join('C:', 'Users', 'test', '.elegy', 'planning.db');
    const recorded = [];
    const bridge = createRoadmapWorkflowPlanningBridge({
      enabled: true,
      dbPath: primaryDbPath,
      elegyHome: path.join('C:', 'copilot'),
      homedir: path.join('C:', 'Users', 'test'),
      cliPath: __filename,
      childProcess: createExecFileStub(({ args, callback }) => {
        const commandKey = getCommandKey(args);
        // Determine which DB is being used from args
        const dbIdx = args.indexOf('--db');
        const dbPathFromArgs = dbIdx >= 0 ? args[dbIdx + 1] : '';
        recorded.push({ commandKey, dbPath: dbPathFromArgs });
        if (commandKey === 'scope list') {
          if (dbPathFromArgs === elegyDbPath) {
            callback(null, JSON.stringify({
              status: 'ok',
              data: {
                scopes: [
                  { scopeKey: 'default', tags: [] },
                  { scopeKey: 'holon', tags: ['holon'] },
                ],
              },
            }), '');
          } else {
            // Primary DB has only default scope
            callback(null, JSON.stringify({
              status: 'ok',
              data: {
                scopes: [
                  { scopeKey: 'default', tags: [] },
                ],
              },
            }), '');
          }
          return;
        }
        if (commandKey === 'roadmap list') {
          if (dbPathFromArgs === elegyDbPath) {
            callback(null, JSON.stringify({
              status: 'ok',
              data: {
                roadmaps: [
                  { id: 'RM-legacy', title: 'Legacy Roadmap', status: 'active', tags: ['holon'] },
                ],
              },
            }), '');
          } else {
            callback(null, JSON.stringify({
              status: 'ok',
              data: { roadmaps: [] },
            }), '');
          }
          return;
        }
        callback(null, JSON.stringify({ status: 'ok', data: {} }), '');
      }),
      fsModule: {
        existsSync(p) { return p === primaryDbPath || p === elegyDbPath; },
        statSync(p) { return { size: p === elegyDbPath ? 8192 : 4096 }; },
      },
      env: {},
      processObject: { env: {}, platform: 'win32' },
    });

    const result = await bridge.listRoadmaps({
      requestId: 'fallback-test',
      repoLabel: 'holon',
    });

    assert.ok(Array.isArray(result.roadmaps));
    assert.equal(result.roadmaps.length, 1);
    assert.equal(result.roadmaps[0].id, 'RM-legacy');
    const elegyDbAttempts = recorded.filter((r) => r.dbPath === elegyDbPath);
    assert.ok(elegyDbAttempts.length > 0, 'Should have queried canonical .elegy DB');
  });

  if (!process.exitCode) {
    console.log(`roadmap workflow planning bridge tests passed: ${passed}`);
  }
}

run();
