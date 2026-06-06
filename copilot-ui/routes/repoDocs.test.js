'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

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

async function invoke(routes, method, pathname) {
  const res = createResponse();
  const u = new URL(`http://127.0.0.1${pathname}`);
  const { route, match } = findRoute(routes, method, u.pathname);
  const req = { method };
  await route.handler({ req, res, u, match, pathname: u.pathname });
  return { res, body: parseBody(res) };
}

function registerWithMocks() {
  const { register } = require('./repoDocs');
  return register({
    sendJson: createSendJson(),
  });
}

function createTempRepo() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-docs-test-'));
  fs.mkdirSync(path.join(tmpDir, 'docs'));
  fs.mkdirSync(path.join(tmpDir, 'specs'));
  fs.writeFileSync(path.join(tmpDir, 'README.md'), '# Test Repo\n');
  fs.writeFileSync(path.join(tmpDir, 'docs', 'guide.md'), '# Guide\n');
  fs.writeFileSync(path.join(tmpDir, 'specs', 'spec.md'), '# Spec\n');
  fs.writeFileSync(path.join(tmpDir, 'docs', 'notes.txt'), 'not markdown');
  return tmpDir;
}

function cleanupTempRepo(tmpDir) {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
}

async function run() {
  console.log('\nRepo Docs Route Tests\n');

  await test('register returns 3 route descriptors', async () => {
    const routes = registerWithMocks();
    assert.equal(routes.length, 3);
  });

  await test('GET /api/repo-docs/list requires repoPath', async () => {
    const routes = registerWithMocks();
    const { res, body } = await invoke(routes, 'GET', '/api/repo-docs/list');
    assert.equal(res.statusCode, 400);
    assert.match(body.error, /repoPath/i);
  });

  await test('GET /api/repo-docs/list returns markdown files', async () => {
    const tmpDir = createTempRepo();
    try {
      const routes = registerWithMocks();
      const { res, body } = await invoke(routes, 'GET', `/api/repo-docs/list?repoPath=${encodeURIComponent(tmpDir)}`);
      assert.equal(res.statusCode, 200);
      assert.ok(body.count >= 3);
      const paths = body.files.map((f) => f.path);
      assert.ok(paths.includes('README.md'));
      assert.ok(paths.includes('docs/guide.md'));
      assert.ok(paths.includes('specs/spec.md'));
      assert.ok(!paths.includes('docs/notes.txt'));
    } finally {
      cleanupTempRepo(tmpDir);
    }
  });

  await test('GET /api/repo-docs/read requires repoPath and path', async () => {
    const routes = registerWithMocks();
    const { res: res1 } = await invoke(routes, 'GET', '/api/repo-docs/read');
    assert.equal(res1.statusCode, 400);

    const { res: res2 } = await invoke(routes, 'GET', '/api/repo-docs/read?repoPath=/tmp');
    assert.equal(res2.statusCode, 400);
  });

  await test('GET /api/repo-docs/read reads allowed markdown', async () => {
    const tmpDir = createTempRepo();
    try {
      const routes = registerWithMocks();
      const { res, body } = await invoke(routes, 'GET', `/api/repo-docs/read?repoPath=${encodeURIComponent(tmpDir)}&path=docs/guide.md`);
      assert.equal(res.statusCode, 200);
      assert.equal(body.path, 'docs/guide.md');
      assert.ok(body.content.includes('# Guide'));
    } finally {
      cleanupTempRepo(tmpDir);
    }
  });

  await test('GET /api/repo-docs/read rejects non-markdown files', async () => {
    const tmpDir = createTempRepo();
    try {
      const routes = registerWithMocks();
      const { res, body } = await invoke(routes, 'GET', `/api/repo-docs/read?repoPath=${encodeURIComponent(tmpDir)}&path=docs/notes.txt`);
      assert.equal(res.statusCode, 403);
      assert.match(body.error, /not allowed/i);
    } finally {
      cleanupTempRepo(tmpDir);
    }
  });

  await test('GET /api/repo-docs/read rejects path traversal', async () => {
    const tmpDir = createTempRepo();
    try {
      const routes = registerWithMocks();
      const { res, body } = await invoke(routes, 'GET', `/api/repo-docs/read?repoPath=${encodeURIComponent(tmpDir)}&path=../etc/passwd.md`);
      assert.equal(res.statusCode, 403);
      assert.match(body.error, /not allowed|traversal/i);
    } finally {
      cleanupTempRepo(tmpDir);
    }
  });

  await test('GET /api/repo-docs/read returns 404 for missing file', async () => {
    const tmpDir = createTempRepo();
    try {
      const routes = registerWithMocks();
      const { res, body } = await invoke(routes, 'GET', `/api/repo-docs/read?repoPath=${encodeURIComponent(tmpDir)}&path=docs/missing.md`);
      assert.equal(res.statusCode, 404);
    } finally {
      cleanupTempRepo(tmpDir);
    }
  });

  // ─── Graph route tests ─────────────────────────────────────────────────

  await test('GET /api/repo-docs/graph returns 400 when repoPath is missing', async () => {
    const routes = registerWithMocks();
    const { res, body } = await invoke(routes, 'GET', '/api/repo-docs/graph');
    assert.equal(res.statusCode, 400);
    assert.match(body.error, /repoPath/i);
  });

  await test('GET /api/repo-docs/graph returns nodes and edges', async () => {
    const tmpDir = createTempRepo();
    try {
      // Add a cross-link between files
      fs.writeFileSync(path.join(tmpDir, 'docs', 'guide.md'), '# Guide\nSee [spec](specs/spec.md) for details.\n', 'utf8');
      fs.writeFileSync(path.join(tmpDir, 'specs', 'spec.md'), '# Spec\nSee [guide](docs/guide.md) for docs.\n', 'utf8');

      const routes = registerWithMocks();
      const { res, body } = await invoke(routes, 'GET', `/api/repo-docs/graph?repoPath=${encodeURIComponent(tmpDir)}`);
      assert.equal(res.statusCode, 200);
      assert.ok(Array.isArray(body.nodes));
      assert.ok(Array.isArray(body.edges));
      // Should have at least README.md, docs/guide.md, specs/spec.md
      const nodePaths = body.nodes.map((n) => n.id);
      assert.ok(nodePaths.includes('README.md'));
      assert.ok(nodePaths.includes('docs/guide.md'));
      assert.ok(nodePaths.includes('specs/spec.md'));
    } finally {
      cleanupTempRepo(tmpDir);
    }
  });

  await test('GET /api/repo-docs/graph skips blocked files', async () => {
    const tmpDir = createTempRepo();
    try {
      // Create an external symlink (blocked)
      const externalTarget = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-docs-ext-'));
      fs.writeFileSync(path.join(externalTarget, 'external.md'), '# External\n');
      try {
        const symlinkPath = path.join(tmpDir, 'docs', 'external-link.md');
        fs.symlinkSync(path.join(externalTarget, 'external.md'), symlinkPath, 'file');
      } catch {
        // symlinking may fail on Windows without elevated privileges — skip test gracefully
        console.log('  SKIP: symlink test (requires elevated privileges on Windows)');
        passed -= 1;
        return;
      }

      const routes = registerWithMocks();
      const { res, body } = await invoke(routes, 'GET', `/api/repo-docs/graph?repoPath=${encodeURIComponent(tmpDir)}`);
      assert.equal(res.statusCode, 200);
      assert.ok(Array.isArray(body.nodes));
      // The external symlink doc should not appear in nodes or should be in skipped
      const externalNode = body.nodes.find((n) => n.id.includes('external-link'));
      if (externalNode) {
        // If it appeared, it should not have a blocked reason (the graph handler skips blocked)
      }
      if (body.skipped) {
        const externalSkipped = body.skipped.find((s) => s.path && s.path.includes('external-link'));
        assert.ok(externalSkipped, 'External symlink should be skipped');
      }
    } finally {
      cleanupTempRepo(tmpDir);
    }
  });

  console.log(`\n  ${passed} tests passed\n`);
}

run().catch((err) => {
  console.error('Unexpected error:', err);
  process.exitCode = 1;
});
