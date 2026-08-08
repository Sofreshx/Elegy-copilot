'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createAsyncProcessService } = require('./asyncProcessService');

test('deduplicates in-flight reads and reuses bounded cache entries', async () => {
  let calls = 0;
  let complete;
  const service = createAsyncProcessService({
    childProcess: {
      execFile(_command, _args, _options, callback) {
        calls += 1;
        complete = callback;
      },
    },
  });

  const first = service.run('git', ['status'], { cwd: __dirname, cacheTtlMs: 1_000 });
  const second = service.run('git', ['status'], { cwd: __dirname, cacheTtlMs: 1_000 });
  assert.equal(calls, 1);
  complete(null, 'clean\n', '');

  const [left, right] = await Promise.all([first, second]);
  assert.equal(left.stdout, 'clean\n');
  assert.equal(right.deduped, true);

  const cached = await service.run('git', ['status'], { cwd: __dirname, cacheTtlMs: 1_000 });
  assert.equal(cached.cached, true);
  assert.equal(calls, 1);
  assert.equal(service.getDiagnostics().dedupeHits, 1);
  assert.equal(service.getDiagnostics().cacheHits, 1);
});

test('does not cache failed or aborted probe results', async () => {
  let calls = 0;
  const service = createAsyncProcessService({
    childProcess: {
      execFile(_command, _args, _options, callback) {
        calls += 1;
        queueMicrotask(() => callback(Object.assign(new Error('failed'), { code: 1 }), '', 'failed'));
        return { pid: 1234 };
      },
    },
  });
  await service.run('git', ['status'], { cacheTtlMs: 1_000 });
  await service.run('git', ['status'], { cacheTtlMs: 1_000 });
  assert.equal(calls, 2);
  assert.equal(service.getDiagnostics().cacheEntries, 0);
});

test('enforces process timeout and reports only redacted command labels', async () => {
  const service = createAsyncProcessService();
  const result = await service.run(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], {
    timeoutMs: 50,
    maxOutputBytes: 16 * 1024,
    dedupe: false,
  });

  assert.notEqual(result.status, 0);
  assert.equal(result.timedOut, true);
  const diagnostics = service.getDiagnostics();
  assert.equal(diagnostics.timedOut, 1);
  assert.deepEqual(Object.keys(diagnostics.byCommand), ['node']);
  assert.equal(JSON.stringify(diagnostics).includes(__dirname), false);
});

test('caps combined process output through execFile maxBuffer', async () => {
  const service = createAsyncProcessService();
  const result = await service.run(process.execPath, ['-e', 'process.stdout.write("x".repeat(8192))'], {
    timeoutMs: 2_000,
    maxOutputBytes: 1024,
    dedupe: false,
  });

  assert.notEqual(result.status, 0);
  assert.equal(result.outputLimited, true);
  assert.equal(service.getDiagnostics().outputLimited, 1);
});

test('aborts an in-flight process and terminates its process tree', async () => {
  const controller = new AbortController();
  let killedPid = null;
  const service = createAsyncProcessService({
    childProcess: {
      execFile() {
        return { pid: 4321, kill() { killedPid = 4321; } };
      },
    },
    async terminateTree(child) { killedPid = child.pid; },
  });

  const pending = service.run('git', ['status'], {
    signal: controller.signal,
    timeoutMs: 5_000,
    dedupe: false,
  });
  controller.abort();
  const result = await pending;

  assert.equal(result.aborted, true);
  assert.equal(result.timedOut, false);
  assert.equal(killedPid, 4321);
});

test('one signalled subscriber can abort while a shared probe completes and caches', async () => {
  let calls = 0;
  let complete;
  const service = createAsyncProcessService({
    childProcess: {
      execFile(_command, _args, _options, callback) {
        calls += 1;
        complete = callback;
        return { pid: 4321 };
      },
    },
    async terminateTree() {},
  });
  const firstController = new AbortController();
  const secondController = new AbortController();
  const first = service.run('git', ['status'], { signal: firstController.signal, cacheTtlMs: 1_000 });
  const second = service.run('git', ['status'], { signal: secondController.signal, cacheTtlMs: 1_000 });
  firstController.abort();
  complete(null, 'clean', '');
  const [aborted, completed] = await Promise.all([first, second]);
  assert.equal(aborted.aborted, true);
  assert.equal(completed.status, 0);
  assert.equal(calls, 1);
  const cached = await service.run('git', ['status'], { cacheTtlMs: 1_000 });
  assert.equal(cached.cached, true);
});

test('a deterministic slow subprocess does not block a concurrent /api/health request', async () => {
  const service = createAsyncProcessService();
  const server = http.createServer(async (req, res) => {
    if (req.url === '/slow') {
      await service.run(process.execPath, ['-e', 'setTimeout(() => {}, 750)'], { timeoutMs: 1_000, dedupe: false });
    }
    res.end(req.url === '/api/health' ? 'ok' : 'done');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    const origin = `http://127.0.0.1:${address.port}`;
    const slow = fetch(`${origin}/slow`);
    await new Promise((resolve) => setTimeout(resolve, 25));
    const startedAt = Date.now();
    const health = await fetch(`${origin}/api/health`);
    const healthDelayMs = Date.now() - startedAt;
    assert.equal(await health.text(), 'ok');
    assert.ok(healthDelayMs < 500, `health request was delayed ${healthDelayMs}ms`);
    await slow;
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('default timeout terminates a spawned child and its grandchild', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'elegy-process-tree-'));
  const pidPath = path.join(tempRoot, 'grandchild.pid');
  const parentScript = [
    "const { spawn } = require('node:child_process')",
    "const fs = require('node:fs')",
    "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })",
    `fs.writeFileSync(${JSON.stringify(pidPath)}, String(child.pid))`,
    "setInterval(() => {}, 1000)",
  ].join(';');
  try {
    const service = createAsyncProcessService();
    const result = await service.run(process.execPath, ['-e', parentScript], { timeoutMs: 500, dedupe: false });
    assert.equal(result.timedOut, true);
    const grandchildPid = Number(fs.readFileSync(pidPath, 'utf8'));
    let alive = true;
    for (let attempt = 0; attempt < 20 && alive; attempt += 1) {
      try { process.kill(grandchildPid, 0); } catch { alive = false; }
      if (alive) await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(alive, false, `grandchild ${grandchildPid} survived timeout`);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
