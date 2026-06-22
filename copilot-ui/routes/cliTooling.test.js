'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { register } = require('./cliTooling');

function createResponse() {
  const state = {
    statusCode: null,
    headers: null,
    chunks: [],
  };

  return {
    get statusCode() {
      return state.statusCode;
    },
    get bodyText() {
      return state.chunks.join('');
    },
    writeHead(statusCode, headers) {
      state.statusCode = statusCode;
      state.headers = headers;
    },
    end(chunk) {
      if (chunk != null) {
        state.chunks.push(String(chunk));
      }
    },
  };
}

function findRoute(routes, method, pathname) {
  for (const route of routes) {
    if (route.method === method && route.path === pathname) {
      return route;
    }
  }

  throw new Error(`Route not found for ${method} ${pathname}`);
}

async function invoke(routes, method, pathname, options = {}) {
  const route = findRoute(routes, method, pathname);
  const req = {
    method,
    on() {},
    ...(options.reqBody ? {
      _bodyData: options.reqBody,
    } : {}),
  };
  const res = createResponse();
  const u = new URL(`http://127.0.0.1${pathname}`);

  // If reqBody is provided, wire up the body stream
  if (options.reqBody) {
    let handlers = {};
    req.on = function (event, handler) {
      handlers[event] = handler;
      return this;
    };
    // Simulate body delivery
    const bodyChunk = Buffer.from(JSON.stringify(options.reqBody), 'utf8');
    setTimeout(() => {
      if (handlers.data) {
        handlers.data(bodyChunk);
      }
      if (handlers.end) {
        handlers.end();
      }
    }, 0);
  }

  await route.handler({
    req,
    res,
    u,
    pathname,
  });
  return {
    statusCode: res.statusCode,
    body: JSON.parse(res.bodyText || '{}'),
  };
}

test('register returns 2 route descriptors', () => {
  const routes = register();
  assert.equal(routes.length, 2);
  assert.deepEqual(
    routes.map((route) => ({ method: route.method, path: route.path })),
    [
      { method: 'GET', path: '/api/tooling/cli/status' },
      { method: 'POST', path: '/api/tooling/cli/install' },
    ],
  );
});

test('GET /api/tooling/cli/status returns tools array', async () => {
  let capturedCommand = null;
  const childProcess = {
    execSync(command) {
      capturedCommand = command;
      return '1.0.0\n';
    },
    spawnSync(_cmd, _args) {
      return { status: 0, stdout: '1.0.0\n', stderr: '' };
    },
  };

  const routes = register({ childProcess });
  const { statusCode, body } = await invoke(routes, 'GET', '/api/tooling/cli/status');

  assert.equal(statusCode, 200);
  assert.equal(body.ok, true);
  assert.equal(Array.isArray(body.tools), true);
  assert.equal(body.tools.length, 5);
  assert.equal(typeof body.checkedAt, 'string');

  const opencodeCli = body.tools.find((tool) => tool.id === 'opencode-cli');
  assert.equal(opencodeCli.installed, true);
  assert.equal(opencodeCli.version, '1.0.0');
});

test('POST /api/tooling/cli/install without toolId returns 400', async () => {
  const routes = register();
  const { statusCode, body } = await invoke(routes, 'POST', '/api/tooling/cli/install', {
    reqBody: {},
  });

  assert.equal(statusCode, 400);
  assert.equal(body.ok, false);
  assert.ok(body.error.includes('toolId'));
});

test('POST /api/tooling/cli/install with unknown toolId returns 400', async () => {
  const routes = register();
  const { statusCode, body } = await invoke(routes, 'POST', '/api/tooling/cli/install', {
    reqBody: { toolId: 'unknown-cli' },
  });

  assert.equal(statusCode, 400);
  assert.equal(body.ok, false);
  assert.ok(body.error.includes('Unknown CLI tool'));
});

test('POST /api/tooling/cli/install with dryRun returns command', async () => {
  let execCalled = false;
  const childProcess = {
    execSync() {
      execCalled = true;
      return '';
    },
  };

  const routes = register({ childProcess });
  const { statusCode, body } = await invoke(routes, 'POST', '/api/tooling/cli/install', {
    reqBody: { toolId: 'opencode-cli', dryRun: true },
  });

  assert.equal(statusCode, 200);
  assert.equal(body.ok, true);
  assert.equal(body.dryRun, true);
  assert.ok(body.command.includes('npm install -g opencode-ai'));
  assert.equal(execCalled, false);
});

test('POST /api/tooling/cli/install calls execSync for real install', async () => {
  let capturedCommand = null;
  const childProcess = {
    execSync(command) {
      capturedCommand = command;
      return 'installed';
    },
  };

  const routes = register({ childProcess });
  const { statusCode, body } = await invoke(routes, 'POST', '/api/tooling/cli/install', {
    reqBody: { toolId: 'codex-cli' },
  });

  assert.equal(statusCode, 200);
  assert.equal(body.ok, true);
  assert.equal(body.toolId, 'codex-cli');
  assert.ok(body.command.includes('npm install -g @openai/codex@latest'));
  assert.ok(capturedCommand.includes('npm install -g @openai/codex@latest'));
});
