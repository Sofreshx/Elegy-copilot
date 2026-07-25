'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { startServer } = require('./server');

test('desktop backend starts and stops Local Repo MCP lifecycle supervision', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elegy-mcp-lifecycle-server-'));
  const elegyHome = path.join(root, '.elegy');
  const calls = [];
  const localRepoMcpManager = {
    async initializeManagedLifecycle(options) {
      calls.push({ kind: 'initialize', options });
      return { lifecycle: { code: 'autostart_disabled' } };
    },
    async shutdownManagedLifecycle(options) {
      calls.push({ kind: 'shutdown', options });
    },
  };
  const server = await startServer({
    host: '127.0.0.1',
    port: 0,
    elegyHome,
    sandboxesHome: path.join(elegyHome, 'sandboxes'),
    env: {
      ...process.env,
      INSTRUCTION_ENGINE_DISABLE_STARTUP_ASSET_SYNC: '1',
    },
    quiet: true,
    localRepoMcpManager,
  });
  try {
    assert.equal(calls.length, 1);
    assert.equal(calls[0].kind, 'initialize');
    assert.equal(calls[0].options.elegyHomeAbs, path.resolve(elegyHome));
    assert.equal(calls[0].options.engineRoot, path.resolve(__dirname, '..'));
  } finally {
    await server.close();
  }
  assert.equal(calls.length, 2);
  assert.equal(calls[1].kind, 'shutdown');
  assert.equal(calls[1].options.stopProcesses, true);
});
