'use strict';

const assert = require('assert');
const path = require('path');
const childProcess = require('child_process');
const runtimeContracts = require('./runtimeContracts');

const {
  RUNTIME_CONTRACT_VERSION,
  RUNTIME_MODES,
  CAPABILITY_STATES,
  RUNTIME_PROVIDER_CONTRACT_VERSION,
  RUNTIME_PROVIDERS,
  RUNTIME_PROVIDER_SELECTION_SOURCES,
  SESSION_RECONCILIATION_CONTRACT_VERSION,
  SESSION_RECONCILIATION_SOURCES,
  SESSION_RECONCILIATION_SOURCE_PRECEDENCE,
  SESSION_RECONCILIATION_SOURCE_OF_TRUTH,
  SESSION_STATE_AUTHORITIES,
  RUNTIME_COMPATIBILITY_CAPABILITIES,
  DEFAULT_RUNTIME_MODE,
  DEFAULT_CAPABILITY_STATE,
  DEFAULT_RUNTIME_PROVIDER,
  detectRuntimeMode,
  normalizeRuntimeProvider,
  normalizeSessionReconciliationSource,
  getSessionReconciliationSourcePrecedence,
  resolveSessionReconciliationAuthority,
  buildRuntimeProviderMetadata,
  buildCompatibilityRuntimeContract,
  buildRuntimeContract,
  SESSION_ORCHESTRATION_CONTRACT_VERSION,
  normalizeActorRole,
  normalizeSessionOrchestrationMetadata,
  buildSessionOrchestrationProjection,
} = runtimeContracts;

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS: ${name}`);
  } catch (e) {
    console.error(`  FAIL: ${name}`);
    console.error(`    ${e.message}`);
    process.exitCode = 1;
  }
}

test('buildRuntimeContract is deterministic for same inputs', () => {
  const input = {
    mode: 'PACKAGED',
    capabilities: {
      zFeature: 'available',
      alphaFeature: 'unavailable',
    },
  };

  const resultA = buildRuntimeContract(input);
  const resultB = buildRuntimeContract(input);

  assert.deepStrictEqual(resultA, resultB);
  assert.deepStrictEqual(Object.keys(resultA.capabilities), ['alphaFeature', 'zFeature']);
});

test('normalizes invalid mode/state inputs to safe defaults', () => {
  const result = buildRuntimeContract({
    mode: 'not-a-real-mode',
    capabilities: {
      fs: 'broken-value',
    },
  });

  assert.strictEqual(result.mode, DEFAULT_RUNTIME_MODE);
  assert.strictEqual(result.capabilities.fs, DEFAULT_CAPABILITY_STATE);
});

test('contract version is always present', () => {
  const result = buildRuntimeContract();
  assert.strictEqual(result.contractVersion, RUNTIME_CONTRACT_VERSION);
});

test('detectRuntimeMode supports explicit, packaged, and fallback modes', () => {
  assert.strictEqual(detectRuntimeMode({ explicitMode: 'packaged' }), RUNTIME_MODES.PACKAGED);
  assert.strictEqual(detectRuntimeMode({ isPackaged: true }), RUNTIME_MODES.PACKAGED);
  assert.strictEqual(detectRuntimeMode({ engineRoot: '/tmp/app.asar/dist' }), RUNTIME_MODES.PACKAGED);
  assert.strictEqual(detectRuntimeMode({ explicitMode: 'invalid-value' }), DEFAULT_RUNTIME_MODE);
});

test('buildCompatibilityRuntimeContract fills compatibility capability defaults', () => {
  const result = buildCompatibilityRuntimeContract({
    mode: 'repo',
    capabilities: {
      docker: CAPABILITY_STATES.UNAVAILABLE,
    },
  });

  assert.strictEqual(result.contractVersion, RUNTIME_CONTRACT_VERSION);
  assert.strictEqual(result.mode, RUNTIME_MODES.REPO);
  for (const capability of RUNTIME_COMPATIBILITY_CAPABILITIES) {
    assert.ok(Object.prototype.hasOwnProperty.call(result.capabilities, capability));
  }
  assert.strictEqual(result.capabilities.docker, CAPABILITY_STATES.UNAVAILABLE);
  assert.strictEqual(result.capabilities.sandbox, DEFAULT_CAPABILITY_STATE);
  assert.strictEqual(result.capabilities.wsl2, DEFAULT_CAPABILITY_STATE);
  assert.ok(result.provider);
  assert.strictEqual(result.provider.selectedProvider, DEFAULT_RUNTIME_PROVIDER);
  assert.strictEqual(result.provider.defaultProvider, DEFAULT_RUNTIME_PROVIDER);
  assert.strictEqual(result.provider.selectionSource, RUNTIME_PROVIDER_SELECTION_SOURCES.DEFAULT);
});

test('runtime provider metadata normalizes explicit and default provider selection deterministically', () => {
  assert.strictEqual(normalizeRuntimeProvider('docker'), RUNTIME_PROVIDERS.DOCKER);
  assert.strictEqual(normalizeRuntimeProvider('nondocker'), RUNTIME_PROVIDERS.NON_DOCKER);
  assert.strictEqual(normalizeRuntimeProvider('invalid-provider'), null);

  const explicit = buildRuntimeProviderMetadata({
    selectedProvider: 'docker',
    defaultProvider: 'non-docker',
  });

  assert.strictEqual(explicit.selectedProvider, RUNTIME_PROVIDERS.DOCKER);
  assert.strictEqual(explicit.defaultProvider, RUNTIME_PROVIDERS.NON_DOCKER);
  assert.strictEqual(explicit.selectionSource, RUNTIME_PROVIDER_SELECTION_SOURCES.EXPLICIT);

  const fallback = buildRuntimeProviderMetadata({
    selectedProvider: 'invalid',
    defaultProvider: 'invalid',
  });

  assert.strictEqual(fallback.selectedProvider, DEFAULT_RUNTIME_PROVIDER);
  assert.strictEqual(fallback.defaultProvider, DEFAULT_RUNTIME_PROVIDER);
  assert.strictEqual(fallback.selectionSource, RUNTIME_PROVIDER_SELECTION_SOURCES.DEFAULT);
});

test('runtime provider metadata contract is versioned and stable across builders', () => {
  const runtime = buildRuntimeContract();
  assert.deepStrictEqual(runtime.provider, {
    contractVersion: RUNTIME_PROVIDER_CONTRACT_VERSION,
    selectedProvider: DEFAULT_RUNTIME_PROVIDER,
    defaultProvider: DEFAULT_RUNTIME_PROVIDER,
    selectionSource: RUNTIME_PROVIDER_SELECTION_SOURCES.DEFAULT,
  });

  const compatibility = buildCompatibilityRuntimeContract({
    selectedProvider: 'docker',
    defaultProvider: 'non-docker',
  });

  assert.deepStrictEqual(compatibility.provider, {
    contractVersion: RUNTIME_PROVIDER_CONTRACT_VERSION,
    selectedProvider: RUNTIME_PROVIDERS.DOCKER,
    defaultProvider: RUNTIME_PROVIDERS.NON_DOCKER,
    selectionSource: RUNTIME_PROVIDER_SELECTION_SOURCES.EXPLICIT,
  });
});

test('session reconciliation source precedence is deterministic and normalized', () => {
  assert.strictEqual(SESSION_RECONCILIATION_CONTRACT_VERSION, '1');
  assert.deepStrictEqual(SESSION_RECONCILIATION_SOURCE_PRECEDENCE, {
    runtime: 2,
    artifact: 1,
  });
  assert.strictEqual(normalizeSessionReconciliationSource('runtime'), SESSION_RECONCILIATION_SOURCES.RUNTIME);
  assert.strictEqual(normalizeSessionReconciliationSource('filesystem'), SESSION_RECONCILIATION_SOURCES.ARTIFACT);
  assert.strictEqual(normalizeSessionReconciliationSource('invalid'), null);
  assert.strictEqual(getSessionReconciliationSourcePrecedence('runtime'), 2);
  assert.strictEqual(getSessionReconciliationSourcePrecedence('artifact'), 1);
  assert.strictEqual(getSessionReconciliationSourcePrecedence('invalid'), 0);
});

test('resolveSessionReconciliationAuthority applies frozen authority matrix', () => {
  const both = resolveSessionReconciliationAuthority({ hasRuntimeState: true, hasArtifactState: true });
  assert.strictEqual(both.authority, SESSION_STATE_AUTHORITIES.RUNTIME);
  assert.strictEqual(both.sourceOfTruth, SESSION_RECONCILIATION_SOURCE_OF_TRUTH[SESSION_STATE_AUTHORITIES.RUNTIME]);
  assert.deepStrictEqual(both.sourcePrecedence, [
    SESSION_RECONCILIATION_SOURCES.RUNTIME,
    SESSION_RECONCILIATION_SOURCES.ARTIFACT,
  ]);

  const runtimeOnly = resolveSessionReconciliationAuthority({ runtimeState: { status: 'active' } });
  assert.strictEqual(runtimeOnly.authority, SESSION_STATE_AUTHORITIES.RUNTIME);
  assert.strictEqual(runtimeOnly.sourceOfTruth, SESSION_RECONCILIATION_SOURCES.RUNTIME);
  assert.deepStrictEqual(runtimeOnly.sourcePrecedence, [SESSION_RECONCILIATION_SOURCES.RUNTIME]);

  const artifactOnly = resolveSessionReconciliationAuthority({ hasRuntimeState: false, artifactState: { id: 's-1' } });
  assert.strictEqual(artifactOnly.authority, SESSION_STATE_AUTHORITIES.ARTIFACT);
  assert.strictEqual(artifactOnly.sourceOfTruth, SESSION_RECONCILIATION_SOURCES.ARTIFACT);
  assert.deepStrictEqual(artifactOnly.sourcePrecedence, [SESSION_RECONCILIATION_SOURCES.ARTIFACT]);

  const neither = resolveSessionReconciliationAuthority({ hasRuntimeState: false, hasArtifactState: false });
  assert.strictEqual(neither.authority, SESSION_STATE_AUTHORITIES.ARTIFACT);
  assert.deepStrictEqual(neither.sourcePrecedence, [SESSION_RECONCILIATION_SOURCES.ARTIFACT]);
});

test('resolveSessionReconciliationAuthority is deterministic across equivalent state shapes', () => {
  const viaFlags = resolveSessionReconciliationAuthority({
    hasRuntimeState: true,
    hasArtifactState: true,
  });

  const viaObjects = resolveSessionReconciliationAuthority({
    runtimeState: { status: 'active' },
    artifactState: { id: 'session-1' },
  });

  assert.deepStrictEqual(viaObjects, viaFlags);
  assert.deepStrictEqual(viaObjects.sourcePrecedence, [
    SESSION_RECONCILIATION_SOURCES.RUNTIME,
    SESSION_RECONCILIATION_SOURCES.ARTIFACT,
  ]);
});

test('resolveSessionReconciliationAuthority respects explicit false presence flags over object hints', () => {
  const resolved = resolveSessionReconciliationAuthority({
    hasRuntimeState: false,
    hasArtifactState: false,
    runtimeState: { status: 'active' },
    artifactState: { id: 'session-2' },
  });

  assert.strictEqual(resolved.hasRuntimeState, false);
  assert.strictEqual(resolved.hasArtifactState, false);
  assert.strictEqual(resolved.authority, SESSION_STATE_AUTHORITIES.ARTIFACT);
  assert.strictEqual(resolved.sourceOfTruth, SESSION_RECONCILIATION_SOURCES.ARTIFACT);
  assert.deepStrictEqual(resolved.sourcePrecedence, [SESSION_RECONCILIATION_SOURCES.ARTIFACT]);
});

test('session orchestration helpers normalize actor roles and metadata deterministically', () => {
  assert.strictEqual(SESSION_ORCHESTRATION_CONTRACT_VERSION, '1');
  assert.strictEqual(normalizeActorRole('Planner'), 'planner');
  assert.strictEqual(normalizeActorRole('code-builder'), 'implementer');
  assert.strictEqual(normalizeActorRole('unknown-role'), 'specialist');

  const metadata = normalizeSessionOrchestrationMetadata({
    objective: 'Ship the backend slice',
    repo: {
      repoId: 'instruction-engine',
      repoPath: 'C:/Repos/instruction-engine',
    },
    isolation: {
      mode: 'dedicated',
      worktreeId: 'wt-1',
      worktreeStatus: 'ready',
      launchBlocked: true,
      launchBlockedReason: 'Prepare the worktree first.',
    },
    actors: [{ actorId: 'planner', label: 'Planner' }],
    taskRefs: [{ taskId: 'TASK-1' }],
    workflow: {
      workflowKind: 'task-execution',
      trigger: 'manual',
    },
  });

  assert.deepStrictEqual(metadata, {
    objective: 'Ship the backend slice',
    repo: {
      repoId: 'instruction-engine',
      repoPath: 'C:/Repos/instruction-engine',
      repoLabel: null,
      branch: null,
      source: null,
    },
    isolation: {
      mode: 'dedicated',
      contextType: null,
      sandboxId: null,
      worktreeId: 'wt-1',
      worktreePath: null,
      worktreeStatus: 'ready',
      launchBlocked: true,
      launchBlockedReason: 'Prepare the worktree first.',
    },
    actors: [{
      actorId: 'planner',
      label: 'Planner',
      role: 'planner',
      kind: 'runtime',
      status: null,
      source: 'runtime',
      taskId: null,
      taskIds: [],
      invocationCount: null,
    }],
    taskRefs: [{
      taskId: 'TASK-1',
      title: null,
      status: null,
      ownerSessionId: null,
      activeActorId: null,
      activeActorLabel: null,
    }],
    workflow: {
      workflowKind: 'task-execution',
      workflowId: null,
      trigger: 'manual',
      mode: null,
      runId: null,
      jobId: null,
      sessionId: null,
      status: null,
    },
  });
});

test('buildSessionOrchestrationProjection preserves authority-safe task and workflow projections', () => {
  const projection = buildSessionOrchestrationProjection({
    sessionId: 'session-1',
    metadata: {
      objective: 'Objective',
      repo: { repoId: 'instruction-engine' },
    },
    actors: [{ actorId: 'reviewer', label: 'Reviewer' }],
    taskItems: [{ taskId: 'TASK-1', ownerSessionId: 'session-1' }],
    workflowRuns: [{ runId: 'run-1', status: 'running' }],
    overlaySessions: [{ id: 'overlay-1' }],
    worktree: { worktreeId: 'wt-1' },
  });

  assert.strictEqual(projection.contractVersion, '1');
  assert.strictEqual(projection.authority.durableTasks, 'repo-state');
  assert.strictEqual(projection.repo.repoId, 'instruction-engine');
  assert.strictEqual(projection.taskBoard.items[0].taskId, 'TASK-1');
  assert.strictEqual(projection.workflow.runs[0].runId, 'run-1');
  assert.strictEqual(projection.isolation.worktree.worktreeId, 'wt-1');
});

test('CJS import smoke', () => {
  const imported = require('./runtimeContracts');
  assert.ok(imported);
  assert.strictEqual(typeof imported.buildRuntimeContract, 'function');
});

test('ESM createRequire smoke', () => {
  const modulePath = path.resolve(__dirname, 'runtimeContracts.js');
  const script = `
    import { createRequire } from 'module';
    const require = createRequire(import.meta.url);
    const m = require(${JSON.stringify(modulePath)});
    if (!m || typeof m.buildRuntimeContract !== 'function') {
      throw new Error('runtimeContracts import failed');
    }
  `;

  childProcess.execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    stdio: 'pipe',
  });
});

console.log(`\n${passed} tests passed`);
if (process.exitCode) {
  console.error('Some tests FAILED');
} else {
  console.log('All tests passed');
}
