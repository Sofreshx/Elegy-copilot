'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { register } = require('./desktopUpdater');

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

async function invoke(routes, method, pathname) {
  const route = findRoute(routes, method, pathname);
  const req = { method };
  const res = createResponse();
  const u = new URL(`http://127.0.0.1${pathname}`);
  route.handler({ req, res, u, pathname });
  await new Promise((resolve) => setTimeout(resolve, 0));
  return {
    statusCode: res.statusCode,
    body: JSON.parse(res.bodyText || '{}'),
  };
}

test('desktop updater routes delegate state, check, download, and restart actions to the controller', async () => {
  const calls = [];
  const routes = register({
    desktopUpdaterController: {
      getState() {
        calls.push('getState');
        return { status: 'idle' };
      },
      async checkForUpdates() {
        calls.push('checkForUpdates');
        return { status: 'checking' };
      },
      async downloadUpdate() {
        calls.push('downloadUpdate');
        return { status: 'downloading' };
      },
      async restartToUpdate() {
        calls.push('restartToUpdate');
        return true;
      },
    },
  });

  assert.deepEqual(await invoke(routes, 'GET', '/api/desktop-updater'), {
    statusCode: 200,
    body: { status: 'idle' },
  });
  assert.deepEqual(await invoke(routes, 'POST', '/api/desktop-updater/check'), {
    statusCode: 200,
    body: { status: 'checking' },
  });
  assert.deepEqual(await invoke(routes, 'POST', '/api/desktop-updater/download'), {
    statusCode: 200,
    body: { status: 'downloading' },
  });
  assert.deepEqual(await invoke(routes, 'POST', '/api/desktop-updater/restart'), {
    statusCode: 200,
    body: { ok: true },
  });
  assert.deepEqual(calls, ['getState', 'checkForUpdates', 'downloadUpdate', 'restartToUpdate']);
});