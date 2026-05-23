'use strict';

const assert = require('node:assert/strict');

const { register } = require('./hooks');

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
  const state = { statusCode: null, headers: null, chunks: [] };
  return {
    get statusCode() { return state.statusCode; },
    get bodyText() { return state.chunks.join(''); },
    writeHead(statusCode, headers) { state.statusCode = statusCode; state.headers = headers; },
    write(chunk) { if (chunk != null) state.chunks.push(String(chunk)); return true; },
    end(chunk) { if (chunk != null) state.chunks.push(String(chunk)); },
  };
}

function parseBody(response) {
  return JSON.parse(response.bodyText || '{}');
}

function createSendJson() {
  return (res, code, payload) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(payload, null, 2));
  };
}

function createReadJsonBody(bodyObj) {
  return async () => bodyObj;
}

function findRoute(routes, method, pathname) {
  for (const route of routes) {
    if (route.method !== method) continue;
    if (typeof route.path === 'string' && route.path === pathname) return { route, match: null };
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
  const result = route.handler({ ...ctx, req: { method }, res, u, match, pathname: u.pathname });
  if (result && typeof result.then === 'function') {
    return result.then(() => ({ res, body: parseBody(res) }));
  }
  return { res, body: parseBody(res) };
}

// --- Mock hook rules service ---

function createMockService(rules = []) {
  const overrides = {};
  return {
    getEffectiveRules() {
      return {
        schemaVersion: 1,
        rules: rules.map((r) => ({
          ...r,
          enabled: overrides.hasOwnProperty(r.id) ? overrides[r.id] : r.enabled,
        })),
      };
    },
    toggleRule(_home, ruleId, enabled) {
      const rule = rules.find((r) => r.id === ruleId);
      if (!rule) return null;
      overrides[ruleId] = enabled;
      return { ...rule, enabled };
    },
    batchToggle(_home, updates) {
      for (const { id, enabled } of updates) overrides[id] = enabled;
      return this.getEffectiveRules();
    },
  };
}

const SAMPLE_RULES = [
  { id: 'safety-git-push', name: 'Git Push Blocking', category: 'safety', description: 'Block git push', enabled: false, severity: 'high' },
  { id: 'anti-hang-timeout', name: 'Timeout Enforcement', category: 'anti-hang', description: 'Require timeout', enabled: false, severity: 'high' },
  { id: 'telemetry-session-start', name: 'Session Start Logging', category: 'telemetry', description: 'Log sessions', enabled: false, severity: 'low' },
];

function registerWithMocks(bodyObj = {}, serviceRules = SAMPLE_RULES) {
  return register({
    sendJson: createSendJson(),
    readJsonBody: createReadJsonBody(bodyObj),
    hookRulesService: createMockService(serviceRules),
  });
}

// --- Tests ---

async function run() {
  console.log('\nHook Rules Route Tests\n');

  await test('register returns 3 route descriptors', () => {
    const routes = registerWithMocks();
    assert.equal(routes.length, 3);
    assert.equal(routes[0].method, 'GET');
    assert.equal(routes[0].path, '/api/hooks/rules');
    assert.equal(routes[1].method, 'PATCH');
    assert.ok(routes[1].path instanceof RegExp);
    assert.equal(routes[2].method, 'POST');
    assert.equal(routes[2].path, '/api/hooks/rules/batch');
  });

  await test('GET /api/hooks/rules returns all rules', () => {
    const routes = registerWithMocks();
    const { res, body } = invoke(routes, { copilotHome: '/fake' }, 'GET', '/api/hooks/rules');
    assert.equal(res.statusCode, 200);
    assert.equal(body.schemaVersion, 1);
    assert.equal(body.rules.length, 3);
    assert.equal(body.rules[0].id, 'safety-git-push');
    assert.equal(body.rules[0].enabled, false);
  });

  await test('GET /api/hooks/rules returns 500 without copilotHome', () => {
    const routes = registerWithMocks();
    const { res, body } = invoke(routes, {}, 'GET', '/api/hooks/rules');
    assert.equal(res.statusCode, 500);
    assert.ok(body.error.includes('copilotHome'));
  });

  await test('PATCH /api/hooks/rules/:id toggles a rule', async () => {
    const routes = registerWithMocks({ enabled: true });
    const { res, body } = await invoke(routes, { copilotHome: '/fake' }, 'PATCH', '/api/hooks/rules/safety-git-push');
    assert.equal(res.statusCode, 200);
    assert.equal(body.id, 'safety-git-push');
    assert.equal(body.enabled, true);
  });

  await test('PATCH /api/hooks/rules/:id returns 404 for unknown rule', async () => {
    const routes = registerWithMocks({ enabled: true });
    const { res, body } = await invoke(routes, { copilotHome: '/fake' }, 'PATCH', '/api/hooks/rules/nonexistent-rule');
    assert.equal(res.statusCode, 404);
    assert.ok(body.error.includes('not found'));
  });

  await test('PATCH /api/hooks/rules/:id returns 400 without enabled field', async () => {
    const routes = registerWithMocks({});
    const { res, body } = await invoke(routes, { copilotHome: '/fake' }, 'PATCH', '/api/hooks/rules/safety-git-push');
    assert.equal(res.statusCode, 400);
    assert.ok(body.error.includes('enabled'));
  });

  await test('POST /api/hooks/rules/batch toggles multiple rules', async () => {
    const routes = registerWithMocks({
      updates: [
        { id: 'safety-git-push', enabled: true },
        { id: 'anti-hang-timeout', enabled: true },
      ],
    });
    const { res, body } = await invoke(routes, { copilotHome: '/fake' }, 'POST', '/api/hooks/rules/batch');
    assert.equal(res.statusCode, 200);
    assert.equal(body.rules.length, 3);
    const push = body.rules.find((r) => r.id === 'safety-git-push');
    const timeout = body.rules.find((r) => r.id === 'anti-hang-timeout');
    assert.equal(push.enabled, true);
    assert.equal(timeout.enabled, true);
  });

  await test('POST /api/hooks/rules/batch returns 400 without updates array', async () => {
    const routes = registerWithMocks({ notUpdates: [] });
    const { res, body } = await invoke(routes, { copilotHome: '/fake' }, 'POST', '/api/hooks/rules/batch');
    assert.equal(res.statusCode, 400);
    assert.ok(body.error.includes('updates'));
  });

  await test('POST /api/hooks/rules/batch returns 400 for malformed update entries', async () => {
    const routes = registerWithMocks({ updates: [{ id: 123, enabled: 'yes' }] });
    const { res, body } = await invoke(routes, { copilotHome: '/fake' }, 'POST', '/api/hooks/rules/batch');
    assert.equal(res.statusCode, 400);
  });

  await test('PATCH regex matches valid rule IDs', () => {
    const routes = registerWithMocks();
    const regex = routes[1].path;
    assert.ok(regex.test('/api/hooks/rules/safety-git-push'));
    assert.ok(regex.test('/api/hooks/rules/anti-hang-timeout'));
    assert.ok(!regex.test('/api/hooks/rules/'));
    assert.ok(!regex.test('/api/hooks/rules/has spaces'));
    assert.ok(!regex.test('/api/hooks/rules/has/slash'));
  });

  console.log(`\n  ${passed} tests passed\n`);
}

run().catch((err) => {
  console.error('Unexpected error:', err);
  process.exitCode = 1;
});
