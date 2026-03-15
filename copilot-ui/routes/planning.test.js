'use strict';

const assert = require('node:assert/strict');

const {
  PLANNING_API_CONTRACT_VERSION,
} = require('@instruction-engine/contracts');
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

  if (!process.exitCode) {
    console.log(`Planning route tests passed: ${passed}`);
  }
}

run();
