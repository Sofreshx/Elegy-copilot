'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { register } = require('./opencode');

function createResponse() {
  const state = { statusCode: null, headers: null, chunks: [] };
  return {
    get statusCode() { return state.statusCode; },
    get bodyText() { return state.chunks.join(''); },
    writeHead(statusCode, headers) { state.statusCode = statusCode; state.headers = headers; },
    end(chunk) { if (chunk != null) state.chunks.push(String(chunk)); },
  };
}

function findRoute(routes, method, pathname) {
  for (const route of routes) {
    if (route.method === method && route.path === pathname) return route;
  }
  throw new Error(`Route not found for ${method} ${pathname}`);
}

async function invoke(routes, method, pathname, options = {}) {
  const route = findRoute(routes, method, pathname);
  const req = { method };
  const res = createResponse();
  const u = new URL(`http://127.0.0.1${pathname}`);
  await route.handler({
    req,
    res,
    u,
    pathname,
    engineRoot: options.engineRoot,
    elegyHomeAbs: options.elegyHomeAbs,
    codexHome: options.codexHome,
    opencodeHome: options.opencodeHome,
    env: options.env,
  });
  return { statusCode: res.statusCode, body: JSON.parse(res.bodyText || '{}') };
}

test('GET /api/codex-planning-status no longer 500s when ctx.env is undefined (Win10 safety)', async () => {
  // Before the fix this route would throw:
  //   "Cannot read properties of undefined (reading 'INSTRUCTION_ENGINE_ELEGY_PLANNING_CLI_PATH')"
  // and return HTTP 500. After the fix it returns 200.
  const tmpElegy = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-codex-plan-'));
  const routes = register({
    childProcess: {
      spawnSync(_cmd, args) {
        if (args && args.includes('health') && args.includes('--json')) {
          return { stdout: JSON.stringify({ status: 'ok', data: { schemaVersion: '1.0.0' } }), stderr: '' };
        }
        return { stdout: 'elegy-planning 1.0.0', stderr: '' };
      },
    },
  });
  // Deliberately do NOT pass `env` so ctx.env is undefined.
  const result = await invoke(routes, 'GET', '/api/codex-planning-status', {
    engineRoot: '/repo',
    elegyHomeAbs: tmpElegy,
    codexHome: path.join(tmpElegy, '.codex'),
  });
  assert.notEqual(
    result.statusCode,
    500,
    `expected non-500 when ctx.env is missing, got: ${JSON.stringify(result.body)}`
  );
  assert.equal(typeof result.body.planningSkill, 'object', 'planningSkill should always be present');
  assert.equal(typeof result.body.planningSkill.installed, 'boolean');
});
