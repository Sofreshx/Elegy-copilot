'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const { register } = require('../routes/catalog');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  PASS: ${name}`);
  } catch (error) {
    failed += 1;
    process.exitCode = 1;
    console.error(`  FAIL: ${name}`);
    console.error(`    ${error.message}`);
  }
}

function invokeRoute(routes, method, path, { body, ctx = {} } = {}) {
  return new Promise((resolve, reject) => {
    const route = routes.find((entry) => {
      if (entry.method !== method) {
        return false;
      }
      if (typeof entry.path === 'string') {
        return entry.path === path;
      }
      return entry.path instanceof RegExp ? entry.path.test(path) : false;
    });

    if (!route) {
      reject(new Error(`Route not found: ${method} ${path}`));
      return;
    }

    const match = route.path instanceof RegExp ? path.match(route.path) : null;
    route.handler({
      req: {},
      res: {},
      engineRoot: 'C:\\engine',
      copilotHomeAbs: 'C:\\.copilot',
      codexHome: 'C:\\.codex',
      opencodeHome: 'C:\\.config\\opencode',
      geminiHome: 'C:\\.gemini',
      antigravityHome: 'C:\\.gemini\\antigravity',
      u: new URL(`http://localhost${path}`),
      match,
      ...ctx,
    });
  });
}

