'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const roadmapArtifacts = require('../lib/roadmapArtifacts');
const { register } = require('./roadmaps');

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
    ended: false,
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
    write(chunk) {
      state.chunks.push(String(chunk));
      return true;
    },
    end(chunk) {
      if (chunk != null) {
        state.chunks.push(String(chunk));
      }
      state.ended = true;
    },
  };
}

function parseJsonBody(response) {
  return JSON.parse(response.bodyText || '{}');
}

function createFixture() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-roadmap-routes-'));
  const engineRoot = path.join(tmpRoot, 'engine');
  const copilotHomeAbs = path.join(tmpRoot, '.copilot');
  const repoPath = path.join(tmpRoot, 'workspace-repo');
  fs.mkdirSync(path.join(repoPath, '.git'), { recursive: true });
  fs.mkdirSync(engineRoot, { recursive: true });
  fs.mkdirSync(copilotHomeAbs, { recursive: true });
  return { tmpRoot, engineRoot, copilotHomeAbs, repoPath };
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
  throw new Error(`Route not found for ${method} ${pathname}`);
}

async function invoke(routes, ctx, method, pathname, body) {
  const res = createResponse();
  const u = new URL(`http://127.0.0.1${pathname}`);
  const { route, match } = findRoute(routes, method, u.pathname);
  route.handler({
    ...ctx,
    req: { __body: body || {}, method },
    res,
    u,
    match,
    pathname: u.pathname,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { res, body: parseJsonBody(res) };
}

function createRepoInventory(repoPath) {
  const repo = {
    repoId: 'repo-workspace-repo',
    repoPath,
    repoLabel: 'workspace-repo',
    selected: true,
  };
  return {
    listKnownRepos() {
      return {
        selectedRepo: repo,
        repos: [repo],
      };
    },
    resolveRepoEntry(inventory, selector = {}) {
      if (!selector.repoId && !selector.repoPath) {
        return inventory.selectedRepo;
      }
      return inventory.repos.find((entry) => (
        (selector.repoId && entry.repoId === selector.repoId)
        || (selector.repoPath && entry.repoPath === path.resolve(selector.repoPath))
      )) || null;
    },
  };
}

function createEmptyRepoInventory() {
  return {
    listKnownRepos() {
      return {
        selectedRepo: null,
        repos: [],
      };
    },
    resolveRepoEntry() {
      return null;
    },
  };
}

async function run() {
  console.log('\nRoadmap Route Tests\n');

  await test('GET /api/planning/roadmaps lists roadmap artifacts for selected catalog repo', async () => {
    const { engineRoot, copilotHomeAbs, repoPath } = createFixture();
    roadmapArtifacts.writeRoadmapDocument(repoPath, {
      slug: 'platform-foundation',
      title: 'Platform Foundation',
      overview: 'Sequenced outcomes.',
      items: [{
        title: 'Bootstrap roadmap storage',
        phase: 'foundation',
        status: 'planned',
        summary: 'Add roadmap helpers.',
        backlogIds: ['RB-001'],
      }],
    });

    const routes = register({
      repoInventory: createRepoInventory(repoPath),
      sendJson(res, code, payload) {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload));
      },
      readJsonBody: async (req) => req.__body || {},
    });

    const { res, body } = await invoke(routes, {
      engineRoot,
      copilotHomeAbs,
    }, 'GET', '/api/planning/roadmaps');

    assert.equal(res.statusCode, 200);
    assert.equal(body.kind, 'planning.roadmaps.list');
    assert.equal(body.count, 1);
    assert.equal(body.repo.repoPath, repoPath);
    assert.equal(body.roadmaps[0].slug, 'platform-foundation');
    assert.equal(body.roadmaps[0].statusCounts.planned, 1);
  });

  await test('POST /api/planning/roadmaps creates roadmap artifact with stable ids', async () => {
    const { engineRoot, copilotHomeAbs, repoPath } = createFixture();
    const routes = register({
      repoInventory: createRepoInventory(repoPath),
      sendJson(res, code, payload) {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload));
      },
      readJsonBody: async (req) => req.__body || {},
    });

    const created = await invoke(routes, {
      engineRoot,
      copilotHomeAbs,
    }, 'POST', '/api/planning/roadmaps', {
      slug: 'platform-foundation',
      title: 'Platform Foundation',
      overview: 'Sequenced outcomes.',
      items: [{
        title: 'Bootstrap roadmap storage',
        phase: 'foundation',
        summary: 'Add roadmap helpers.',
        backlogIds: ['RB-002', 'RB-001'],
      }],
    });

    assert.equal(created.res.statusCode, 201);
    assert.equal(created.body.kind, 'planning.roadmaps.create');
    assert.equal(created.body.roadmap.items[0].id, 'RM-platform-foundation-001');
    assert.deepEqual(created.body.roadmap.items[0].backlogIds, ['RB-001', 'RB-002']);

    const markdown = fs.readFileSync(
      path.join(repoPath, 'docs', 'roadmaps', 'platform-foundation.md'),
      'utf8',
    );
    assert.match(markdown, /RM-platform-foundation-001/);
  });

  await test('POST /api/planning/roadmaps requires a selected catalog repo before slug validation', async () => {
    const { engineRoot, copilotHomeAbs } = createFixture();
    const routes = register({
      repoInventory: createEmptyRepoInventory(),
      sendJson(res, code, payload) {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload));
      },
      readJsonBody: async (req) => req.__body || {},
    });

    const response = await invoke(routes, {
      engineRoot,
      copilotHomeAbs,
    }, 'POST', '/api/planning/roadmaps', {});

    assert.equal(response.res.statusCode, 409);
    assert.equal(response.body.code, 'catalog_repo_not_selected');
  });

  await test('POST /api/planning/roadmaps fails closed when mutation targets raw repoPath without repoId', async () => {
    const { engineRoot, copilotHomeAbs, repoPath } = createFixture();
    const routes = register({
      repoInventory: createRepoInventory(repoPath),
      sendJson(res, code, payload) {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload));
      },
      readJsonBody: async (req) => req.__body || {},
    });

    const response = await invoke(routes, {
      engineRoot,
      copilotHomeAbs,
    }, 'POST', '/api/planning/roadmaps', {
      repoPath,
      slug: 'platform-foundation',
      title: 'Platform Foundation',
      overview: 'Should fail closed.',
    });

    assert.equal(response.res.statusCode, 409);
    assert.equal(response.body.code, 'catalog_repo_id_required_for_mutation');
  });

  await test('PATCH /api/planning/roadmaps/:slug updates metadata and upserts roadmap items', async () => {
    const { engineRoot, copilotHomeAbs, repoPath } = createFixture();
    roadmapArtifacts.writeRoadmapDocument(repoPath, {
      slug: 'platform-foundation',
      title: 'Platform Foundation',
      overview: 'Initial overview.',
      items: [{
        id: 'RM-platform-foundation-001',
        title: 'Bootstrap roadmap storage',
        phase: 'foundation',
        status: 'planned',
        summary: 'Initial summary.',
        backlogIds: ['RB-001'],
      }],
    });

    const routes = register({
      repoInventory: createRepoInventory(repoPath),
      sendJson(res, code, payload) {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload));
      },
      readJsonBody: async (req) => req.__body || {},
    });

    const updated = await invoke(routes, {
      engineRoot,
      copilotHomeAbs,
    }, 'PATCH', '/api/planning/roadmaps/platform-foundation', {
      overview: 'Updated overview.',
      items: [
        {
          id: 'RM-platform-foundation-001',
          status: 'in-progress',
          planRefs: ['group:G-01-platform-foundation'],
        },
        {
          title: 'Add roadmap reconciliation',
          phase: 'delivery',
          summary: 'Record plan refs.',
          backlogIds: ['RB-002'],
        },
      ],
    });

    assert.equal(updated.res.statusCode, 200);
    assert.equal(updated.body.roadmap.overview, 'Updated overview.');
    assert.deepEqual(updated.body.roadmap.items.map((entry) => entry.id), [
      'RM-platform-foundation-001',
      'RM-platform-foundation-002',
    ]);
    assert.equal(updated.body.roadmap.items[0].status, 'in-progress');
  });

  await test('POST /api/planning/roadmaps/:slug/reconcile updates roadmap item and fails closed on mismatched backlog ids', async () => {
    const { engineRoot, copilotHomeAbs, repoPath } = createFixture();
    roadmapArtifacts.writeRoadmapDocument(repoPath, {
      slug: 'platform-foundation',
      title: 'Platform Foundation',
      overview: 'Initial overview.',
      items: [{
        id: 'RM-platform-foundation-001',
        title: 'Bootstrap roadmap storage',
        phase: 'foundation',
        status: 'planned',
        summary: 'Ready for sync.',
        backlogIds: ['RB-001'],
      }],
    });

    const routes = register({
      repoInventory: createRepoInventory(repoPath),
      sendJson(res, code, payload) {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload));
      },
      readJsonBody: async (req) => req.__body || {},
    });

    const mismatch = await invoke(routes, {
      engineRoot,
      copilotHomeAbs,
    }, 'POST', '/api/planning/roadmaps/platform-foundation/reconcile', {
      itemId: 'RM-platform-foundation-001',
      backlogIds: ['RB-999'],
      planRef: 'session:20260314_090909_ABCD',
      outcome: 'completed',
    });
    assert.equal(mismatch.res.statusCode, 409);
    assert.equal(mismatch.body.code, 'roadmap_reconcile_backlog_id_mismatch');

    const reconciled = await invoke(routes, {
      engineRoot,
      copilotHomeAbs,
    }, 'POST', '/api/planning/roadmaps/platform-foundation/reconcile', {
      itemId: 'RM-platform-foundation-001',
      backlogIds: ['RB-001'],
      planRef: 'session:20260314_090909_ABCD',
      outcome: 'completed',
    });

    assert.equal(reconciled.res.statusCode, 200);
    assert.equal(reconciled.body.item.status, 'done');
    assert.equal(reconciled.body.item.satisfiedByPlanRef, 'session:20260314_090909_ABCD');

    const saved = roadmapArtifacts.readRoadmapDocument(repoPath, 'platform-foundation');
    assert.equal(saved.items[0].status, 'done');
    assert.deepEqual(saved.items[0].planRefs, ['session:20260314_090909_ABCD']);
  });

  if (!process.exitCode) {
    console.log(`roadmap route tests passed (${passed})`);
  }
}

run().catch((error) => {
  console.error('roadmap route tests failed');
  console.error(error);
  process.exitCode = 1;
});
