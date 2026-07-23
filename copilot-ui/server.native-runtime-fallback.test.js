'use strict';
const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { startServer } = require('./server');
const repoInventoryService = require('./lib/repoInventoryService');
function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-native-runtime-fallback-'));
  return Promise.resolve()
    .then(() => fn(dir))
    .finally(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });
}
function requestJson({ method = 'GET', baseUrl, pathname, body }) {
  return new Promise((resolve, reject) => {
    const requestUrl = new URL(pathname, baseUrl);
    const payload = body == null ? null : JSON.stringify(body);
    const req = http.request({
      method,
      hostname: requestUrl.hostname,
      port: requestUrl.port,
      path: `${requestUrl.pathname}${requestUrl.search}`,
      headers: payload
        ? {
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Length': Buffer.byteLength(payload),
          }
        : undefined,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        try {
          resolve({ statusCode: res.statusCode, body: JSON.parse(raw) });
        } catch (error) {
          reject(new Error(`Invalid JSON response: ${error.message}; body=${raw}`));
        }
      });
    });
    req.on('error', reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}
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
async function run() {
  console.log('\nNative Runtime Fallback Route Tests\n');
  await withTempDir(async (tmpRoot) => {
    const elegyHome = path.join(tmpRoot, '.elegy');
    const repoRoot = path.join(tmpRoot, 'repos', 'alpha');
    fs.mkdirSync(repoRoot, { recursive: true });
    childProcess.execFileSync('git', ['init'], { cwd: repoRoot, stdio: 'ignore' });
    repoInventoryService.registerRepo({
      elegyHome,
      repoPath: repoRoot,
      select: true,
    });
    const serverHandle = await startServer({
      host: '127.0.0.1',
      port: 0,
      elegyHome,      sandboxesHome: path.join(elegyHome, 'sandboxes'),
      trackerUrl: 'http://127.0.0.1:4100',
      trackerToken: 'test-token',
      env: {
        ...process.env,
        INSTRUCTION_ENGINE_DISABLE_STARTUP_ASSET_SYNC: '1',
        INSTRUCTION_ENGINE_NATIVE_RUNTIME_URL: '',
        ELEGY_NATIVE_RUNTIME_URL: '',
      },
      quiet: true,
    });
    const baseUrl = `http://${serverHandle.host}:${serverHandle.port}`;
    try {
      await test('GET /api/dashboard/summary returns fallback payload when native runtime is unset', async () => {
        const response = await requestJson({ baseUrl, pathname: '/api/dashboard/summary' });
        assert.strictEqual(response.statusCode, 200);
        assert.strictEqual(typeof response.body.activeSessionCount, 'number');
        assert.strictEqual(typeof response.body.totalSessionCount, 'number');
        assert.ok(['ok', 'degraded', 'error'].includes(response.body.healthIndicator));
        assert.strictEqual(response.body.source, 'server-fallback');
      });
      await test('GET /api/projects lists fallback inventory-backed projects when native runtime is unset', async () => {
        const response = await requestJson({ baseUrl, pathname: '/api/projects' });
        assert.strictEqual(response.statusCode, 200);
        assert.ok(Array.isArray(response.body));
        assert.ok(response.body.length >= 1);
        const project = response.body[0];
        assert.strictEqual(project.repoPath, repoRoot);
      });
      await test('PATCH /api/projects/:id updates fallback project fields when native runtime is unset', async () => {
        const projects = await requestJson({ baseUrl, pathname: '/api/projects' });
        assert.strictEqual(projects.statusCode, 200);
        assert.ok(Array.isArray(projects.body));
        assert.ok(projects.body.length >= 1);
        const targetProjectId = projects.body[0].projectId;
        const update = await requestJson({
          method: 'PATCH',
          baseUrl,
          pathname: `/api/projects/${encodeURIComponent(targetProjectId)}`,
          body: { pinned: true },
        });
        assert.strictEqual(update.statusCode, 200);
        assert.strictEqual(update.body.projectId, targetProjectId);
        assert.strictEqual(update.body.pinned, true);
      });
    } finally {
      await serverHandle.close();
    }
  });
  console.log(`\nCompleted Native Runtime Fallback Route Tests: ${passed} passed, ${failed} failed.`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}
run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
