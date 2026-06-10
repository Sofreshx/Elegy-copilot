'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const ts = require('typescript');

let passed = 0;

function loadWorkflowSidecarModule() {
  const modulePath = path.join(__dirname, '..', 'src', 'workflowSidecar.ts');
  const source = fs.readFileSync(modulePath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2021,
      esModuleInterop: true,
    },
    fileName: modulePath,
  });

  const testModule = new Module(modulePath, module);
  testModule.filename = modulePath;
  testModule.paths = Module._nodeModulePaths(path.dirname(modulePath));
  const originalRequire = testModule.require.bind(testModule);
  testModule.require = (request) => {
    if (request === './gatewayChildMode') {
      return {
        buildPackagedWorkflowSidecarChildArgs: () => [],
      };
    }
    return originalRequire(request);
  };
  testModule._compile(transpiled.outputText, modulePath);
  return testModule.exports;
}

const { startWorkflowSidecar } = loadWorkflowSidecarModule();

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

async function withEnv(name, value, fn) {
  const previous = process.env[name];
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }

  try {
    await fn();
  } finally {
    if (previous === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = previous;
    }
  }
}

async function waitFor(condition, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Timed out waiting for condition.');
}

async function removeDirWithRetries(targetPath, attempts = 20) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      fs.rmSync(targetPath, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!error || (error.code !== 'EBUSY' && error.code !== 'ENOTEMPTY') || attempt === attempts) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}

async function getFreePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Unable to resolve a free port for workflow sidecar readiness test.')));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

function writeSidecarFixture(runtimeRoot, fixtureSource) {
  const sidecarDir = path.join(runtimeRoot, 'local-tracker', 'dist', 'messagingGateway');
  fs.mkdirSync(sidecarDir, { recursive: true });
  fs.writeFileSync(path.join(sidecarDir, 'workflowSidecar.js'), fixtureSource, 'utf8');
}

