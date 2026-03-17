'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repositoryBacklogFile = require('../lib/repositoryBacklogFile');
const { register } = require('./backlog');

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
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-backlog-routes-'));
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
  console.log('\nBacklog Route Tests\n');

  await test('GET /api/planning/backlog returns canonical empty backlog state for selected catalog repo', async () => {
    const { engineRoot, copilotHomeAbs, repoPath } = createFixture();
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
    }, 'GET', '/api/planning/backlog');

    assert.equal(res.statusCode, 200);
    assert.equal(body.kind, 'planning.backlog.read');
    assert.equal(body.repo.repoPath, repoPath);
    assert.equal(body.backlog.exists, false);
    assert.equal(body.backlog.itemCount, 0);
    assert.deepEqual(body.backlog.items, []);
  });

  await test('POST /api/planning/backlog creates repository backlog item via repoId authority', async () => {
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
    }, 'POST', '/api/planning/backlog', {
      repoId: 'repo-workspace-repo',
      title: 'Bootstrap planning backlog persistence',
      summary: 'Use docs/backlog.md as the canonical intake file.',
      roadmapIds: ['RM-platform-foundation-001'],
      keyPoints: [{ date: '2026-03-16', text: 'Create stable RB ids.' }],
    });

    assert.equal(created.res.statusCode, 201);
    assert.equal(created.body.kind, 'planning.backlog.create');
    assert.equal(created.body.item.id, 'RB-001');
    assert.deepEqual(created.body.item.roadmapIds, ['RM-platform-foundation-001']);

    const saved = repositoryBacklogFile.readRepositoryBacklogFile(repoPath);
    assert.equal(saved.exists, true);
    assert.equal(saved.backlog.items[0].id, 'RB-001');
  });

  await test('PATCH /api/planning/backlog/:itemId updates repository backlog item without mutating the id', async () => {
    const { engineRoot, copilotHomeAbs, repoPath } = createFixture();
    repositoryBacklogFile.updateRepositoryBacklogFile(repoPath, (backlog) =>
      repositoryBacklogFile.createRepositoryBacklogItem(backlog, {
        title: 'Bootstrap planning backlog persistence',
        summary: 'Initial summary.',
        roadmapIds: ['RM-platform-foundation-001'],
        keyPoints: [{ date: '2026-03-16', text: 'Initial capture.' }],
      }));

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
    }, 'PATCH', '/api/planning/backlog/RB-001', {
      repoId: 'repo-workspace-repo',
      title: 'Bootstrap repo-doc persistence',
      status: 'planned',
      importance: 8,
      keyPoints: [{ date: '2026-03-17', text: 'Use repositoryBacklogFile helpers.' }],
    });

    assert.equal(updated.res.statusCode, 200);
    assert.equal(updated.body.kind, 'planning.backlog.update');
    assert.equal(updated.body.item.id, 'RB-001');
    assert.equal(updated.body.item.title, 'Bootstrap repo-doc persistence');
    assert.equal(updated.body.item.status, 'planned');
    assert.equal(updated.body.item.importance, 8);

    const saved = repositoryBacklogFile.readRepositoryBacklogFile(repoPath);
    assert.equal(saved.backlog.items[0].id, 'RB-001');
    assert.equal(saved.backlog.items[0].title, 'Bootstrap repo-doc persistence');
  });

  await test('POST /api/planning/backlog fails closed when mutation targets raw repoPath without repoId', async () => {
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
    }, 'POST', '/api/planning/backlog', {
      repoPath,
      title: 'Should fail closed',
      summary: 'repoPath-only targeting is not authoritative for mutations.',
    });

    assert.equal(response.res.statusCode, 409);
    assert.equal(response.body.code, 'catalog_repo_id_required_for_mutation');
  });

  await test('GET /api/planning/backlog requires selected or targeted catalog repo for reads', async () => {
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
    }, 'GET', '/api/planning/backlog');

    assert.equal(response.res.statusCode, 409);
    assert.equal(response.body.code, 'catalog_repo_not_selected');
  });

  if (!process.exitCode) {
    console.log(`backlog route tests passed (${passed})`);
  }
}

run().catch((error) => {
  console.error('backlog route tests failed');
  console.error(error);
  process.exitCode = 1;
});
