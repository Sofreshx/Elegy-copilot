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
  const route = routes.find((candidate) => {
    if (candidate.method !== method) {
      return false;
    }
    if (typeof candidate.path === 'string') {
      return candidate.path === pathname;
    }
    if (candidate.path instanceof RegExp) {
      return candidate.path.test(pathname);
    }
    return false;
  });
  if (!route) {
    throw new Error(`Route not found: ${method} ${pathname}`);
  }
  return route;
}

async function invoke(routes, method, pathname, ctx) {
  const u = new URL(`http://127.0.0.1${pathname}`);
  const route = findRoute(routes, method, u.pathname);
  const match = route.path instanceof RegExp ? u.pathname.match(route.path) : null;
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
    match,
    ...ctx,
  });

  await new Promise((resolve) => setTimeout(resolve, 0));
  return {
    res,
    body: parseJsonBody(res),
  };
}

async function run() {
  await test('planning live roadmaps list filters by selected repo tag', async () => {
    const routes = register({
      PLANNING_API_CONTRACT_VERSION: 'stale_planning_contract',
      sendJson(res, code, payload) {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload));
      },
      roadmapWorkflowPlanningBridge: {
        async listRoadmaps(input) {
          assert.equal(input.requestId, 'repo-1');
          return {
            roadmaps: [
              {
                id: 'RM-one',
                goalId: 'GOAL-one',
                title: 'Roadmap One',
                status: 'active',
                tags: ['repo:repo-1'],
              },
              {
                id: 'RM-two',
                goalId: 'GOAL-two',
                title: 'Roadmap Two',
                status: 'finished',
                tags: ['repo:repo-2'],
              },
            ],
          };
        },
      },
    });

    const { res, body } = await invoke(routes, 'GET', '/api/planning/live/roadmaps?repoId=repo-1&repoLabel=Repo%201', {});

    assert.equal(res.statusCode, 200);
    assert.equal(body.contractVersion, PLANNING_API_CONTRACT_VERSION);
    assert.equal(body.kind, 'planning.live.roadmaps');
    assert.equal(body.count, 1);
    assert.deepEqual(body.repo, {
      repoId: 'repo-1',
      repoPath: '',
      repoLabel: 'Repo 1',
      repoBasename: '',
    });
    assert.deepEqual(body.roadmaps.map((entry) => entry.id), ['RM-one']);
  });

  await test('planning live roadmaps list matches selected repo by repo path or label metadata', async () => {
    const routes = register({
      PLANNING_API_CONTRACT_VERSION: 'stale_planning_contract',
      sendJson(res, code, payload) {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload));
      },
      roadmapWorkflowPlanningBridge: {
        async listRoadmaps(input) {
          assert.equal(input.requestId, 'C:\\Users\\lolzi\\source\\repos\\SAASTools');
          return {
            roadmaps: [
              {
                id: 'RM-path',
                goalId: 'GOAL-one',
                title: 'Path matched roadmap',
                status: 'active',
                repoPath: 'C:/Users/lolzi/source/repos/SAASTools',
              },
              {
                id: 'RM-label',
                goalId: 'GOAL-two',
                title: 'Label matched roadmap',
                status: 'draft',
                repoLabel: 'Holon-Repo',
              },
              {
                id: 'RM-other',
                goalId: 'GOAL-three',
                title: 'Other roadmap',
                status: 'finished',
                repoPath: 'C:/elsewhere',
                repoLabel: 'Other',
              },
            ],
          };
        },
      },
    });

    const { res, body } = await invoke(
      routes,
      'GET',
      '/api/planning/live/roadmaps?repoPath=C%3A%5CUsers%5Clolzi%5Csource%5Crepos%5CSAASTools&repoLabel=holon-repo',
      {},
    );

    assert.equal(res.statusCode, 200);
    assert.equal(body.contractVersion, PLANNING_API_CONTRACT_VERSION);
    assert.equal(body.kind, 'planning.live.roadmaps');
    assert.equal(body.count, 2);
    assert.deepEqual(body.roadmaps.map((entry) => entry.id), ['RM-path', 'RM-label']);
  });

  await test('planning live goals list filters by selected repo tag', async () => {
    const routes = register({
      PLANNING_API_CONTRACT_VERSION: 'stale_planning_contract',
      sendJson(res, code, payload) {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload));
      },
      roadmapWorkflowPlanningBridge: {
        async listGoals(input) {
          assert.equal(input.requestId, 'repo-1');
          return {
            goals: [
              {
                id: 'GOAL-one',
                title: 'Goal One',
                status: 'active',
                tags: ['repo:repo-1'],
              },
              {
                id: 'GOAL-two',
                title: 'Goal Two',
                status: 'finished',
                tags: ['repo:repo-2'],
              },
            ],
          };
        },
      },
    });

    const { res, body } = await invoke(routes, 'GET', '/api/planning/live/goals?repoId=repo-1&repoLabel=Repo%201', {});

    assert.equal(res.statusCode, 200);
    assert.equal(body.contractVersion, PLANNING_API_CONTRACT_VERSION);
    assert.equal(body.kind, 'planning.live.goals');
    assert.equal(body.count, 1);
    assert.deepEqual(body.goals.map((entry) => entry.id), ['GOAL-one']);
  });

  await test('planning live goals list includes unscoped goals by default and can exclude them', async () => {
    const bridge = {
      async listGoals() {
        return {
          goals: [
            { id: 'GOAL-unscoped', title: 'Unscoped Goal', tags: [] },
            { id: 'GOAL-other', title: 'Other Goal', tags: ['repo:other'] },
          ],
        };
      },
    };
    const routes = register({
      PLANNING_API_CONTRACT_VERSION: 'stale_planning_contract',
      sendJson(res, code, payload) {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload));
      },
      roadmapWorkflowPlanningBridge: bridge,
    });

    const included = await invoke(routes, 'GET', '/api/planning/live/goals?repoId=repo-1', {});
    assert.equal(included.res.statusCode, 200);
    assert.deepEqual(included.body.goals.map((entry) => entry.id), ['GOAL-unscoped']);

    const excluded = await invoke(routes, 'GET', '/api/planning/live/goals?repoId=repo-1&includeUnscoped=false', {});
    assert.equal(excluded.res.statusCode, 200);
    assert.deepEqual(excluded.body.goals.map((entry) => entry.id), []);
  });

  await test('planning live roadmap detail rejects repo scope mismatches', async () => {
    const routes = register({
      PLANNING_API_CONTRACT_VERSION: 'stale_planning_contract',
      sendJson(res, code, payload) {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload));
      },
      roadmapWorkflowPlanningBridge: {
        async showRoadmap(input) {
          assert.equal(input.roadmapId, 'RM-one');
          return {
            roadmap: {
              id: 'RM-one',
              goalId: 'GOAL-one',
              title: 'Roadmap One',
              tags: ['repo:repo-2'],
            },
            sections: [],
            workPoints: [],
            validation: {
              status: 'valid',
              findings: [],
            },
          };
        },
      },
    });

    const { res, body } = await invoke(routes, 'GET', '/api/planning/live/roadmaps/RM-one?repoId=repo-1', {});

    assert.equal(res.statusCode, 404);
    assert.equal(body.contractVersion, PLANNING_API_CONTRACT_VERSION);
    assert.equal(body.kind, 'planning.live.roadmap');
    assert.equal(body.code, 'planning_live_repo_scope_mismatch');
    assert.equal(body.reason, 'planning_live_repo_scope_mismatch');
  });

  await test('planning live plan detail accepts repo path scoped matches without repo tag', async () => {
    const routes = register({
      PLANNING_API_CONTRACT_VERSION: 'stale_planning_contract',
      sendJson(res, code, payload) {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload));
      },
      roadmapWorkflowPlanningBridge: {
        async showPlan(input) {
          assert.equal(input.planId, 'PLAN-path');
          return {
            plan: {
              id: 'PLAN-path',
              roadmapId: 'RM-one',
              title: 'Plan Path',
              repoPath: 'C:/Users/lolzi/source/repos/SAASTools',
            },
            todos: [{ id: 'TODO-one', planId: 'PLAN-path', repoPath: 'C:/Users/lolzi/source/repos/SAASTools' }],
            reviewPoints: [],
            validation: {
              status: 'valid',
              findings: [],
            },
          };
        },
      },
    });

    const { res, body } = await invoke(
      routes,
      'GET',
      '/api/planning/live/plans/PLAN-path?repoPath=C%3A%5CUsers%5Clolzi%5Csource%5Crepos%5CSAASTools',
      {},
    );

    assert.equal(res.statusCode, 200);
    assert.equal(body.contractVersion, PLANNING_API_CONTRACT_VERSION);
    assert.equal(body.kind, 'planning.live.plan');
    assert.equal(body.plan.id, 'PLAN-path');
  });

  await test('planning live plan detail returns plan todos and validation', async () => {
    const routes = register({
      PLANNING_API_CONTRACT_VERSION: 'stale_planning_contract',
      sendJson(res, code, payload) {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload));
      },
      roadmapWorkflowPlanningBridge: {
        async showPlan(input) {
          assert.equal(input.planId, 'PLAN-one');
          return {
            plan: {
              id: 'PLAN-one',
              roadmapId: 'RM-one',
              title: 'Plan One',
              tags: ['repo:repo-1'],
            },
            todos: [{ id: 'TODO-one', planId: 'PLAN-one', tags: ['repo:repo-1'] }],
            reviewPoints: [{ id: 'REVIEW-one' }],
            validation: {
              status: 'warning',
              findings: [{ code: 'PLAN-NO-VALIDATION-STEPS' }],
            },
          };
        },
      },
    });

    const { res, body } = await invoke(routes, 'GET', '/api/planning/live/plans/PLAN-one?repoId=repo-1', {});

    assert.equal(res.statusCode, 200);
    assert.equal(body.contractVersion, PLANNING_API_CONTRACT_VERSION);
    assert.equal(body.kind, 'planning.live.plan');
    assert.equal(body.plan.id, 'PLAN-one');
    assert.equal(body.todos.length, 1);
    assert.equal(body.reviewPoints.length, 1);
    assert.equal(body.validation.status, 'warning');
  });

  await test('planning live todos list can filter by roadmap through plan linkage', async () => {
    const routes = register({
      PLANNING_API_CONTRACT_VERSION: 'stale_planning_contract',
      sendJson(res, code, payload) {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload));
      },
      roadmapWorkflowPlanningBridge: {
        async listPlans(input) {
          assert.equal(input.requestId, 'RM-one');
          return {
            plans: [
              { id: 'PLAN-one', roadmapId: 'RM-one', tags: ['repo:repo-1'] },
              { id: 'PLAN-two', roadmapId: 'RM-two', tags: ['repo:repo-1'] },
            ],
          };
        },
        async listTodos(input) {
          assert.equal(input.requestId, 'RM-one');
          return {
            todos: [
              { id: 'TODO-one', planId: 'PLAN-one', tags: ['repo:repo-1'] },
              { id: 'TODO-two', planId: 'PLAN-two', tags: ['repo:repo-1'] },
              { id: 'TODO-three', planId: 'PLAN-one', tags: ['repo:repo-2'] },
            ],
          };
        },
      },
    });

    const { res, body } = await invoke(routes, 'GET', '/api/planning/live/todos?repoId=repo-1&roadmapId=RM-one', {});

    assert.equal(res.statusCode, 200);
    assert.equal(body.contractVersion, PLANNING_API_CONTRACT_VERSION);
    assert.equal(body.kind, 'planning.live.todos');
    assert.equal(body.count, 1);
    assert.deepEqual(body.todos.map((entry) => entry.id), ['TODO-one']);
  });

  await test('planning live todos list uses repo label matching for roadmap-linked plans', async () => {
    const routes = register({
      PLANNING_API_CONTRACT_VERSION: 'stale_planning_contract',
      sendJson(res, code, payload) {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload));
      },
      roadmapWorkflowPlanningBridge: {
        async listPlans(input) {
          assert.equal(input.requestId, 'RM-label');
          return {
            plans: [
              { id: 'PLAN-label', roadmapId: 'RM-label', repoLabel: 'Holon-Repo' },
              { id: 'PLAN-other', roadmapId: 'RM-label', repoLabel: 'Other Repo' },
            ],
          };
        },
        async listTodos(input) {
          assert.equal(input.requestId, 'RM-label');
          return {
            todos: [
              { id: 'TODO-label', planId: 'PLAN-label', repoLabel: 'holon-repo' },
              { id: 'TODO-other', planId: 'PLAN-other', repoLabel: 'Other Repo' },
            ],
          };
        },
      },
    });

    const { res, body } = await invoke(routes, 'GET', '/api/planning/live/todos?repoLabel=holon-repo&roadmapId=RM-label', {});

    assert.equal(res.statusCode, 200);
    assert.equal(body.contractVersion, PLANNING_API_CONTRACT_VERSION);
    assert.equal(body.kind, 'planning.live.todos');
    assert.equal(body.count, 1);
    assert.deepEqual(body.todos.map((entry) => entry.id), ['TODO-label']);
  });

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
        listRepoStateTasks(elegyHome, repoId) {
          recorded.push({ elegyHome, repoId });
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
      elegyHome: 'C:\\copilot',
      elegyHomeAbs: 'C:\\copilot',
    });

    assert.equal(res.statusCode, 200);
    assert.equal(body.contractVersion, PLANNING_API_CONTRACT_VERSION);
    assert.equal(body.kind, 'planning.task-board');
    assert.equal(body.deterministic, true);
    assert.deepEqual(recorded, [{
      elegyHome: 'C:\\copilot',
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

  await test('planning live authority-status returns bridge getStatus', async () => {
    const routes = register({
      PLANNING_API_CONTRACT_VERSION: 'stale_planning_contract',
      sendJson(res, code, payload) {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload));
      },
      roadmapWorkflowPlanningBridge: {
        getStatus() {
          return {
            ready: true,
            enabled: true,
            configured: true,
            cliPath: '/usr/bin/elegy-planning',
            dbPath: '/Users/test/.elegy/planning.db',
            code: 'planning_authority_ready',
            message: 'ready',
            dbResolution: {
              source: 'home-elegy',
              reason: 'selected home-elegy database (populated)',
              candidates: [
                { path: '/Users/test/.elegy/planning.db', source: 'home-elegy', exists: true, populated: true },
              ],
            },
          };
        },
      },
    });

    const { res, body } = await invoke(routes, 'GET', '/api/planning/live/authority-status', {});

    assert.equal(res.statusCode, 200);
    assert.equal(body.contractVersion, PLANNING_API_CONTRACT_VERSION);
    assert.equal(body.kind, 'planning.live.authority-status');
    assert.equal(body.ready, true);
    assert.equal(body.dbResolution.source, 'home-elegy');
    assert.equal(body.dbResolution.candidates.length, 1);
  });

  await test('planning live roadmaps list passes repoLabel to bridge', async () => {
    let receivedRepoLabel = null;
    const routes = register({
      PLANNING_API_CONTRACT_VERSION: 'stale_planning_contract',
      sendJson(res, code, payload) {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload));
      },
      roadmapWorkflowPlanningBridge: {
        async listRoadmaps(input) {
          receivedRepoLabel = input.repoLabel || null;
          return {
            roadmaps: [
              {
                id: 'RM-one',
                goalId: 'GOAL-one',
                title: 'Roadmap One',
                status: 'active',
                tags: ['holon'],
              },
            ],
          };
        },
      },
    });

    const { res, body } = await invoke(
      routes,
      'GET',
      '/api/planning/live/roadmaps?repoId=repo-1&repoLabel=holon&includeUnscoped=true',
      {},
    );

    assert.equal(res.statusCode, 200);
    assert.equal(receivedRepoLabel, 'holon');
    assert.equal(body.count, 1);
  });

  await test('planning live roadmaps list matches entities tagged with repo path basename alias', async () => {
    const routes = register({
      PLANNING_API_CONTRACT_VERSION: 'stale_planning_contract',
      sendJson(res, code, payload) {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload));
      },
      roadmapWorkflowPlanningBridge: {
        async listRoadmaps() {
          return {
            roadmaps: [
              {
                id: 'RM-basename',
                goalId: 'GOAL-one',
                title: 'Basename Matched',
                status: 'active',
                tags: ['repo:instruction-engine'],
              },
              {
                id: 'RM-other',
                goalId: 'GOAL-two',
                title: 'Other Roadmap',
                status: 'draft',
                tags: ['repo:elegy'],
              },
            ],
          };
        },
      },
    });

    const { res, body } = await invoke(
      routes,
      'GET',
      '/api/planning/live/roadmaps?repoId=74af0f7b5cc4&repoPath=C%3A%5CUsers%5Clolzi%5CDocuments%5CGitHub%5Cinstruction-engine&repoLabel=%40elegy-copilot%2Froot',
      {},
    );

    assert.equal(res.statusCode, 200);
    assert.equal(body.count, 1);
    assert.deepEqual(body.roadmaps.map((entry) => entry.id), ['RM-basename']);
  });

  await test('planning live goals list excludes unscoped goals for unrelated repo when no scope match', async () => {
    const routes = register({
      PLANNING_API_CONTRACT_VERSION: 'stale_planning_contract',
      sendJson(res, code, payload) {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload));
      },
      roadmapWorkflowPlanningBridge: {
        async listGoals() {
          return {
            goals: [
              {
                id: 'GOAL-draft',
                title: 'Draft Goal',
                status: 'draft',
                tags: ['repo:instruction-engine'],
              },
              {
                id: 'GOAL-other',
                title: 'Other Goal',
                status: 'active',
                tags: ['repo:other-repo'],
              },
            ],
          };
        },
      },
    });

    // Elegy repo (different from instruction-engine) should NOT see instruction-engine goals
    const { res, body } = await invoke(
      routes,
      'GET',
      '/api/planning/live/goals?repoId=abc123&repoPath=C%3A%5CUsers%5Clolzi%5CDocuments%5CGitHub%5CElegy&repoLabel=Elegy&includeUnscoped=false',
      {},
    );

    assert.equal(res.statusCode, 200);
    assert.equal(body.count, 0);
  });

  await test('planning live goal detail includes roadmaps matched via repo path basename alias', async () => {
    const routes = register({
      PLANNING_API_CONTRACT_VERSION: 'stale_planning_contract',
      sendJson(res, code, payload) {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload));
      },
      roadmapWorkflowPlanningBridge: {
        async showGoal(input) {
          assert.equal(input.goalId, 'GOAL-ie');
          return {
            goal: {
              id: 'GOAL-ie',
              title: 'Instruction Engine Goal',
              status: 'active',
              tags: ['repo:instruction-engine'],
            },
            roadmaps: [
              {
                id: 'RM-core',
                goalId: 'GOAL-ie',
                title: 'Core Roadmap',
                status: 'active',
                tags: ['repo:instruction-engine'],
              },
              {
                id: 'RM-other',
                goalId: 'GOAL-ie',
                title: 'Other Roadmap',
                status: 'draft',
                tags: ['repo:elegy'],
              },
            ],
            validation: { status: 'valid', findings: [] },
          };
        },
      },
    });

    const { res, body } = await invoke(
      routes,
      'GET',
      '/api/planning/live/goals/GOAL-ie?repoId=74af0f7b5cc4&repoPath=C%3A%5CUsers%5Clolzi%5CDocuments%5CGitHub%5Cinstruction-engine&repoLabel=%40elegy-copilot%2Froot',
      {},
    );

    assert.equal(res.statusCode, 200);
    assert.equal(body.kind, 'planning.live.goal');
    assert.equal(body.goal.id, 'GOAL-ie');
    assert.equal(body.roadmaps.length, 1);
    assert.deepEqual(body.roadmaps.map((entry) => entry.id), ['RM-core']);
  });

  if (!process.exitCode) {
    console.log(`Planning route tests passed: ${passed}`);
  }
}

run();