async function run() {
  await test('contract-only sidecar stays unavailable and never exposes a dispatch target', async () => {
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-workflow-sidecar-'));
    const port = await getFreePort();
    writeSidecarFixture(runtimeRoot, `
      const http = require('node:http');
      const token = process.env.INSTRUCTION_ENGINE_WORKFLOW_SIDECAR_TOKEN;
      const host = process.env.INSTRUCTION_ENGINE_WORKFLOW_SIDECAR_HOST || '127.0.0.1';
      const port = Number(process.env.INSTRUCTION_ENGINE_WORKFLOW_SIDECAR_PORT || '4111');

      const server = http.createServer((req, res) => {
        if (req.headers.authorization !== 'Bearer ' + token) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unauthorized' }));
          return;
        }
        if (req.method === 'GET' && req.url === '/api/status') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            state: 'unavailable',
            runtime: 'contract-only',
            auth: 'bearer',
            loopbackOnly: true,
            triggerPath: '/api/triggers',
            healthPath: '/api/status',
            runtimeBinding: {
              present: false,
              verified: false,
              reason: 'workflow_runtime_binding_missing',
            },
            lastError: 'Workflow sidecar runtime binding is unavailable.',
          }));
          return;
        }
        if (req.method === 'POST' && req.url === '/api/triggers') {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            accepted: false,
            code: 'workflow_runtime_binding_missing',
          }));
          return;
        }
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
      });

      server.listen(port, host);

      const shutdown = () => server.close(() => process.exit(0));
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    `);

    try {
      await withEnv('INSTRUCTION_ENGINE_ENABLE_WORKFLOW_SIDECAR', '1', async () => {
        await withEnv('INSTRUCTION_ENGINE_WORKFLOW_SIDECAR_TOKEN', 'workflow-sidecar-test-token', async () => {
          await withEnv('INSTRUCTION_ENGINE_WORKFLOW_SIDECAR_PORT', String(port), async () => {
            const manager = await startWorkflowSidecar({
              runtimeRoot,
              processExecPath: process.execPath,
              isPackaged: false,
              elegyHome: runtimeRoot,
            });

            try {
              await waitFor(() => manager.getPublicState().lastError !== null, 5_000);
              assert.equal(manager.getPublicState().state, 'unavailable');
              assert.equal(manager.getPublicState().runtime, 'contract-only');
              assert.deepEqual(manager.getPublicState().runtimeBinding, {
                present: false,
                verified: false,
                reason: 'workflow_runtime_binding_missing',
              });
              assert.equal(manager.getDispatchTarget(), null);
            } finally {
              await manager.stop();
            }
          });
        });
      });
    } finally {
      await removeDirWithRetries(runtimeRoot);
    }
  });

  await test('verified sidecar becomes ready only after the authenticated readiness probe succeeds', async () => {
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-workflow-sidecar-'));
    const port = await getFreePort();
    writeSidecarFixture(runtimeRoot, `
      const http = require('node:http');
      const token = process.env.INSTRUCTION_ENGINE_WORKFLOW_SIDECAR_TOKEN;
      const host = process.env.INSTRUCTION_ENGINE_WORKFLOW_SIDECAR_HOST || '127.0.0.1';
      const port = Number(process.env.INSTRUCTION_ENGINE_WORKFLOW_SIDECAR_PORT || '4111');
      const delayMs = Number(process.env.INSTRUCTION_ENGINE_TEST_WORKFLOW_SIDECAR_DELAY_MS || '0');

      const server = http.createServer((req, res) => {
        if (req.headers.authorization !== 'Bearer ' + token) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unauthorized' }));
          return;
        }
        if (req.method === 'GET' && req.url === '/api/status') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            state: 'ready',
            runtime: 'n8n',
            auth: 'bearer',
            loopbackOnly: true,
            triggerPath: '/api/triggers',
            healthPath: '/api/status',
            runtimeBinding: {
              present: true,
              verified: true,
              reason: null,
            },
          }));
          return;
        }
        if (req.method === 'POST' && req.url === '/api/triggers') {
          res.writeHead(202, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ accepted: true }));
          return;
        }
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
      });

      setTimeout(() => {
        server.listen(port, host);
      }, delayMs);

      const shutdown = () => server.close(() => process.exit(0));
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    `);

    try {
      await withEnv('INSTRUCTION_ENGINE_ENABLE_WORKFLOW_SIDECAR', '1', async () => {
        await withEnv('INSTRUCTION_ENGINE_WORKFLOW_SIDECAR_TOKEN', 'workflow-sidecar-test-token', async () => {
          await withEnv('INSTRUCTION_ENGINE_WORKFLOW_SIDECAR_PORT', String(port), async () => {
            await withEnv('INSTRUCTION_ENGINE_TEST_WORKFLOW_SIDECAR_DELAY_MS', '250', async () => {
              const manager = await startWorkflowSidecar({
                runtimeRoot,
                processExecPath: process.execPath,
                isPackaged: false,
                elegyHome: runtimeRoot,
              });

              try {
                assert.equal(manager.getPublicState().state, 'unavailable');
                assert.equal(manager.getDispatchTarget(), null);

                await waitFor(() => manager.getPublicState().state === 'ready', 5_000);

                assert.equal(manager.getPublicState().runtime, 'n8n');
                assert.deepEqual(manager.getPublicState().runtimeBinding, {
                  present: true,
                  verified: true,
                  reason: null,
                });
                assert.ok(manager.getDispatchTarget());
              } finally {
                await manager.stop();
              }
            });
          });
        });
      });
    } finally {
      await removeDirWithRetries(runtimeRoot);
    }
  });

  console.log(`\n  ${passed} passed, ${process.exitCode ? 'some failed' : '0 failed'}\n`);
}

run().catch((error) => {
  console.error(`\n  FATAL: ${error.message}\n`);
  process.exitCode = 1;
});
