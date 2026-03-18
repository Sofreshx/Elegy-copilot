'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createPlanningApiState } = require('../lib/planningApiContracts');
const { register } = require('./planning-artifacts');

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

function createRequest(body) {
  return {
    __body: body,
  };
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
    get headers() {
      return state.headers;
    },
    get bodyText() {
      return state.chunks.join('');
    },
    get writableEnded() {
      return state.ended;
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
  const text = response.bodyText.trim();
  if (!text) {
    return null;
  }
  return JSON.parse(text);
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

async function invoke(routes, ctxOrPlanningApiState, method, pathname, body) {
  const { route, match } = findRoute(routes, method, pathname);
  const req = createRequest(body);
  const res = createResponse();
  const u = new URL(`http://127.0.0.1${pathname}`);
  const ctx =
    ctxOrPlanningApiState
    && typeof ctxOrPlanningApiState === 'object'
    && ctxOrPlanningApiState.recordsById instanceof Map
      ? { planningApiState: ctxOrPlanningApiState }
      : (ctxOrPlanningApiState || {});

  route.handler({ ...ctx, req, res, u, match, pathname: u.pathname });
  await sleep(0);

  return { req, res };
}

function createFixture() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-planning-artifacts-routes-'));
  const engineRoot = path.join(tmpRoot, 'engine');
  const copilotHomeAbs = path.join(tmpRoot, '.copilot');
  const repoPath = path.join(tmpRoot, 'workspace-repo');
  fs.mkdirSync(path.join(repoPath, '.git'), { recursive: true });
  fs.mkdirSync(engineRoot, { recursive: true });
  fs.mkdirSync(copilotHomeAbs, { recursive: true });
  return { tmpRoot, engineRoot, copilotHomeAbs, repoPath };
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

function createSeedState() {
  const planningApiState = createPlanningApiState();
  planningApiState.recordsById.set('planning-000001', {
    recordId: 'planning-000001',
    title: 'Planning artifact record',
    summary: 'seed summary',
    createdAt: '2026-03-01T00:00:00.000Z',
    updatedAt: '2026-03-01T00:00:00.000Z',
    researchNotes: [
      {
        noteId: 'note-0002',
        title: 'Second note',
        summary: 'later note',
        source: 'doc-b',
        createdAt: '2026-03-01T00:02:00.000Z',
        updatedAt: '2026-03-01T00:02:00.000Z',
      },
      {
        noteId: 'note-0001',
        title: 'First note',
        summary: 'earlier note',
        source: 'doc-a',
        createdAt: '2026-03-01T00:01:00.000Z',
        updatedAt: '2026-03-01T00:01:00.000Z',
      },
    ],
    diagrams: [
      {
        diagramId: 'diagram-002',
        title: 'Flow B',
        format: 'mermaid',
        content: 'graph TD; B-->C;',
        createdAt: '2026-03-01T00:03:00.000Z',
        updatedAt: '2026-03-01T00:03:00.000Z',
      },
      {
        diagramId: 'diagram-001',
        title: 'Flow A',
        format: 'mermaid',
        content: 'graph TD; A-->B;',
        createdAt: '2026-03-01T00:02:00.000Z',
        updatedAt: '2026-03-01T00:02:00.000Z',
      },
    ],
  });

  return planningApiState;
}

async function run() {
  await test('GET /api/planning/artifacts/intake returns canonical empty intake state for selected catalog repo', async () => {
    const { engineRoot, copilotHomeAbs, repoPath } = createFixture();
    const routes = register({
      repoInventory: createRepoInventory(repoPath),
      sendJson(res, code, payload) {
        const text = JSON.stringify(payload, null, 2);
        res.writeHead(code, {
          'Content-Type': 'application/json; charset=utf-8',
        });
        res.end(text);
      },
      readJsonBody: async (req) => req.__body || {},
    });

    const { res } = await invoke(routes, {
      engineRoot,
      copilotHomeAbs,
    }, 'GET', '/api/planning/artifacts/intake');

    assert.equal(res.statusCode, 200);
    const body = parseJsonBody(res);
    assert.equal(body.kind, 'planning.intake.list');
    assert.equal(body.repo.repoPath, repoPath);
    assert.equal(body.intake.exists, false);
    assert.equal(body.intake.artifactCount, 0);
    assert.deepEqual(body.artifacts, []);
  });

  await test('POST /api/planning/artifacts/intake creates typed intake artifacts via repoId authority', async () => {
    const { engineRoot, copilotHomeAbs, repoPath } = createFixture();
    const routes = register({
      repoInventory: createRepoInventory(repoPath),
      sendJson(res, code, payload) {
        const text = JSON.stringify(payload, null, 2);
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(text);
      },
      readJsonBody: async (req) => req.__body || {},
    });

    const created = await invoke(routes, {
      engineRoot,
      copilotHomeAbs,
    }, 'POST', '/api/planning/artifacts/intake', {
      repoId: 'repo-workspace-repo',
      artifact: {
        category: 'idea',
        title: 'Capture repo-backed planning intake',
        summary: 'Use docs/planning/intake/*.json for unscheduled tracked work.',
        acceptanceCriteria: ['Write deterministic JSON'],
        targetRepoIds: ['repo-workspace-repo'],
        planningState: 'thought',
      },
    });

    assert.equal(created.res.statusCode, 201);
    assert.equal(parseJsonBody(created.res).kind, 'planning.intake.create');

    const list = await invoke(routes, {
      engineRoot,
      copilotHomeAbs,
    }, 'GET', '/api/planning/artifacts/intake');
    const listedBody = parseJsonBody(list.res);
    assert.equal(listedBody.intake.exists, true);
    assert.equal(listedBody.artifacts.length, 1);
    assert.equal(listedBody.artifacts[0].id, 'PI-001');
    assert.equal(listedBody.artifacts[0].category, 'idea');
    assert.deepEqual(listedBody.artifacts[0].acceptanceCriteria, ['Write deterministic JSON']);
  });

  await test('PATCH /api/planning/artifacts/intake/:id updates typed intake artifacts', async () => {
    const { engineRoot, copilotHomeAbs, repoPath } = createFixture();
    const routes = register({
      repoInventory: createRepoInventory(repoPath),
      sendJson(res, code, payload) {
        const text = JSON.stringify(payload, null, 2);
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(text);
      },
      readJsonBody: async (req) => req.__body || {},
    });

    await invoke(routes, {
      engineRoot,
      copilotHomeAbs,
    }, 'POST', '/api/planning/artifacts/intake', {
      repoId: 'repo-workspace-repo',
      title: 'Initial artifact',
      summary: 'Initial summary',
      category: 'idea',
    });

    const updated = await invoke(routes, {
      engineRoot,
      copilotHomeAbs,
    }, 'PATCH', '/api/planning/artifacts/intake/PI-001', {
      repoId: 'repo-workspace-repo',
      category: 'research',
      title: 'Updated artifact',
      acceptanceCriteria: ['Review existing routes'],
    });

    assert.equal(updated.res.statusCode, 200);
    const updatedBody = parseJsonBody(updated.res);
    assert.equal(updatedBody.kind, 'planning.intake.update');
    assert.equal(updatedBody.artifact.id, 'PI-001');
    assert.equal(updatedBody.artifact.category, 'research');
    assert.deepEqual(updatedBody.artifact.acceptanceCriteria, ['Review existing routes']);
  });

  await test('planning intake mutations fail closed when repoPath is supplied without repoId', async () => {
    const { engineRoot, copilotHomeAbs, repoPath } = createFixture();
    const routes = register({
      repoInventory: createRepoInventory(repoPath),
      sendJson(res, code, payload) {
        const text = JSON.stringify(payload, null, 2);
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(text);
      },
      readJsonBody: async (req) => req.__body || {},
    });

    const created = await invoke(routes, {
      engineRoot,
      copilotHomeAbs,
    }, 'POST', '/api/planning/artifacts/intake', {
      repoPath,
      title: 'Should fail closed',
      category: 'idea',
    });

    assert.equal(created.res.statusCode, 409);
    assert.equal(parseJsonBody(created.res).code, 'catalog_repo_id_required_for_mutation');
  });

  await test('GET /api/planning/records/:id/research returns deterministic research notes', async () => {
    const planningApiState = createSeedState();
    const routes = register({
      PLANNING_API_CONTRACT_VERSION: 'planning_api_v1',
      sendJson(res, code, payload) {
        const text = JSON.stringify(payload, null, 2);
        res.writeHead(code, {
          'Content-Type': 'application/json; charset=utf-8',
        });
        res.end(text);
      },
      readJsonBody: async (req) => req.__body || {},
    });

    const { res } = await invoke(routes, planningApiState, 'GET', '/api/planning/records/planning-000001/research');
    assert.equal(res.statusCode, 200);

    const body = parseJsonBody(res);
    assert.equal(body.kind, 'planning.artifacts.research.list');
    assert.equal(body.deterministic, true);
    assert.equal(body.researchNotes.length, 2);
    assert.equal(body.researchNotes[0].id, 'note-0001');
    assert.equal(body.researchNotes[0].phase, 'research');
    assert.equal(body.researchNotes[0].title, 'First note');
    assert.equal(body.researchNotes[0].content, 'earlier note');
    assert.deepEqual(body.researchNotes[0].sources, ['doc-a']);
    assert.equal(body.researchNotes[1].id, 'note-0002');
  });

  await test('GET /api/planning/records/:id/research validates record ids and missing records', async () => {
    const planningApiState = createSeedState();
    const routes = register({
      sendJson(res, code, payload) {
        const text = JSON.stringify(payload, null, 2);
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(text);
      },
      readJsonBody: async (req) => req.__body || {},
    });

    const invalid = await invoke(routes, planningApiState, 'GET', '/api/planning/records/%2F/research');
    assert.equal(invalid.res.statusCode, 400);

    const missing = await invoke(routes, planningApiState, 'GET', '/api/planning/records/planning-999999/research');
    assert.equal(missing.res.statusCode, 404);
  });

  await test('POST /api/planning/records/:id/research creates a note with generated id', async () => {
    const planningApiState = createSeedState();
    const routes = register({
      sendJson(res, code, payload) {
        const text = JSON.stringify(payload, null, 2);
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(text);
      },
      readJsonBody: async (req) => req.__body || {},
    });

    const created = await invoke(routes, planningApiState, 'POST', '/api/planning/records/planning-000001/research', {
      phase: 'analysis',
      title: 'Third note',
      content: 'new insight',
      sources: ['doc-c'],
    });

    assert.equal(created.res.statusCode, 201);
    const createdBody = parseJsonBody(created.res);
    assert.equal(createdBody.kind, 'planning.artifacts.research.create');
    assert.equal(createdBody.note.id, 'note-0003');
    assert.equal(createdBody.note.phase, 'analysis');
    assert.equal(createdBody.note.content, 'new insight');
    assert.deepEqual(createdBody.note.sources, ['doc-c']);

    const listed = await invoke(routes, planningApiState, 'GET', '/api/planning/records/planning-000001/research');
    const listedBody = parseJsonBody(listed.res);
    assert.equal(listedBody.researchNotes.length, 3);
    assert.deepEqual(
      listedBody.researchNotes.map((entry) => entry.id),
      ['note-0001', 'note-0002', 'note-0003']
    );
  });

  await test('POST /api/planning/records/:id/research updates an existing note when id already exists', async () => {
    const planningApiState = createSeedState();
    const routes = register({
      sendJson(res, code, payload) {
        const text = JSON.stringify(payload, null, 2);
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(text);
      },
      readJsonBody: async (req) => req.__body || {},
    });

    const updated = await invoke(routes, planningApiState, 'POST', '/api/planning/records/planning-000001/research', {
      id: 'note-0001',
      phase: 'implementation',
      title: 'First note revised',
      content: 'updated insight',
      sources: ['doc-z', 'doc-y'],
    });

    assert.equal(updated.res.statusCode, 200);
    const updatedBody = parseJsonBody(updated.res);
    assert.equal(updatedBody.kind, 'planning.artifacts.research.update');
    assert.equal(updatedBody.note.id, 'note-0001');
    assert.equal(updatedBody.note.phase, 'implementation');
    assert.equal(updatedBody.note.title, 'First note revised');
    assert.equal(updatedBody.note.content, 'updated insight');
    assert.deepEqual(updatedBody.note.sources, ['doc-y', 'doc-z']);

    const listed = await invoke(routes, planningApiState, 'GET', '/api/planning/records/planning-000001/research');
    const listedBody = parseJsonBody(listed.res);
    assert.equal(listedBody.researchNotes.length, 2);

    const updatedListed = listedBody.researchNotes.find((entry) => entry.id === 'note-0001');
    assert.ok(updatedListed);
    assert.equal(updatedListed.phase, 'implementation');
    assert.equal(updatedListed.content, 'updated insight');
    assert.deepEqual(updatedListed.sources, ['doc-y', 'doc-z']);
  });

  await test('POST /api/planning/records/:id/research validates payload and missing records', async () => {
    const planningApiState = createSeedState();
    const routes = register({
      sendJson(res, code, payload) {
        const text = JSON.stringify(payload, null, 2);
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(text);
      },
      readJsonBody: async (req) => req.__body || {},
    });

    const missingTitle = await invoke(routes, planningApiState, 'POST', '/api/planning/records/planning-000001/research', {
      content: 'missing title',
    });
    assert.equal(missingTitle.res.statusCode, 400);

    const missingContent = await invoke(routes, planningApiState, 'POST', '/api/planning/records/planning-000001/research', {
      title: 'Missing content',
    });
    assert.equal(missingContent.res.statusCode, 400);

    const missingRecord = await invoke(routes, planningApiState, 'POST', '/api/planning/records/planning-999999/research', {
      title: 'Missing',
      content: 'record missing',
    });
    assert.equal(missingRecord.res.statusCode, 404);
  });

  await test('DELETE /api/planning/records/:id/research/:noteId removes note and validates ids', async () => {
    const planningApiState = createSeedState();
    const routes = register({
      sendJson(res, code, payload) {
        const text = JSON.stringify(payload, null, 2);
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(text);
      },
      readJsonBody: async (req) => req.__body || {},
    });

    const removed = await invoke(routes, planningApiState, 'DELETE', '/api/planning/records/planning-000001/research/note-0001');
    assert.equal(removed.res.statusCode, 200);
    assert.equal(parseJsonBody(removed.res).ok, true);

    const removedList = await invoke(routes, planningApiState, 'GET', '/api/planning/records/planning-000001/research');
    assert.deepEqual(
      parseJsonBody(removedList.res).researchNotes.map((entry) => entry.id),
      ['note-0002']
    );

    const invalidNote = await invoke(routes, planningApiState, 'DELETE', '/api/planning/records/planning-000001/research/%2F');
    assert.equal(invalidNote.res.statusCode, 400);
  });

  await test('DELETE /api/planning/records/:id/research/:noteId returns 404 for missing record/note', async () => {
    const planningApiState = createSeedState();
    const routes = register({
      sendJson(res, code, payload) {
        const text = JSON.stringify(payload, null, 2);
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(text);
      },
      readJsonBody: async (req) => req.__body || {},
    });

    const missingRecord = await invoke(routes, planningApiState, 'DELETE', '/api/planning/records/planning-999999/research/note-0001');
    assert.equal(missingRecord.res.statusCode, 404);

    const missingNote = await invoke(routes, planningApiState, 'DELETE', '/api/planning/records/planning-000001/research/note-9999');
    assert.equal(missingNote.res.statusCode, 404);
  });

  await test('GET /api/planning/records/:id/diagrams returns deterministic diagrams and validation paths', async () => {
    const planningApiState = createSeedState();
    const routes = register({
      sendJson(res, code, payload) {
        const text = JSON.stringify(payload, null, 2);
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(text);
      },
      readJsonBody: async (req) => req.__body || {},
    });

    const diagrams = await invoke(routes, planningApiState, 'GET', '/api/planning/records/planning-000001/diagrams');
    assert.equal(diagrams.res.statusCode, 200);
    const diagramsBody = parseJsonBody(diagrams.res);
    assert.equal(diagramsBody.kind, 'planning.artifacts.diagrams.list');
    assert.deepEqual(
      diagramsBody.diagrams.map((entry) => entry.id),
      ['diagram-001', 'diagram-002']
    );
    assert.equal(diagramsBody.diagrams[0].type, 'diagram');
    assert.equal(diagramsBody.diagrams[0].title, 'Flow A');
    assert.equal(diagramsBody.diagrams[0].format, 'mermaid');
    assert.equal(diagramsBody.diagrams[0].content, 'graph TD; A-->B;');

    const invalidRecord = await invoke(routes, planningApiState, 'GET', '/api/planning/records/%2F/diagrams');
    assert.equal(invalidRecord.res.statusCode, 400);

    const missingRecord = await invoke(routes, planningApiState, 'GET', '/api/planning/records/planning-999999/diagrams');
    assert.equal(missingRecord.res.statusCode, 404);
  });

  if (!process.exitCode) {
    console.log(`planning artifact route tests passed (${passed})`);
  }
}

run().catch((error) => {
  console.error('planning artifact route tests failed');
  console.error(error);
  process.exitCode = 1;
});
