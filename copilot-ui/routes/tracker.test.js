'use strict';

const assert = require('node:assert/strict');

const { register } = require('./tracker');

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
    get headers() {
      return state.headers;
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
    write(chunk) {
      if (chunk != null) {
        state.chunks.push(String(chunk));
      }
      return true;
    },
  };
}

function findRoute(routes, method, pathname) {
  for (const route of routes) {
    if (route.method !== method) {
      continue;
    }

    if (typeof route.path === 'string' && route.path === pathname) {
      return { route, match: null };
    }

    if (route.path instanceof RegExp) {
      const match = pathname.match(route.path);
      if (match) {
        return { route, match };
      }
    }
  }

  throw new Error(`Route not found for ${method} ${pathname}`);
}

function parseJson(text) {
  return JSON.parse(String(text || '').trim() || '{}');
}

async function invoke(routes, method, pathname) {
  const { route, match } = findRoute(routes, method, pathname);
  const req = {};
  const res = createResponse();
  const u = new URL(`http://127.0.0.1${pathname}`);

  route.handler({ req, res, u, match, pathname, providerState: {} });
  await sleep(0);
  return { req, res };
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

async function run() {
  await test('WS05-I2 local pre-proxy guard short-circuits with canonical envelope and proxy count 0', async () => {
    let proxyCount = 0;

    const routes = register({
      sendJson: createSendJson(),
      proxyToTracker() {
        proxyCount += 1;
      },
      trackerUrl: 'http://127.0.0.1:4100',
      trackerToken: '',
    });

    const { res } = await invoke(routes, 'GET', '/api/tracker/status');
    const body = parseJson(res.bodyText);

    assert.equal(proxyCount, 0);
    assert.equal(res.statusCode, 502);
    assert.equal(body.status, 'token_missing');
    assert.equal(body.code, 'MISSING_SANDBOX_TOKEN');
    assert.equal(body.reason, 'token_missing');
    assert.equal(body.legacyCode, 'tracker_token_missing');
    assert.equal(body.legacyReason, 'tracker_token_missing');
    assert.equal(
      body.message,
      'Tracker token not configured. Set --tracker-token or INSTRUCTION_ENGINE_GATEWAY_HTTP_TOKEN.'
    );
  });

  await test('WS05-I3 token-present path proxies once without local remap', async () => {
    let proxyCount = 0;

    const routes = register({
      sendJson: createSendJson(),
      proxyToTracker(_trackerUrl, _trackerToken, _path, _method, _req, res) {
        proxyCount += 1;
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        res.end('{"ok":true,"path":"/api/status"}');
      },
      trackerUrl: 'http://127.0.0.1:4100',
      trackerToken: 'ws2-token',
    });

    const { res } = await invoke(routes, 'GET', '/api/tracker/status');

    assert.equal(proxyCount, 1);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(parseJson(res.bodyText), { ok: true, path: '/api/status' });
  });

  console.log(`\n${passed} tests passed`);
  if (process.exitCode) {
    console.error('Some tests FAILED');
  } else {
    console.log('All tests passed');
  }
}

run();
