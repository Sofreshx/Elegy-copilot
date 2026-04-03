'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { startServer } = require('../server');

const DESKTOP_UI_ACCESS_HEADER = 'x-elegy-desktop-ui-token';

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

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = addr && typeof addr === 'object' ? addr.port : null;
      server.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
    server.on('error', reject);
  });
}

function httpRequest(baseUrl, method, routePath, options = {}) {
  return new Promise((resolve) => {
    const url = new URL(routePath, baseUrl);
    const req = http.request(
      {
        method,
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        headers: options.headers || {},
        timeout: 5000,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const rawBody = Buffer.concat(chunks).toString('utf8');
          const contentType = typeof res.headers['content-type'] === 'string' ? res.headers['content-type'] : '';
          let body = null;
          let json = false;
          try {
            body = rawBody.length > 0 ? JSON.parse(rawBody) : null;
            json = true;
          } catch {
            body = rawBody;
          }
          resolve({
            status: res.statusCode,
            contentType,
            rawBody,
            body,
            json,
            headers: res.headers,
            error: null,
          });
        });
      }
    );

    req.on('error', (error) => {
      resolve({
        status: null,
        contentType: '',
        rawBody: '',
        body: null,
        json: false,
        headers: {},
        error,
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error('request timed out'));
    });

    req.end();
  });
}

async function run() {
  console.log('\nSmoke Tests - copilot-ui server decomposition\n');

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-ui-smoke-'));
  const copilotHome = path.join(tmpRoot, '.copilot');
  const vscodeHome = path.join(tmpRoot, '.copilot-vscode');
  const sandboxesHome = path.join(tmpRoot, '.copilot', 'sandboxes');
  fs.mkdirSync(copilotHome, { recursive: true });
  fs.mkdirSync(vscodeHome, { recursive: true });
  fs.mkdirSync(sandboxesHome, { recursive: true });

  const port = await getFreePort();
  const host = '127.0.0.1';
  const baseUrl = `http://${host}:${port}`;

  let running = null;
  let closedInTest = false;

  try {
    running = await startServer({
      host,
      port,
      desktopUiToken: 'desktop-smoke-token',
      copilotHome,
      vscodeHome,
      sandboxesHome,
      quiet: true,
    });

    await test('startServer() resolves contract with required keys', async () => {
      assert.ok(running && typeof running === 'object');
      const expectedKeys = [
        'server',
        'host',
        'port',
        'token',
        'copilotHome',
        'vscodeHome',
        'sandboxesHome',
        'trackerUrl',
        'close',
      ];

      for (const key of expectedKeys) {
        assert.ok(Object.prototype.hasOwnProperty.call(running, key), `Missing key: ${key}`);
      }

      assert.ok(running.server && typeof running.server.close === 'function');
      assert.strictEqual(running.host, host);
      assert.strictEqual(running.port, port);
    });

    await test('GET /api/health returns 200 JSON', async () => {
      const response = await httpRequest(baseUrl, 'GET', '/api/health');
      assert.strictEqual(response.status, 200);
      assert.ok(response.contentType.toLowerCase().includes('application/json'));
      assert.strictEqual(response.json, true);
      assert.ok(response.body && typeof response.body === 'object');
    });

    await test('plain browser request to / is denied and does not receive the dashboard UI', async () => {
      const response = await httpRequest(baseUrl, 'GET', '/');

      assert.strictEqual(response.status, 403);
      assert.ok(response.contentType.toLowerCase().includes('text/plain'));
      assert.strictEqual(response.json, false);
      assert.ok(String(response.body).includes('Desktop UI access is restricted'));
    });

    await test('desktop token handshake establishes a UI session and serves the dashboard', async () => {
      const bootstrapResponse = await httpRequest(baseUrl, 'GET', '/', {
        headers: {
          [DESKTOP_UI_ACCESS_HEADER]: 'desktop-smoke-token',
        },
      });

      assert.strictEqual(bootstrapResponse.status, 302);
      assert.strictEqual(bootstrapResponse.headers.location, '/');

      const setCookie = bootstrapResponse.headers['set-cookie'];
      assert.ok(Array.isArray(setCookie) && setCookie.length > 0, 'Expected desktop UI session cookie');

      const dashboardResponse = await httpRequest(baseUrl, 'GET', '/', {
        headers: {
          Cookie: setCookie[0].split(';')[0],
        },
      });

      assert.strictEqual(dashboardResponse.status, 200);
      assert.ok(dashboardResponse.contentType.toLowerCase().includes('text/html'));
      assert.ok(dashboardResponse.rawBody.includes('<!doctype html') || dashboardResponse.rawBody.includes('<!DOCTYPE html'));
    });

    await test("Unknown API path returns 404 JSON { error: 'Not found' }", async () => {
      const response = await httpRequest(baseUrl, 'GET', '/api/does-not-exist');
      assert.strictEqual(response.status, 404);
      assert.ok(response.contentType.toLowerCase().includes('application/json'));
      assert.strictEqual(response.json, true);
      assert.ok(response.body && typeof response.body === 'object');
      assert.strictEqual(response.body.error, 'Not found');
    });

    await test('close is callable and cleanly shuts server down', async () => {
      assert.strictEqual(typeof running.close, 'function');
      await running.close();
      closedInTest = true;
      assert.strictEqual(running.server.listening, false);

      const responseAfterClose = await httpRequest(baseUrl, 'GET', '/api/health');
      assert.strictEqual(responseAfterClose.status, null);
      assert.ok(responseAfterClose.error instanceof Error);
    });
  } finally {
    if (running && !closedInTest) {
      await running.close();
    }
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }

  console.log(`\n  ${passed} passed, ${failed} failed (${passed + failed} total)\n`);
}

run().catch((error) => {
  console.error(`\n  FATAL: ${error.message}\n`);
  process.exitCode = 1;
});