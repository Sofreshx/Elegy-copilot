'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { register: registerCatalogRoutes } = require('../routes/catalog');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  PASS: ${name}`);
  } catch (error) {
    failed++;
    console.error(`  FAIL: ${name}`);
    console.error(`    ${error.message}`);
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------------
// Test harness (matching catalog.test.js patterns)
// ---------------------------------------------------------------------------

function createResponse() {
  const chunks = [];
  return {
    statusCode: 200,
    headers: {},
    chunks,
    ended: false,
    writeHead(code, headers) {
      this.statusCode = code;
      Object.assign(this.headers, headers);
    },
    end(data) {
      if (data) chunks.push(Buffer.isBuffer(data) ? data : Buffer.from(data));
      this.ended = true;
    },
    body() {
      const raw = Buffer.concat(this.chunks).toString('utf8');
      try { return JSON.parse(raw); } catch { return raw; }
    },
  };
}

function writeJson(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), 'utf8');
}

function writeText(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text, 'utf8');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMinimalManifest() {
  return {
    schemaVersion: 1,
    bundles: [
      {
        bundleId: 'core',
        title: 'Core Bundle',
        assetIds: ['core-skill'],
        classification: 'core',
        defaultRecommended: true,
        activationScope: 'global',
      },
    ],
    assets: [
      {
        id: 'core-skill',
        type: 'skill',
        title: 'Core Skill',
        description: 'A core skill for testing',
        source: 'skills/core-skill/SKILL.md',
        destination: 'skills/core-skill',
        kind: 'skill',
        activation: { plannerProfile: 'balanced' },
        targeting: { tags: ['core', 'test'] },
        bundles: ['core'],
        loadMode: 'always',
      },
    ],
    providers: [],
  };
}

function makeMinimalEffectiveAsset(overrides = {}) {
  return {
    assetId: overrides.assetId || 'core-skill',
    assetKey: overrides.assetKey || 'core-skill',
    kind: overrides.kind || 'skill',
    available: overrides.available !== false,
    installed: overrides.installed === true,
    enabled: overrides.enabled !== false,
    deprecated: overrides.deprecated === true,
    recommended: overrides.recommended !== false,
    labels: [],
    selectedLayer: overrides.selectedLayer || 'source',
    selectedEntry: {
      assetId: overrides.assetId || 'core-skill',
      title: overrides.title || 'Core Skill',
      description: overrides.description || 'A core skill',
      kind: overrides.kind || 'skill',
      targeting: { tags: overrides.tags || ['core'] },
      installState: { loadMode: overrides.loadMode || 'always' },
      provenance: { providerId: 'built-in' },
    },
    installState: { loadMode: overrides.loadMode || 'always' },
    bundleIds: Array.isArray(overrides.bundleIds) ? overrides.bundleIds : ['core'],
    scope: { kind: 'global' },
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
      if (match) {
        return { route, match };
      }
    }
  }
  throw new Error(`Route not found: ${method} ${pathname}`);
}

