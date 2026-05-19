'use strict';

const assert = require('node:assert/strict');

const {
  CONTINUATION_PACKAGE_CONTRACT_VERSION,
  PLANNING_API_CONTRACT_VERSION,
} = require('@elegy-copilot/contracts');
const { register } = require('./planning');

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

function createResponse() {
  const state = {
    statusCode: null,
    chunks: [],
  };

  return {
    get statusCode() {
      return state.statusCode;
    },
    get bodyText() {
      return state.chunks.join('');
    },
    writeHead(statusCode) {
      state.statusCode = statusCode;
    },
    write(chunk) {
      state.chunks.push(String(chunk));
      return true;
    },
    end(chunk) {
      if (chunk != null) state.chunks.push(String(chunk));
    },
  };
}

function parseJsonBody(response) {
  return JSON.parse(response.bodyText || '{}');
}

function findRoute(routes, method, pathname) {
  const route = routes.find((candidate) => candidate.method === method && candidate.path === pathname);
  if (!route) {
    throw new Error(`Route not found: ${method} ${pathname}`);
  }
  return route;
}

async function invoke(routes, method, pathname, ctx) {
  const u = new URL(`http://127.0.0.1${pathname}`);
  const route = findRoute(routes, method, u.pathname);
  const res = createResponse();
  const req = {
    method,
    headers: {},
    __body: {},
  };

  route.handler({
    req,
    res,
    u,
    pathname: u.pathname,
    ...ctx,
  });

  await new Promise((resolve) => setTimeout(resolve, 0));
  return {
    res,
    body: parseJsonBody(res),
  };
}