async function run() {
  console.log('\nCatalog Sources Route Tests\n');

  const externalSources = {
    listSources: () => ({
      catalogPath: 'C:\\engine\\engine-assets\\external-sources.json',
      userSourcesPath: 'C:\\.copilot\\catalog\\external-sources\\user-sources.json',
      statePath: 'C:\\.copilot\\catalog\\external-sources\\state.json',
      sources: [
        {
          sourceId: 'demo-source',
          title: 'Demo Source',
          installables: [],
        },
      ],
    }),
    getSourceDetail: (_options, sourceId) => ({
      catalogPath: 'C:\\engine\\engine-assets\\external-sources.json',
      userSourcesPath: 'C:\\.copilot\\catalog\\external-sources\\user-sources.json',
      statePath: 'C:\\.copilot\\catalog\\external-sources\\state.json',
      source: {
        sourceId,
        title: 'Demo Source',
      },
    }),
    addSource: () => ({
      source: {
        sourceId: 'demo-source',
        title: 'Demo Source',
      },
      userSourcesPath: 'C:\\.copilot\\catalog\\external-sources\\user-sources.json',
    }),
    removeSource: (_options, sourceId) => ({
      sourceId,
      removed: true,
    }),
    refreshSource: async () => ({
      source: {
        sourceId: 'demo-source',
      },
      snapshot: {
        installables: [
          {
            installableId: 'skill:brainstorming',
          },
        ],
      },
    }),
    activateInstallable: (_options, body) => ({
      source: { sourceId: body.sourceId },
      installable: { installableId: body.installableId },
      target: body.target,
      materialized: { managedName: 'external--demo-source--brainstorming' },
      state: { ok: true },
    }),
    deactivateInstallable: (_options, body) => ({
      source: { sourceId: body.sourceId },
      installable: { installableId: body.installableId },
      target: body.target,
      removed: { managedName: 'external--demo-source--brainstorming' },
      state: { ok: true },
    }),
    resolveCacheRoot: (copilotHome) => path.join(copilotHome, 'catalog', 'external-sources', 'cache'),
  };

  const routes = register({
    externalSources,
    readJsonBody: () => Promise.resolve({
      sourceId: 'demo-source',
      installableId: 'skill:brainstorming',
      target: 'codex',
      url: 'https://github.com/example/demo-source',
    }),
    sendJson: (_res, status, payload) => ({ status, payload }),
  });

  async function call(method, path) {
    return new Promise((resolve, reject) => {
      const route = routes.find((entry) => {
        if (entry.method !== method) {
          return false;
        }
        if (typeof entry.path === 'string') {
          return entry.path === path;
        }
        return entry.path instanceof RegExp ? entry.path.test(path) : false;
      });
      if (!route) {
        reject(new Error(`Route not found: ${method} ${path}`));
        return;
      }
      const match = route.path instanceof RegExp ? path.match(route.path) : null;
      route.handler({
        req: {},
        res: {},
        engineRoot: 'C:\\engine',
        copilotHomeAbs: 'C:\\.copilot',
        codexHome: 'C:\\.codex',
        opencodeHome: 'C:\\.config\\opencode',
        geminiHome: 'C:\\.gemini',
        antigravityHome: 'C:\\.gemini\\antigravity',
        u: new URL(`http://localhost${path}`),
        match,
      });
    });
  }

  await test('GET /api/catalog/sources returns source listing payload', async () => {
    let response = null;
    const testRoutes = register({
      externalSources,
      sendJson: (_res, status, payload) => {
        response = { status, payload };
      },
    });
    const route = testRoutes.find((entry) => entry.method === 'GET' && entry.path === '/api/catalog/sources');
    route.handler({
      req: {},
      res: {},
      engineRoot: 'C:\\engine',
      copilotHomeAbs: 'C:\\.copilot',
      codexHome: 'C:\\.codex',
      opencodeHome: 'C:\\.config\\opencode',
      geminiHome: 'C:\\.gemini',
      antigravityHome: 'C:\\.gemini\\antigravity',
      u: new URL('http://localhost/api/catalog/sources'),
    });
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.payload.kind, 'catalog.sources.list');
    assert.strictEqual(response.payload.count, 1);
  });

  await test('GET /api/catalog/sources/:sourceId returns source detail payload', async () => {
    let response = null;
    const testRoutes = register({
      externalSources,
      sendJson: (_res, status, payload) => {
        response = { status, payload };
      },
    });
    const route = testRoutes.find((entry) => entry.method === 'GET' && entry.path instanceof RegExp && entry.path.test('/api/catalog/sources/demo-source'));
    route.handler({
      req: {},
      res: {},
      engineRoot: 'C:\\engine',
      copilotHomeAbs: 'C:\\.copilot',
      codexHome: 'C:\\.codex',
      opencodeHome: 'C:\\.config\\opencode',
      geminiHome: 'C:\\.gemini',
      antigravityHome: 'C:\\.gemini\\antigravity',
      match: '/api/catalog/sources/demo-source'.match(route.path),
      u: new URL('http://localhost/api/catalog/sources/demo-source'),
    });
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.payload.kind, 'catalog.sources.detail');
    assert.strictEqual(response.payload.source.sourceId, 'demo-source');
  });

  await test('POST source mutations return expected payload kinds', async () => {
    const payloads = [];
    const testRoutes = register({
      externalSources,
      readJsonBody: () => Promise.resolve({
        sourceId: 'demo-source',
        installableId: 'skill:brainstorming',
        target: 'codex',
        url: 'https://github.com/example/demo-source',
      }),
      sendJson: (_res, status, payload) => {
        payloads.push({ status, payload });
      },
    });

    const routePaths = [
      '/api/catalog/sources/add',
      '/api/catalog/sources/remove',
      '/api/catalog/sources/refresh',
      '/api/catalog/sources/activate',
      '/api/catalog/sources/deactivate',
    ];

    for (const path of routePaths) {
      const route = testRoutes.find((entry) => entry.method === 'POST' && entry.path === path);
      await route.handler({
        req: {},
        res: {},
        engineRoot: 'C:\\engine',
        copilotHomeAbs: 'C:\\.copilot',
        codexHome: 'C:\\.codex',
        opencodeHome: 'C:\\.config\\opencode',
        geminiHome: 'C:\\.gemini',
        antigravityHome: 'C:\\.gemini\\antigravity',
        u: new URL(`http://localhost${path}`),
      });
    }

    assert.deepStrictEqual(
      payloads.map((entry) => entry.payload.kind),
      [
        'catalog.sources.add',
        'catalog.sources.remove',
        'catalog.sources.refresh',
        'catalog.sources.activate',
        'catalog.sources.deactivate',
      ]
    );
    assert.deepStrictEqual(payloads.map((entry) => entry.status), [200, 200, 200, 200, 200]);
  });

  await test('GET /api/catalog/content returns text for external-source content', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-content-route-'));
    const copilotHomeAbs = path.join(tmpRoot, '.copilot');
    const cachedFile = path.join(
      copilotHomeAbs,
      'catalog',
      'external-sources',
      'cache',
      'demo-source',
      'extracted',
      'demo-source-main',
      'server.json'
    );
    fs.mkdirSync(path.dirname(cachedFile), { recursive: true });
    fs.writeFileSync(cachedFile, '{"name":"context7"}\n', 'utf8');

    let response = null;
    const testRoutes = register({
      externalSources,
      sendJson: (_res, status, payload) => {
        response = { status, payload, type: 'json' };
      },
      sendText: (_res, status, text) => {
        response = { status, text, type: 'text' };
      },
    });
    const route = testRoutes.find((entry) => entry.method === 'GET' && entry.path === '/api/catalog/content');
    route.handler({
      req: {},
      res: {},
      engineRoot: 'C:\\engine',
      copilotHomeAbs,
      codexHome: 'C:\\.codex',
      opencodeHome: 'C:\\.config\\opencode',
      geminiHome: 'C:\\.gemini',
      antigravityHome: 'C:\\.gemini\\antigravity',
      u: new URL('http://localhost/api/catalog/content?mode=external-source&sourceId=demo-source&path=server.json'),
    });

    assert.deepStrictEqual(response, {
      status: 200,
      text: '{"name":"context7"}\n',
      type: 'text',
    });

    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  console.log(`\n  ${passed} passed, ${failed} failed (${passed + failed} total)\n`);
}

run().catch((error) => {
  console.error(`\n  FATAL: ${error.message}\n`);
  process.exitCode = 1;
});
