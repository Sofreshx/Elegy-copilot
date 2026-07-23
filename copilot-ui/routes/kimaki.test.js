'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { register } = require('./kimaki');

test('registers the supported Remote API without legacy destructive routes', () => {
  const routes = register({});
  assert.deepEqual(
    routes.map((route) => `${route.method} ${route.path}`),
    [
      'GET /api/remote/status',
      'POST /api/remote/restart',
      'GET /api/remote/projects',
      'GET /api/remote/sessions',
      'POST /api/remote/send',
      'POST /api/remote/projects/add',
      'GET /api/remote/logs',
      'POST /api/remote/sessions/rename',
      'POST /api/remote/enable',
      'POST /api/remote/disable',
    ],
  );
});

function createContext(overrides = {}) {
  const responses = [];
  return {
    responses,
    context: {
      sendJson: (_res, status, body) => responses.push({ status, body }),
      ...overrides,
    },
  };
}

test('status explains when the Kimaki runtime is unavailable', () => {
  const { context, responses } = createContext();
  const route = register(context).find((candidate) => candidate.path === '/api/remote/status');
  route.handler({ res: {} });

  assert.equal(responses[0].status, 200);
  assert.equal(responses[0].body.available, false);
  assert.equal(responses[0].body.reason, 'kimaki_entrypoint_missing');
});

test('operational routes return a stable onboarding conflict before Discord is ready', async () => {
  const service = {
    getReady: () => false,
  };
  const { context, responses } = createContext({
    kimakiRuntimeService: service,
    kimakiCli: {},
    sqliteReader: {},
  });
  const route = register(context).find((candidate) => candidate.path === '/api/remote/projects');
  await route.handler({ res: {} });

  assert.equal(responses[0].status, 409);
  assert.deepEqual(responses[0].body, {
    error: 'remote_not_ready',
    code: 'remote_not_ready',
    message: 'Complete Discord setup before using remote sessions.',
  });
});

test('logs remain readable as an empty collection when the runtime is unavailable', () => {
  const { context, responses } = createContext();
  const route = register(context).find((candidate) => candidate.path === '/api/remote/logs');
  route.handler({ res: {}, u: new URL('http://localhost/api/remote/logs') });

  assert.deepEqual(responses[0], { status: 200, body: { lines: [] } });
});

test('session listing returns both pending OpenCode and connected Kimaki sessions', async () => {
  const service = {
    getReady: () => true,
    getDataDir: () => 'C:\\data',
    getGuildIds: () => ['guild-1'],
  };
  const { context, responses } = createContext({
    kimakiRuntimeService: service,
    kimakiCli: {},
    sqliteReader: {
      listProjects: () => [{ directory: 'C:\\repo' }],
      listOpenCodeSessions: () => [
        {
          sessionId: 'session-local',
          threadName: 'Local work',
          project: 'C:\\repo',
          updatedAt: '2026-06-19T10:00:00Z',
        },
        {
          sessionId: 'session-discord',
          threadName: 'Discord work',
          project: 'C:\\repo',
          updatedAt: '2026-06-19T11:00:00Z',
        },
      ],
      listSessions: () => [{
        sessionId: 'session-discord',
        threadId: 'thread-1',
        threadName: 'Discord work',
      }],
    },
  });
  const route = register(context).find((candidate) => candidate.path === '/api/remote/sessions');
  await route.handler({
    res: {},
    u: new URL('http://localhost/api/remote/sessions?limit=50'),
  });

  assert.equal(responses[0].status, 200);
  assert.deepEqual(
    responses[0].body.sessions.map((session) => ({
      sessionId: session.sessionId,
      syncStatus: session.syncStatus,
      threadId: session.threadId,
      discordUrl: session.discordUrl,
    })),
    [
      {
        sessionId: 'session-local',
        syncStatus: 'pending',
        threadId: null,
        discordUrl: null,
      },
      {
        sessionId: 'session-discord',
        syncStatus: 'connected',
        threadId: 'thread-1',
        discordUrl: 'https://discord.com/channels/guild-1/thread-1',
      },
    ],
  );
});

test('session storage failures use the stable remote error contract', async () => {
  const { context, responses } = createContext({
    kimakiRuntimeService: {
      getReady: () => true,
      getDataDir: () => 'C:\\data',
      getGuildIds: () => ['guild-1'],
    },
    kimakiCli: {},
    sqliteReader: {
      listProjects: () => [{ directory: 'C:\\repo' }],
      listOpenCodeSessions: () => {
        throw new Error('OpenCode database is unavailable');
      },
    },
  });
  const route = register(context).find((candidate) => candidate.path === '/api/remote/sessions');
  await route.handler({
    res: {},
    u: new URL('http://localhost/api/remote/sessions'),
  });

  assert.deepEqual(responses[0], {
    status: 500,
    body: {
      error: 'remote_storage_error',
      code: 'remote_storage_error',
      message: 'OpenCode database is unavailable',
    },
  });
});