async function run() {
  await test('planning persistence init failures use the shared planning contract envelope', async () => {
    const routes = register({
      PLANNING_API_CONTRACT_VERSION: 'stale_planning_contract',
      sendJson(res, code, payload) {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload));
      },
      initializePlanningPersistenceAuthority: async () => {
        throw new Error('db unavailable');
      },
      buildPlanningPersistenceHealthEnvelope(input) {
        return {
          health: true,
          ...input,
        };
      },
      getPlanningPersistenceHealth() {
        return {
          status: 'disabled',
        };
      },
    });

    const { res, body } = await invoke(routes, 'POST', '/api/planning/persistence/init', {
      planningPersistenceConfig: {},
      planningPersistenceState: {},
    });

    assert.equal(res.statusCode, 503);
    assert.equal(body.contractVersion, PLANNING_API_CONTRACT_VERSION);
    assert.equal(body.kind, 'planning.persistence.init');
    assert.equal(body.deterministic, true);
    assert.equal(body.error.code, 'planning_persistence_init_failed');
  });

  await test('planning suggestion read failures use the shared planning error envelope', async () => {
    const routes = register({
      PLANNING_API_CONTRACT_VERSION: 'stale_planning_contract',
      sendJson(res, code, payload) {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload));
      },
      buildPlanningRequestContext() {
        return {
          userId: 'user-1',
        };
      },
      firstStringValue(value) {
        return value == null ? '' : String(value);
      },
      resolvePlanningPersistenceOperationClient() {
        return {
          ok: true,
          authority: {
            client: {},
          },
        };
      },
      readPlanningSuggestion: async () => {
        throw new Error('read failed');
      },
      resolvePlanningDurabilityArtifactErrorStatusCode() {
        return 503;
      },
      buildPlanningDurabilityArtifactFailureEnvelope() {
        throw new Error('should not be called for thrown read errors');
      },
    });

    const { res, body } = await invoke(routes, 'GET', '/api/planning/suggestions?suggestionId=abc', {
      planningPersistenceConfig: {},
      planningPersistenceState: {},
      planningAuthContext: {},
    });

    assert.equal(res.statusCode, 503);
    assert.equal(body.contractVersion, PLANNING_API_CONTRACT_VERSION);
    assert.equal(body.kind, 'planning.suggestion.read');
    assert.deepEqual(body.error, {
      code: 'planning_persistence_read_failed',
      reason: 'planning_persistence_read_failed',
    });
    assert.equal(body.detail, 'read failed');
  });

  await test('planning workflow artifact persist failures use the shared planning persistence envelope', async () => {
    const routes = register({
      PLANNING_API_CONTRACT_VERSION: 'stale_planning_contract',
      sendJson(res, code, payload) {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload));
      },
      readJsonBody: async () => ({}),
      buildPlanningRequestContext() {
        return {
          userId: 'user-1',
        };
      },
      resolvePlanningDurabilityWriteAuthority: async () => ({
        ok: true,
        authority: {
          validation: {
            configured: true,
            usable: true,
            required: false,
          },
          ready: true,
          status: 'ready',
        },
      }),
      firstStringValue(value) {
        return value == null ? '' : String(value);
      },
      persistRoadmapWorkflowArtifact: async () => {
        throw new Error('persist failed');
      },
      buildPlanningDurabilityPersistenceFailure(input) {
        assert.equal(input.pathname, '/api/planning/workflow-artifacts');
        assert.equal(input.method, 'POST');
        assert.equal(input.code, 'planning_persistence_write_failed');
        assert.equal(input.reason, 'planning_persistence_write_failed');
        return {
          statusCode: 503,
          body: {
            contractVersion: PLANNING_API_CONTRACT_VERSION,
            kind: 'planning.workflow-artifact.persist',
            deterministic: true,
            error: 'Planning durability persistence failed',
            code: 'planning_persistence_write_failed',
            reason: 'planning_persistence_write_failed',
            planningPersistence: {
              authority: 'db',
              configured: true,
              usable: true,
              required: false,
              ready: true,
              status: 'ready',
              governance: null,
              corruption: null,
            },
          },
        };
      },
    });

    const { res, body } = await invoke(routes, 'POST', '/api/planning/workflow-artifacts', {
      planningPersistenceConfig: {},
      planningPersistenceState: {},
      planningAuthContext: {},
    });

    assert.equal(res.statusCode, 503);
    assert.equal(body.contractVersion, PLANNING_API_CONTRACT_VERSION);
    assert.equal(body.kind, 'planning.workflow-artifact.persist');
    assert.equal(body.deterministic, true);
    assert.equal(body.error, 'Planning durability persistence failed');
    assert.equal(body.code, 'planning_persistence_write_failed');
    assert.equal(body.reason, 'planning_persistence_write_failed');
    assert.equal(body.detail, 'persist failed');
    assert.equal(body.planningPersistence.authority, 'db');
  });

  await test('planning workflow artifact persist returns 400 for malformed markdown artifacts', async () => {
    const routes = register({
      PLANNING_API_CONTRACT_VERSION: 'stale_planning_contract',
      sendJson(res, code, payload) {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload));
      },
      readJsonBody: async () => ({
        markdown: '# Review\n\nNo structured block here.',
      }),
      buildPlanningRequestContext() {
        return {
          userId: 'user-1',
        };
      },
      resolvePlanningDurabilityWriteAuthority: async () => ({
        ok: true,
        authority: {
          client: {},
        },
      }),
      firstStringValue(value) {
        return value == null ? '' : String(value);
      },
      persistRoadmapWorkflowArtifact: async () => {
        throw new Error('should not reach persistence');
      },
      buildPlanningDurabilityPersistenceFailure() {
        throw new Error('should not build persistence failure for malformed input');
      },
    });

    const { res, body } = await invoke(routes, 'POST', '/api/planning/workflow-artifacts', {
      planningPersistenceConfig: {},
      planningPersistenceState: {},
      planningAuthContext: {},
    });

    assert.equal(res.statusCode, 400);
    assert.equal(body.contractVersion, PLANNING_API_CONTRACT_VERSION);
    assert.equal(body.kind, 'planning.workflow-artifact.persist');
    assert.equal(body.deterministic, true);
    assert.equal(body.error, 'Artifact is missing the Structured State JSON block');
  });

  await test('planning workflow artifact persist includes successful memory sync metadata after durability write', async () => {
    const persistedArtifact = {
      artifactId: 'wf-artifact-001',
      actorId: 'user-1',
      repoId: 'repo-1',
      roadmapId: 'RM-core',
      sliceId: 'RM-core-001',
      kind: 'roadmap.review.result',
      phase: 'review',
      status: 'pass',
      checksum: 'checksum-1',
      body: '# Review',
      structuredState: {
        roadmapId: 'RM-core',
        sliceId: 'RM-core-001',
        kind: 'roadmap.review.result',
        phase: 'review',
        status: 'pass',
        followUps: [],
        requiresUserDecision: false,
      },
      createdAt: '2026-05-17T12:00:00.000Z',
      updatedAt: '2026-05-17T12:00:00.000Z',
    };
    const recorded = [];
    const routes = register({
      PLANNING_API_CONTRACT_VERSION: 'stale_planning_contract',
      sendJson(res, code, payload) {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload));
      },
      readJsonBody: async () => ({
        artifact: {
          body: '# Review\n\n## Structured State\n```json\n{"kind":"roadmap.review.result","roadmapId":"RM-core","sliceId":"RM-core-001","phase":"review","status":"pass","followUps":[],"requiresUserDecision":false}\n```',
        },
      }),
      buildPlanningRequestContext() {
        return {
          userId: 'user-1',
          repoId: 'repo-1',
        };
      },
      resolvePlanningDurabilityWriteAuthority: async () => ({
        ok: true,
        authority: {
          client: {},
        },
      }),
      firstStringValue(value) {
        return value == null ? '' : String(value);
      },
      persistRoadmapWorkflowArtifact: async () => ({
        ok: true,
        artifact: persistedArtifact,
      }),
      roadmapWorkflowMemoryBridge: {
        async persistArtifact(artifact) {
          recorded.push(artifact);
          return {
            status: 'synced',
            attempted: 1,
            synced: 1,
            memoryIds: ['memory-1'],
          };
        },
      },
      roadmapWorkflowPlanningBridge: {
        async persistArtifact() {
          return {
            status: 'synced',
            attempted: 2,
            synced: 2,
            validationStatus: 'valid',
            entities: {
              goalId: 'goal-RM-core',
              roadmapId: 'RM-core',
              workPointId: 'RM-core-001',
            },
            operations: [],
          };
        },
      },
      resolvePlanningDurabilityArtifactErrorStatusCode() {
        throw new Error('should not resolve artifact error for successful persist');
      },
      buildPlanningDurabilityArtifactFailureEnvelope() {
        throw new Error('should not build artifact failure for successful persist');
      },
      buildPlanningDurabilityPersistenceFailure() {
        throw new Error('should not build persistence failure for successful persist');
      },
    });

    const { res, body } = await invoke(routes, 'POST', '/api/planning/workflow-artifacts', {
      planningPersistenceConfig: {},
      planningPersistenceState: {},
      planningAuthContext: {},
    });

    assert.equal(res.statusCode, 200);
    assert.equal(body.contractVersion, PLANNING_API_CONTRACT_VERSION);
    assert.equal(body.kind, 'planning.workflow-artifact.persist');
    assert.equal(body.artifact.artifactId, 'wf-artifact-001');
    assert.deepEqual(body.memorySync, {
      status: 'synced',
      attempted: 1,
      synced: 1,
      memoryIds: ['memory-1'],
    });
    assert.deepEqual(recorded, [persistedArtifact]);
  });

  await test('planning workflow artifact persist includes successful elegy planning sync metadata after durability write', async () => {
    const persistedArtifact = {
      artifactId: 'wf-artifact-003',
      actorId: 'user-1',
      repoId: 'repo-1',
      roadmapId: 'RM-core',
      sliceId: 'RM-core-001',
      kind: 'roadmap.review.result',
      phase: 'review',
      status: 'pass',
      checksum: 'checksum-3',
      body: '# Review',
      structuredState: {
        roadmapId: 'RM-core',
        sliceId: 'RM-core-001',
        kind: 'roadmap.review.result',
        phase: 'review',
        status: 'pass',
        followUps: [],
        requiresUserDecision: false,
      },
      createdAt: '2026-05-17T12:00:00.000Z',
      updatedAt: '2026-05-17T12:00:00.000Z',
    };
    const recorded = [];
    const routes = register({
      PLANNING_API_CONTRACT_VERSION: 'stale_planning_contract',
      sendJson(res, code, payload) {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload));
      },
      readJsonBody: async () => ({
        artifact: {
          body: '# Review\n\n## Structured State\n```json\n{"kind":"roadmap.review.result","roadmapId":"RM-core","sliceId":"RM-core-001","phase":"review","status":"pass","followUps":[],"requiresUserDecision":false}\n```',
        },
      }),
      buildPlanningRequestContext() {
        return {
          userId: 'user-1',
          repoId: 'repo-1',
        };
      },
      resolvePlanningDurabilityWriteAuthority: async () => ({
        ok: true,
        authority: {
          client: {},
        },
      }),
      firstStringValue(value) {
        return value == null ? '' : String(value);
      },
      persistRoadmapWorkflowArtifact: async () => ({
        ok: true,
        artifact: persistedArtifact,
      }),
      roadmapWorkflowPlanningBridge: {
        async persistArtifact(artifact, options) {
          recorded.push({ artifact, options });
          return {
            status: 'synced',
            attempted: 3,
            synced: 3,
            validationStatus: 'valid',
            entities: {
              goalId: 'goal-RM-core',
              roadmapId: 'RM-core',
              workPointId: 'RM-core-001',
            },
            operations: [],
          };
        },
      },
      resolvePlanningDurabilityArtifactErrorStatusCode() {
        throw new Error('should not resolve artifact error for successful persist');
      },
      buildPlanningDurabilityArtifactFailureEnvelope() {
        throw new Error('should not build artifact failure for successful persist');
      },
      buildPlanningDurabilityPersistenceFailure() {
        throw new Error('should not build persistence failure for successful persist');
      },
    });

    const { res, body } = await invoke(routes, 'POST', '/api/planning/workflow-artifacts', {
      planningPersistenceConfig: {},
      planningPersistenceState: {},
      planningAuthContext: {},
    });

    assert.equal(res.statusCode, 200);
    assert.equal(body.contractVersion, PLANNING_API_CONTRACT_VERSION);
    assert.equal(body.kind, 'planning.workflow-artifact.persist');
    assert.equal(body.artifact.artifactId, 'wf-artifact-003');
    assert.deepEqual(body.elegyPlanningSync, {
      status: 'synced',
      attempted: 3,
      synced: 3,
      validationStatus: 'valid',
      entities: {
        goalId: 'goal-RM-core',
        roadmapId: 'RM-core',
        workPointId: 'RM-core-001',
      },
      operations: [],
    });
    assert.deepEqual(recorded, [{
      artifact: persistedArtifact,
      options: {
        requestId: 'wf-artifact-003',
      },
    }]);
  });

  await test('planning workflow artifact persist fails open when memory sync throws after durability write', async () => {
    const routes = register({
      PLANNING_API_CONTRACT_VERSION: 'stale_planning_contract',
      sendJson(res, code, payload) {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload));
      },
      readJsonBody: async () => ({
        artifact: {
          body: '# Review\n\n## Structured State\n```json\n{"kind":"roadmap.review.result","roadmapId":"RM-core","sliceId":"RM-core-001","phase":"review","status":"pass","followUps":[],"requiresUserDecision":false}\n```',
        },
      }),
      buildPlanningRequestContext() {
        return {
          userId: 'user-1',
          repoId: 'repo-1',
        };
      },
      resolvePlanningDurabilityWriteAuthority: async () => ({
        ok: true,
        authority: {
          client: {},
        },
      }),
      firstStringValue(value) {
        return value == null ? '' : String(value);
      },
      persistRoadmapWorkflowArtifact: async () => ({
        ok: true,
        artifact: {
          artifactId: 'wf-artifact-002',
          actorId: 'user-1',
          repoId: 'repo-1',
          roadmapId: 'RM-core',
          sliceId: 'RM-core-001',
          kind: 'roadmap.review.result',
          phase: 'review',
          status: 'pass',
          checksum: 'checksum-2',
          body: '# Review',
          structuredState: {
            roadmapId: 'RM-core',
            sliceId: 'RM-core-001',
            kind: 'roadmap.review.result',
            phase: 'review',
            status: 'pass',
            followUps: [],
            requiresUserDecision: false,
          },
          createdAt: '2026-05-17T12:00:00.000Z',
          updatedAt: '2026-05-17T12:00:00.000Z',
        },
      }),
      roadmapWorkflowMemoryBridge: {
        async persistArtifact() {
          const error = new Error('elegy-memory unavailable');
          error.code = 'ENOENT';
          throw error;
        },
      },
      roadmapWorkflowPlanningBridge: {
        async persistArtifact() {
          return {
            status: 'synced',
            attempted: 2,
            synced: 2,
            validationStatus: 'valid',
            entities: {
              goalId: 'goal-RM-core',
              roadmapId: 'RM-core',
              workPointId: 'RM-core-001',
            },
            operations: [],
          };
        },
      },
      resolvePlanningDurabilityArtifactErrorStatusCode() {
        throw new Error('should not resolve artifact error for successful persist');
      },
      buildPlanningDurabilityArtifactFailureEnvelope() {
        throw new Error('should not build artifact failure for successful persist');
      },
      buildPlanningDurabilityPersistenceFailure() {
        throw new Error('should not build persistence failure for successful persist');
      },
    });

    const { res, body } = await invoke(routes, 'POST', '/api/planning/workflow-artifacts', {
      planningPersistenceConfig: {},
      planningPersistenceState: {},
      planningAuthContext: {},
    });

    assert.equal(res.statusCode, 200);
    assert.equal(body.contractVersion, PLANNING_API_CONTRACT_VERSION);
    assert.equal(body.kind, 'planning.workflow-artifact.persist');
    assert.equal(body.artifact.artifactId, 'wf-artifact-002');
    assert.deepEqual(body.memorySync, {
      status: 'failed_open',
      attempted: 0,
      synced: 0,
      errors: [{
        code: 'ENOENT',
        message: 'elegy-memory unavailable',
      }],
    });
  });

  await test('planning workflow artifact persist fails closed when elegy-planning sync throws after durability write', async () => {
    const routes = register({
      PLANNING_API_CONTRACT_VERSION: 'stale_planning_contract',
      sendJson(res, code, payload) {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload));
      },
      readJsonBody: async () => ({
        artifact: {
          body: '# Review\n\n## Structured State\n```json\n{"kind":"roadmap.review.result","roadmapId":"RM-core","sliceId":"RM-core-001","phase":"review","status":"pass","followUps":[],"requiresUserDecision":false}\n```',
        },
      }),
      buildPlanningRequestContext() {
        return {
          userId: 'user-1',
          repoId: 'repo-1',
        };
      },
      resolvePlanningDurabilityWriteAuthority: async () => ({
        ok: true,
        authority: {
          client: {},
        },
      }),
      firstStringValue(value) {
        return value == null ? '' : String(value);
      },
      persistRoadmapWorkflowArtifact: async () => ({
        ok: true,
        artifact: {
          artifactId: 'wf-artifact-004',
          actorId: 'user-1',
          repoId: 'repo-1',
          roadmapId: 'RM-core',
          sliceId: 'RM-core-001',
          kind: 'roadmap.review.result',
          phase: 'review',
          status: 'pass',
          checksum: 'checksum-4',
          body: '# Review',
          structuredState: {
            roadmapId: 'RM-core',
            sliceId: 'RM-core-001',
            kind: 'roadmap.review.result',
            phase: 'review',
            status: 'pass',
            followUps: [],
            requiresUserDecision: false,
          },
          createdAt: '2026-05-17T12:00:00.000Z',
          updatedAt: '2026-05-17T12:00:00.000Z',
        },
      }),
      roadmapWorkflowPlanningBridge: {
        async persistArtifact() {
          const error = new Error('elegy-planning unavailable');
          error.code = 'ENOENT';
          throw error;
        },
      },
      resolvePlanningDurabilityArtifactErrorStatusCode() {
        throw new Error('should not resolve artifact error for successful persist');
      },
      buildPlanningDurabilityArtifactFailureEnvelope() {
        throw new Error('should not build artifact failure for successful persist');
      },
      buildPlanningDurabilityPersistenceFailure(input) {
        assert.equal(input.pathname, '/api/planning/workflow-artifacts');
        assert.equal(input.method, 'POST');
        assert.equal(input.statusCode, 503);
        assert.equal(input.code, 'ENOENT');
        assert.equal(input.reason, 'planning_workflow_authority_sync_failed');
        return {
          statusCode: 503,
          body: {
            contractVersion: PLANNING_API_CONTRACT_VERSION,
            kind: 'planning.workflow-artifact.persist',
            deterministic: true,
            error: 'Planning durability persistence failed',
            code: 'ENOENT',
            reason: 'planning_workflow_authority_sync_failed',
            planningPersistence: {
              authority: 'db',
            },
          },
        };
      },
    });

    const { res, body } = await invoke(routes, 'POST', '/api/planning/workflow-artifacts', {
      planningPersistenceConfig: {},
      planningPersistenceState: {},
      planningAuthContext: {},
    });

    assert.equal(res.statusCode, 503);
    assert.equal(body.contractVersion, PLANNING_API_CONTRACT_VERSION);
    assert.equal(body.kind, 'planning.workflow-artifact.persist');
    assert.equal(body.error, 'Planning durability persistence failed');
    assert.equal(body.code, 'ENOENT');
    assert.equal(body.reason, 'planning_workflow_authority_sync_failed');
    assert.equal(body.detail, 'elegy-planning unavailable');
    assert.deepEqual(body.elegyPlanningSync, {
      status: 'failed_closed',
      attempted: 0,
      synced: 0,
      errors: [{
        code: 'ENOENT',
        message: 'elegy-planning unavailable',
      }],
    });
  });

  await test('planning workflow artifact read failures use the shared planning error envelope', async () => {
    const routes = register({
      PLANNING_API_CONTRACT_VERSION: 'stale_planning_contract',
      sendJson(res, code, payload) {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload));
      },
      buildPlanningRequestContext() {
        return {
          userId: 'user-1',
        };
      },
      firstStringValue(value) {
        return value == null ? '' : String(value);
      },
      resolvePlanningPersistenceOperationClient() {
        return {
          ok: true,
          authority: {
            client: {},
          },
        };
      },
      readRoadmapWorkflowArtifact: async () => {
        throw new Error('workflow read failed');
      },
      resolvePlanningDurabilityArtifactErrorStatusCode() {
        return 503;
      },
      buildPlanningDurabilityArtifactFailureEnvelope() {
        throw new Error('should not be called for thrown read errors');
      },
    });

    const { res, body } = await invoke(routes, 'GET', '/api/planning/workflow-artifacts?artifactId=abc', {
      planningPersistenceConfig: {},
      planningPersistenceState: {},
      planningAuthContext: {},
    });

    assert.equal(res.statusCode, 503);
    assert.equal(body.contractVersion, PLANNING_API_CONTRACT_VERSION);
    assert.equal(body.kind, 'planning.workflow-artifact.read');
    assert.deepEqual(body.error, {
      code: 'planning_persistence_read_failed',
      reason: 'planning_persistence_read_failed',
    });
    assert.equal(body.detail, 'workflow read failed');
  });

  await test('planning workflow artifact continuation export wraps a portable continuation package', async () => {
    const routes = register({
      PLANNING_API_CONTRACT_VERSION: 'stale_planning_contract',
      sendJson(res, code, payload) {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload));
      },
      buildPlanningRequestContext() {
        return {
          userId: 'user-1',
        };
      },
      firstStringValue(value) {
        return value == null ? '' : String(value);
      },
      resolvePlanningPersistenceOperationClient() {
        return {
          ok: true,
          authority: {
            client: {},
          },
        };
      },
      readRoadmapWorkflowArtifact: async (_client, input) => {
        assert.equal(input.actorId, 'user-1');
        assert.equal(input.artifactId, 'artifact-123');
        return {
          ok: true,
          artifact: {
            artifactId: 'artifact-123',
            sessionId: 'session-42',
            repoId: 'repo-1',
            roadmapId: 'RM-platform',
            sliceId: 'RM-platform-001',
            kind: 'roadmap.review.result',
            phase: 'review',
            status: 'pass',
            sourceHarness: 'copilot',
            sourceModel: 'gpt-5.4',
            body: '# Review artifact',
            structuredState: {
              suggestedNextAction: 'Continue implementation in another harness.',
              roadmapImpact: 'Keep the roadmap current after the handoff.',
              followUps: ['Update the roadmap after exporting the package.'],
              requiresUserDecision: true,
              acceptance: {
                failedChecks: ['Validation still needs to be re-run in the target harness.'],
              },
            },
          },
        };
      },
      resolvePlanningDurabilityArtifactErrorStatusCode() {
        return 404;
      },
      buildPlanningDurabilityArtifactFailureEnvelope() {
        throw new Error('should not build failure envelope for successful continuation export');
      },
    });

    const { res, body } = await invoke(routes, 'GET', '/api/planning/workflow-artifacts/continuation-package?artifactId=artifact-123&targetHarness=opencode', {
      planningPersistenceConfig: {},
      planningPersistenceState: {},
      planningAuthContext: {},
    });

    assert.equal(res.statusCode, 200);
    assert.equal(body.contractVersion, PLANNING_API_CONTRACT_VERSION);
    assert.equal(body.kind, 'planning.workflow-artifact.continuation-package');
    assert.equal(body.deterministic, true);
    assert.equal(body.continuationContractVersion, CONTINUATION_PACKAGE_CONTRACT_VERSION);
    assert.equal(body.continuationPackage.contractVersion, CONTINUATION_PACKAGE_CONTRACT_VERSION);
    assert.equal(body.continuationPackage.kind, 'planning.workflow-artifact.continuation-package');
    assert.equal(body.continuationPackage.targetHarness, 'opencode');
    assert.equal(body.continuationPackage.source.kind, 'planning.workflow-artifact');
    assert.equal(body.continuationPackage.source.artifactId, 'artifact-123');
    assert.equal(body.continuationPackage.source.sessionId, 'session-42');
    assert.equal(body.continuationPackage.roadmap.roadmapId, 'RM-platform');
    assert.equal(body.continuationPackage.roadmap.sliceId, 'RM-platform-001');
    assert.ok(body.continuationPackage.constraints.includes('User decision required before execution can continue.'));
    assert.ok(body.continuationPackage.openQuestions.includes('Confirm the next decision before continuing implementation.'));
    assert.ok(body.continuationPackage.nextActions.includes('Continue implementation in another harness.'));
    assert.ok(body.continuationPackage.carryover.includes('Update the roadmap after exporting the package.'));
    assert.ok(body.continuationPackage.skillsRequired.includes('roadmap-planning'));
    assert.ok(body.continuationPackage.skillsRequired.includes('implementation-review'));
    assert.match(body.continuationPackage.prompt.text, /Continue this discussion in OpenCode\./);
  });

  await test('planning task board lists durable repo-state tasks without treating missing overlays as an error', async () => {
    const recorded = [];
    const routes = register({
      PLANNING_API_CONTRACT_VERSION: 'stale_planning_contract',
      sendJson(res, code, payload) {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload));
      },
      sessions: {
        listRepoStateTasks(copilotHome, repoId) {
          recorded.push({ copilotHome, repoId });
          return [{
            taskId: 'TASK-1',
            title: 'Primary planning task',
            status: 'ready',
            ownerSessionId: null,
            activeActorId: 'implementer',
            activeActorLabel: 'Implementer',
            workflow: {
              latestRunId: null,
            },
            worktree: {
              mode: 'shared',
              worktreeId: null,
            },
            linkedPlanning: {
              backlogIds: ['RB-1'],
              roadmapIds: [],
            },
            durablePath: 'C:\\copilot\\repo-state\\instruction-engine\\tasks\\TASK-1.json',
          }];
        },
      },
    });

    const { res, body } = await invoke(routes, 'GET', '/api/planning/task-board?repoId=instruction-engine&repoLabel=Instruction%20Engine', {
      copilotHome: 'C:\\copilot',
      copilotHomeAbs: 'C:\\copilot',
    });

    assert.equal(res.statusCode, 200);
    assert.equal(body.contractVersion, PLANNING_API_CONTRACT_VERSION);
    assert.equal(body.kind, 'planning.task-board');
    assert.equal(body.deterministic, true);
    assert.deepEqual(recorded, [{
      copilotHome: 'C:\\copilot',
      repoId: 'instruction-engine',
    }]);
    assert.equal(body.projection.repo.repoId, 'instruction-engine');
    assert.equal(body.projection.repo.repoLabel, 'Instruction Engine');
    assert.equal(body.projection.taskBoard.items.length, 1);
    assert.equal(body.projection.taskBoard.items[0].taskId, 'TASK-1');
    assert.equal(body.projection.taskBoard.items[0].projection.durableStore, 'repo-state');
    assert.equal(body.projection.taskBoard.items[0].ownerSessionId, null);
    assert.equal(body.projection.taskBoard.items[0].activeActorId, 'implementer');
    assert.equal(body.projection.taskBoard.items[0].activeActorLabel, 'Implementer');
    assert.deepEqual(body.projection.actors.items, []);
    assert.equal(body.projection.actors.activeActorId, null);
  });

  if (!process.exitCode) {
    console.log(`Planning route tests passed: ${passed}`);
  }
}

run();