async function invoke(routes, ctx, method, pathname, body) {
  const res = createResponse();
  const u = new URL(`http://127.0.0.1${pathname}`);
  const { route, match } = findRoute(routes, method, u.pathname);
  route.handler({
    ...ctx,
    req: { __body: body || {} },
    res,
    u,
    match,
    pathname: u.pathname,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { res, body: res.body() };
}

// ---------------------------------------------------------------------------
// Fixture setup
// ---------------------------------------------------------------------------

function setupFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-route-explain-'));
  const engineRoot = path.join(root, 'engine-assets');
  const copilotHome = path.join(root, 'copilot-home');

  // Write manifest
  writeJson(path.join(root, 'engine-assets', 'manifest.json'), makeMinimalManifest());

  // Write activation state
  writeJson(path.join(copilotHome, 'catalog', 'activation-state.json'), {
    schemaVersion: 1,
    plannerProfile: 'balanced',
    orchestrationPolicy: 'balanced',
    activeBundleIds: ['core'],
    bundleSource: 'provider-defaults',
  });

  // Write a projection snapshot
  writeJson(path.join(copilotHome, 'catalog', 'projections', 'global.json'), {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    repoContext: { repoId: null, repoPath: null },
    effectiveAssets: [
      makeMinimalEffectiveAsset({ assetId: 'core-skill', assetKey: 'core-skill', kind: 'skill', title: 'Core Skill', installed: true, enabled: true }),
    ],
    entries: [],
    bundles: [],
    stats: { totalAssets: 1, totalEntries: 1 },
  });

  // Write providers
  writeJson(path.join(root, 'engine-assets', 'providers.json'), {
    schemaVersion: 1,
    providers: [],
  });

  return { root, engineRoot, copilotHome };
}

function cleanupFixture(root) {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function run() {
  let fixture;

  try {
    fixture = setupFixture();

    // Register routes with injected deps (matching catalog.test.js pattern)
    const routes = registerCatalogRoutes({
      engineRoot: fixture.engineRoot,
      process: { cwd: () => fixture.root },
      fs,
      path,
      crypto: require('crypto'),
      readJsonBody: async (req) => req.__body || {},
      sendJson(res, code, payload) {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload, null, 2));
      },
    });

    const baseCtx = {
      engineRoot: fixture.engineRoot,
      copilotHomeAbs: fixture.copilotHome,
      codexHome: null,
      codexSkillsHome: null,
      opencodeHome: null,
      opencodeSkillsHome: null,
      geminiHome: null,
      antigravityHome: null,
      antigravitySkillsHome: null,
      changeTracker: null,
    };

    // =========================================================================
    // Basic route shape
    // =========================================================================

    await test('POST /api/catalog/route/explain returns 200 and deterministic decision shape', async () => {
      const { res, body } = await invoke(routes, baseCtx, 'POST', '/api/catalog/route/explain', {
        query: 'core',
        intent: 'task-routing',
        kinds: ['skill'],
      });
      assert.equal(res.statusCode, 200);
      assert.equal(body.kind, 'catalog.route.explanation');
      assert.equal(body.deterministic, true);
      assert.ok(body.correlationId);
      assert.ok(body.decidedAt);
      assert.ok(Array.isArray(body.candidates));
      assert.ok(body.policy);
    });

    // =========================================================================
    // Candidate results
    // =========================================================================

    await test('POST /api/catalog/route/explain returns candidates from projection', async () => {
      const { res, body } = await invoke(routes, baseCtx, 'POST', '/api/catalog/route/explain', {
        query: 'core',
        intent: 'task-routing',
        kinds: ['skill'],
      });
      assert.ok(body.candidates.length > 0, 'should have at least one candidate');
      const candidate = body.candidates[0];
      assert.equal(candidate.id, 'core-skill');
      assert.equal(candidate.kind, 'skill');
    });

    // =========================================================================
    // Decision selection
    // =========================================================================

    await test('POST /api/catalog/route/explain selects best candidate as decision', async () => {
      const { res, body } = await invoke(routes, baseCtx, 'POST', '/api/catalog/route/explain', {
        query: 'core',
        intent: 'task-routing',
        kinds: ['skill'],
      });
      assert.ok(body.decision, 'should have a decision');
      assert.equal(body.decision.id, 'core-skill');
    });

    // =========================================================================
    // Policy snapshot
    // =========================================================================

    await test('POST /api/catalog/route/explain returns policy snapshot', async () => {
      const { res, body } = await invoke(routes, baseCtx, 'POST', '/api/catalog/route/explain', {
        query: 'core',
        intent: 'task-routing',
        kinds: ['skill'],
      });
      assert.ok(body.policy);
      assert.equal(typeof body.policy.schemaVersion, 'number');
      assert.ok(body.policy.profile);
      assert.ok(Array.isArray(body.policy.activeBundleIds));
      assert.ok(typeof body.policy.totalCandidates, 'number');
      assert.ok(typeof body.policy.eligibleCount, 'number');
      assert.ok(typeof body.policy.blockedCount, 'number');
      assert.equal(body.policy.intent, 'task-routing');
    });

    // =========================================================================
    // Audit events
    // =========================================================================

    await test('POST /api/catalog/route/explain includes audit info', async () => {
      const { res, body } = await invoke(routes, baseCtx, 'POST', '/api/catalog/route/explain', {
        query: 'core',
        intent: 'task-routing',
        kinds: ['skill'],
      });
      assert.ok(body.audit, 'should have audit field');
      assert.equal(typeof body.audit.logged, 'boolean');
      assert.ok(body.audit.path);
    });

    // =========================================================================
    // Missing projection returns 503
    // =========================================================================

    await test('POST /api/catalog/route/explain returns 503 with repair action when projection unavailable', async () => {
      // Set up a context with invalid copilotHome so no projection is found
      const badCtx = {
        ...baseCtx,
        copilotHomeAbs: path.join(fixture.root, 'nonexistent'),
      };
      const { res, body } = await invoke(routes, badCtx, 'POST', '/api/catalog/route/explain', {
        query: 'test',
        intent: 'task-routing',
        kinds: ['skill'],
      });
      // Missing projection returns fail-closed 503 with repair action
      assert.equal(res.statusCode, 503);
      assert.equal(body.kind, 'catalog.route.explanation');
      assert.equal(body.deterministic, true);
      assert.equal(body.decision, null);
      assert.ok(Array.isArray(body.candidates));
      assert.equal(body.candidates.length, 0);
      assert.ok(body.policy, 'should have policy snapshot');
      assert.equal(body.policy.failClosed, true);
      assert.equal(body.policy.totalCandidates, 0);
      assert.ok(Array.isArray(body.suggestedActions), 'should have suggested actions');
      assert.equal(body.suggestedActions[0].operation, 'rebuild-projection');
      assert.equal(body.suggestedActions[0].route, '/api/catalog/refresh');
      assert.ok(body.error, 'should include projection error details');
      assert.ok(body.audit.error, 'audit should report projection-unavailable');
    });

    // =========================================================================
    // Correlation ID
    // =========================================================================

    await test('POST /api/catalog/route/explain respects provided correlationId', async () => {
      const { res, body } = await invoke(routes, baseCtx, 'POST', '/api/catalog/route/explain', {
        query: 'core',
        intent: 'task-routing',
        kinds: ['skill'],
        correlationId: 'test-corr-123',
      });
      assert.equal(body.correlationId, 'test-corr-123');
    });

    // =========================================================================
    // Different intents
    // =========================================================================

    await test('POST /api/catalog/route/explain handles tool-routing intent', async () => {
      const { res, body } = await invoke(routes, baseCtx, 'POST', '/api/catalog/route/explain', {
        query: 'mcp',
        intent: 'tool-routing',
        kinds: ['mcp', 'cli-tool'],
      });
      assert.equal(res.statusCode, 200);
      assert.equal(body.policy.intent, 'tool-routing');
    });

    await test('POST /api/catalog/route/explain handles install-recommendation intent', async () => {
      const { res, body } = await invoke(routes, baseCtx, 'POST', '/api/catalog/route/explain', {
        query: '',
        intent: 'install-recommendation',
      });
      assert.equal(res.statusCode, 200);
      assert.equal(body.policy.intent, 'install-recommendation');
    });

    await test('POST /api/catalog/route/explain handles source-diagnostics intent', async () => {
      const { res, body } = await invoke(routes, baseCtx, 'POST', '/api/catalog/route/explain', {
        query: '',
        intent: 'source-diagnostics',
      });
      assert.equal(res.statusCode, 200);
      assert.equal(body.policy.intent, 'source-diagnostics');
    });

    // =========================================================================
    // Error handling
    // =========================================================================

    await test('POST /api/catalog/route/explain handles missing query gracefully', async () => {
      const { res, body } = await invoke(routes, baseCtx, 'POST', '/api/catalog/route/explain', {
        intent: 'task-routing',
      });
      assert.equal(res.statusCode, 200);
      assert.equal(body.kind, 'catalog.route.explanation');
    });

    await test('POST /api/catalog/route/explain handles empty body gracefully', async () => {
      const { res, body } = await invoke(routes, baseCtx, 'POST', '/api/catalog/route/explain', {});
      assert.equal(res.statusCode, 200);
      assert.equal(body.kind, 'catalog.route.explanation');
    });

    // Summary
    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);

  } finally {
    if (fixture) cleanupFixture(fixture.root);
  }
}

run().catch((error) => {
  console.error('Test runner error:', error);
  process.exit(1);
});
