'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');

const serverPath = path.join(__dirname, 'server.js');

let passed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  PASS: ${name}`);
  } catch (e) {
    console.error(`  FAIL: ${name}`);
    console.error(`    ${e.message}`);
    process.exitCode = 1;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = addr && typeof addr === 'object' ? addr.port : null;
      server.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(port);
      });
    });
    server.on('error', reject);
  });
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        try {
          resolve({ statusCode: res.statusCode, body: JSON.parse(body) });
        } catch (e) {
          reject(new Error(`Invalid JSON response: ${e.message}; body=${body}`));
        }
      });
    });
    req.on('error', reject);
  });
}

async function waitForHealth(baseUrl, attempts = 60) {
  for (let i = 0; i < attempts; i++) {
    try {
      const response = await fetchJson(`${baseUrl}/api/health`);
      if (response.statusCode === 200) return response;
    } catch {
      // retry
    }
    await sleep(100);
  }
  throw new Error('Timed out waiting for server health endpoint');
}

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-runtime-health-'));
  return Promise.resolve()
    .then(() => fn(dir))
    .finally(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });
}

async function run() {
  await test('health payload includes deterministic runtime compatibility contract', async () => {
    await withTempDir(async (root) => {
      const copilotHome = path.join(root, '.copilot');
      const vscodeHome = path.join(root, '.copilot-vscode');
      const sandboxesHome = path.join(root, '.copilot', 'sandboxes');
      fs.mkdirSync(copilotHome, { recursive: true });
      fs.mkdirSync(vscodeHome, { recursive: true });

      const port = await getFreePort();
      const baseUrl = `http://127.0.0.1:${port}`;

      const server = childProcess.spawn(process.execPath, [
        serverPath,
        '--host',
        '127.0.0.1',
        '--port',
        String(port),
        '--copilot-home',
        copilotHome,
        '--vscode-home',
        vscodeHome,
        '--sandboxes-home',
        sandboxesHome,
      ], {
        env: {
          ...process.env,
          INSTRUCTION_ENGINE_RUNTIME_MODE: 'packaged',
          INSTRUCTION_ENGINE_FORCE_DOCKER_STATE: 'unavailable',
          INSTRUCTION_ENGINE_FORCE_WSL2_STATE: 'unavailable',
          INSTRUCTION_ENGINE_FORCE_SANDBOX_STATE: 'unavailable',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });

      let stderr = '';
      server.stderr.on('data', (chunk) => {
        stderr += chunk.toString('utf8');
      });

      try {
        const response = await waitForHealth(baseUrl);
        assert.strictEqual(response.statusCode, 200);
        assert.strictEqual(response.body.ok, true);
        assert.ok(response.body.runtime);
        assert.strictEqual(response.body.runtime.mode, 'packaged');
        assert.strictEqual(response.body.runtime.capabilities.docker, 'unavailable');
        assert.strictEqual(response.body.runtime.capabilities.wsl2, 'unavailable');
        assert.strictEqual(response.body.runtime.capabilities.sandbox, 'unavailable');
        assert.strictEqual(typeof response.body.runtime.contractVersion, 'string');
      } finally {
        server.kill();
        await sleep(150);
      }

      if (stderr.trim()) {
        assert.ok(!/Error:/i.test(stderr), `Server stderr contained error output: ${stderr}`);
      }
    });
  });

  console.log(`\n${passed} tests passed`);
  if (process.exitCode) {
    console.error('Some tests FAILED');
  } else {
    console.log('All tests passed');
  }
}

run().catch((e) => {
  console.error(e.stack || e.message || String(e));
  process.exit(1);
});
