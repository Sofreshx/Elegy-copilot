'use strict';

const assert = require('node:assert/strict');

const { register } = require('./dashboard');

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
    headers: null,
    chunks: [],
  };

  return {
    get statusCode() { return state.statusCode; },
    get bodyText() { return state.chunks.join(''); },
    writeHead(statusCode, headers) {
      state.statusCode = statusCode;
      state.headers = headers;
    },
    write(chunk) {
      if (chunk != null) state.chunks.push(String(chunk));
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

function createSendJson() {
  return (res, code, payload) => {
    res.writeHead(code, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify(payload, null, 2));
  };
}

function findRoute(routes, method, pathname) {
  for (const route of routes) {
    if (route.method !== method) continue;
    if (typeof route.path === 'string' && route.path === pathname) {
      return { route, match: null };
    }
    if (route.path instanceof RegExp) {
      const match = pathname.match(route.path);
      if (match) return { route, match };
    }
  }
  throw new Error(`Route not found for ${method} ${pathname}`);
}

function invoke(routes, ctx, method, pathname) {
  const res = createResponse();
  const u = new URL(`http://127.0.0.1${pathname}`);
  const { route, match } = findRoute(routes, method, u.pathname);
  route.handler({
    ...ctx,
    req: { method },
    res,
    u,
    match,
    pathname: u.pathname,
  });
  return { res, body: parseJsonBody(res) };
}

// --- Fixture helpers ---

function makeSessions(specs) {
  return specs.map((s) => ({
    id: s.id || 'sess-' + Math.random().toString(36).slice(2, 8),
    storageId: s.storageId || s.id || 'store-1',
    repo: s.repo || null,
    repoId: s.repoId || null,
    projectId: s.projectId || null,
    branch: s.branch || null,
    cwd: s.cwd || null,
    mode: s.mode || null,
    startTime: s.startTime || null,
    lastEventTime: s.lastEventTime || null,
    status: s.status || 'idle',
  }));
}

function createMockSessions(sessions) {
  return {
    listSessions() { return sessions; },
    readRecentEvents() { return []; },
  };
}

function registerWithMocks(overrides = {}) {
  return register({
    sendJson: createSendJson(),
    sessionAggregation: null,
    repoInventory: {
      loadRepoInventoryState() {
        return {
          manualRepos: [
            {
              repoId: 'proj-a',
              repoPath: '/home/user/my-repo',
              canonicalRemote: 'owner/my-repo',
            },
          ],
        };
      },
    },
    ...overrides,
  });
}

// --- Tests ---

async function run() {
  console.log('\nDashboard Route Tests\n');

  // --- register shape ---
  await test('register returns 3 route descriptors', async () => {
    const routes = registerWithMocks({ sessions: createMockSessions([]) });
    assert.equal(routes.length, 3);
    assert.equal(routes[0].method, 'GET');
    assert.equal(routes[0].path, '/api/dashboard/summary');
    assert.equal(routes[1].method, 'GET');
    assert.ok(routes[1].path instanceof RegExp);
    assert.equal(routes[2].method, 'GET');
    assert.ok(routes[2].path instanceof RegExp);
  });

  // --- GET /api/dashboard/summary ---

  await test('dashboard summary returns correct shape with counts and health', async () => {
    const sessions = makeSessions([
      { id: 's1', status: 'active', lastEventTime: 3000 },
      { id: 's2', status: 'idle', lastEventTime: 2000 },
      { id: 's3', status: 'active', lastEventTime: 1000 },
    ]);
    const routes = registerWithMocks({ sessions: createMockSessions(sessions) });
    const { res, body } = invoke(routes, { copilotHome: '/fake' }, 'GET', '/api/dashboard/summary');

    assert.equal(res.statusCode, 200);
    assert.equal(body.activeSessionCount, 2);
    assert.equal(body.totalSessionCount, 3);
    assert.equal(body.healthIndicator, 'ok');
    assert.ok(Array.isArray(body.recentActivity));
    assert.equal(body.recentActivity.length, 3);
  });

  await test('dashboard summary returns ok health for empty sessions', async () => {
    const routes = registerWithMocks({ sessions: createMockSessions([]) });
    const { res, body } = invoke(routes, { copilotHome: '/fake' }, 'GET', '/api/dashboard/summary');

    assert.equal(res.statusCode, 200);
    assert.equal(body.activeSessionCount, 0);
    assert.equal(body.totalSessionCount, 0);
    assert.equal(body.healthIndicator, 'ok');
    assert.deepEqual(body.recentActivity, []);
  });

  await test('dashboard summary returns degraded health when sessions have failed status', async () => {
    const sessions = makeSessions([
      { id: 's1', status: 'active', lastEventTime: 2000 },
      { id: 's2', status: 'failed', lastEventTime: 1000 },
    ]);
    const routes = registerWithMocks({ sessions: createMockSessions(sessions) });
    const { res, body } = invoke(routes, { copilotHome: '/fake' }, 'GET', '/api/dashboard/summary');

    assert.equal(res.statusCode, 200);
    assert.equal(body.healthIndicator, 'degraded');
  });

  await test('dashboard summary returns degraded health when sessions have missing status', async () => {
    const sessions = makeSessions([
      { id: 's1', status: 'missing', lastEventTime: 2000 },
    ]);
    const routes = registerWithMocks({ sessions: createMockSessions(sessions) });
    const { res, body } = invoke(routes, { copilotHome: '/fake' }, 'GET', '/api/dashboard/summary');

    assert.equal(res.statusCode, 200);
    assert.equal(body.healthIndicator, 'degraded');
  });

  await test('dashboard summary returns error health when sessions have error status', async () => {
    const sessions = makeSessions([
      { id: 's1', status: 'active', lastEventTime: 3000 },
      { id: 's2', status: 'error', lastEventTime: 1000 },
    ]);
    const routes = registerWithMocks({ sessions: createMockSessions(sessions) });
    const { res, body } = invoke(routes, { copilotHome: '/fake' }, 'GET', '/api/dashboard/summary');

    assert.equal(res.statusCode, 200);
    assert.equal(body.healthIndicator, 'error');
  });

  await test('dashboard summary limits recent activity to 10 items', async () => {
    const sessions = makeSessions(
      Array.from({ length: 15 }, (_, i) => ({
        id: `s${i}`,
        status: 'idle',
        lastEventTime: 1000 + i,
      })),
    );
    const routes = registerWithMocks({ sessions: createMockSessions(sessions) });
    const { body } = invoke(routes, { copilotHome: '/fake' }, 'GET', '/api/dashboard/summary');

    assert.equal(body.recentActivity.length, 10);
  });

  await test('dashboard summary recent activity is sorted by timestamp descending', async () => {
    const sessions = makeSessions([
      { id: 's1', status: 'idle', lastEventTime: 1000 },
      { id: 's2', status: 'idle', lastEventTime: 3000 },
      { id: 's3', status: 'idle', lastEventTime: 2000 },
    ]);
    const routes = registerWithMocks({ sessions: createMockSessions(sessions) });
    const { body } = invoke(routes, { copilotHome: '/fake' }, 'GET', '/api/dashboard/summary');

    assert.equal(body.recentActivity[0].timestamp, 3000);
    assert.equal(body.recentActivity[1].timestamp, 2000);
    assert.equal(body.recentActivity[2].timestamp, 1000);
  });

  // --- GET /api/projects/:id/sessions ---

  await test('project sessions filters by projectId', async () => {
    const sessions = makeSessions([
      { id: 's1', projectId: 'proj-a', status: 'active', lastEventTime: 2000 },
      { id: 's2', projectId: 'proj-b', status: 'idle', lastEventTime: 1000 },
      { id: 's3', projectId: 'proj-a', status: 'idle', lastEventTime: 500 },
    ]);
    const routes = registerWithMocks({ sessions: createMockSessions(sessions) });
    const { res, body } = invoke(routes, { copilotHome: '/fake' }, 'GET', '/api/projects/proj-a/sessions');

    assert.equal(res.statusCode, 200);
    assert.ok(Array.isArray(body));
    assert.equal(body.length, 2);
    assert.ok(body.every((s) => s.projectId === 'proj-a'));
  });

  await test('project sessions filters by repo field', async () => {
    const sessions = makeSessions([
      { id: 's1', repo: '/home/user/my-repo', status: 'active', lastEventTime: 2000 },
      { id: 's2', repo: '/home/user/other-repo', status: 'idle', lastEventTime: 1000 },
    ]);
    const routes = registerWithMocks({ sessions: createMockSessions(sessions) });
    const { res, body } = invoke(
      routes,
      { copilotHome: '/fake' },
      'GET',
      '/api/projects/%2Fhome%2Fuser%2Fmy-repo/sessions',
    );

    assert.equal(res.statusCode, 200);
    assert.equal(body.length, 1);
    assert.equal(body[0].id, 's1');
  });

  await test('project sessions matches tracked project repoPath through cwd', async () => {
    const sessions = makeSessions([
      { id: 's1', cwd: '/home/user/my-repo', status: 'active', lastEventTime: 2000 },
      { id: 's2', cwd: '/home/user/other-repo', status: 'idle', lastEventTime: 1000 },
    ]);
    const routes = registerWithMocks({ sessions: createMockSessions(sessions) });
    const { res, body } = invoke(routes, { copilotHome: '/fake', copilotHomeAbs: '/fake' }, 'GET', '/api/projects/proj-a/sessions');

    assert.equal(res.statusCode, 200);
    assert.equal(body.length, 1);
    assert.equal(body[0].id, 's1');
  });

  await test('project sessions returns empty array when no sessions match', async () => {
    const sessions = makeSessions([
      { id: 's1', projectId: 'proj-a', status: 'idle', lastEventTime: 1000 },
    ]);
    const routes = registerWithMocks({ sessions: createMockSessions(sessions) });
    const { res, body } = invoke(routes, { copilotHome: '/fake' }, 'GET', '/api/projects/nonexistent/sessions');

    assert.equal(res.statusCode, 200);
    assert.ok(Array.isArray(body));
    assert.equal(body.length, 0);
  });

  // --- GET /api/projects/:id/activity ---

  await test('project activity returns activity sorted by timestamp desc', async () => {
    const sessions = makeSessions([
      { id: 's1', projectId: 'proj-a', status: 'active', lastEventTime: 1000 },
      { id: 's2', projectId: 'proj-a', status: 'idle', lastEventTime: 3000 },
      { id: 's3', projectId: 'proj-a', status: 'idle', lastEventTime: 2000 },
    ]);
    const routes = registerWithMocks({ sessions: createMockSessions(sessions) });
    const { res, body } = invoke(routes, { copilotHome: '/fake' }, 'GET', '/api/projects/proj-a/activity');

    assert.equal(res.statusCode, 200);
    assert.ok(Array.isArray(body));
    assert.equal(body.length, 3);
    assert.equal(body[0].type, 'session');
    assert.equal(body[0].timestamp, 3000);
    assert.equal(body[1].timestamp, 2000);
    assert.equal(body[2].timestamp, 1000);
  });

  await test('project activity matches tracked project by canonical remote', async () => {
    const sessions = makeSessions([
      { id: 's1', status: 'active', lastEventTime: 4000 },
    ]);
    sessions[0].repository = { fullName: 'owner/my-repo' };
    const routes = registerWithMocks({ sessions: createMockSessions(sessions) });
    const { res, body } = invoke(routes, { copilotHome: '/fake', copilotHomeAbs: '/fake' }, 'GET', '/api/projects/proj-a/activity');

    assert.equal(res.statusCode, 200);
    assert.equal(body.length, 1);
    assert.equal(body[0].timestamp, 4000);
  });

  await test('project activity limits to 20 items', async () => {
    const sessions = makeSessions(
      Array.from({ length: 25 }, (_, i) => ({
        id: `s${i}`,
        projectId: 'proj-a',
        status: 'idle',
        lastEventTime: 1000 + i,
      })),
    );
    const routes = registerWithMocks({ sessions: createMockSessions(sessions) });
    const { body } = invoke(routes, { copilotHome: '/fake' }, 'GET', '/api/projects/proj-a/activity');

    assert.equal(body.length, 20);
    // Most recent first
    assert.equal(body[0].timestamp, 1024);
    assert.equal(body[19].timestamp, 1005);
  });

  await test('project activity returns empty array for nonexistent project', async () => {
    const sessions = makeSessions([
      { id: 's1', projectId: 'proj-a', status: 'idle', lastEventTime: 1000 },
    ]);
    const routes = registerWithMocks({ sessions: createMockSessions(sessions) });
    const { res, body } = invoke(routes, { copilotHome: '/fake' }, 'GET', '/api/projects/nonexistent/activity');

    assert.equal(res.statusCode, 200);
    assert.ok(Array.isArray(body));
    assert.equal(body.length, 0);
  });

  // --- Fallback: sessionAggregation not available ---

  await test('dashboard summary works when sessionAggregation is not available', async () => {
    // The mock sessions lib is used as fallback when sessionAggregation doesn't exist
    const sessions = makeSessions([
      { id: 's1', status: 'active', lastEventTime: 5000 },
    ]);
    const routes = registerWithMocks({ sessions: createMockSessions(sessions) });
    const { res, body } = invoke(routes, { copilotHome: '/fake' }, 'GET', '/api/dashboard/summary');

    assert.equal(res.statusCode, 200);
    assert.equal(body.activeSessionCount, 1);
    assert.equal(body.totalSessionCount, 1);
  });

  // --- Error handling ---

  await test('dashboard summary returns 500 when sessions lib throws', async () => {
    const brokenSessions = {
      listSessions() { throw new Error('disk read failed'); },
    };
    const routes = registerWithMocks({ sessions: brokenSessions });
    const { res, body } = invoke(routes, { copilotHome: '/fake' }, 'GET', '/api/dashboard/summary');

    assert.equal(res.statusCode, 500);
    assert.equal(body.error, 'dashboard_summary_failed');
  });

  await test('project sessions returns 500 when sessions lib throws', async () => {
    const brokenSessions = {
      listSessions() { throw new Error('disk read failed'); },
    };
    const routes = registerWithMocks({ sessions: brokenSessions });
    const { res, body } = invoke(routes, { copilotHome: '/fake' }, 'GET', '/api/projects/proj-a/sessions');

    assert.equal(res.statusCode, 500);
    assert.equal(body.error, 'project_sessions_failed');
  });

  await test('project activity returns 500 when sessions lib throws', async () => {
    const brokenSessions = {
      listSessions() { throw new Error('disk read failed'); },
    };
    const routes = registerWithMocks({ sessions: brokenSessions });
    const { res, body } = invoke(routes, { copilotHome: '/fake' }, 'GET', '/api/projects/proj-a/activity');

    assert.equal(res.statusCode, 500);
    assert.equal(body.error, 'project_activity_failed');
  });

  // --- Summary activity item shape ---
  await test('recent activity items have correct shape', async () => {
    const sessions = makeSessions([
      { id: 'my-session', status: 'active', lastEventTime: 9999 },
    ]);
    const routes = registerWithMocks({ sessions: createMockSessions(sessions) });
    const { body } = invoke(routes, { copilotHome: '/fake' }, 'GET', '/api/dashboard/summary');

    const item = body.recentActivity[0];
    assert.equal(item.type, 'session');
    assert.equal(item.timestamp, 9999);
    assert.ok(typeof item.summary === 'string');
    assert.ok(item.summary.includes('my-session'));
  });

  if (!process.exitCode) {
    console.log(`\ndashboard route tests passed (${passed})`);
  }
}

run().catch((error) => {
  console.error('dashboard route tests failed');
  console.error(error);
  process.exitCode = 1;
});
