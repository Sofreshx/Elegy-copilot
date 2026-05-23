"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_net_1 = __importDefault(require("node:net"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const node_test_1 = __importDefault(require("node:test"));
const workflowSidecar_1 = require("./workflowSidecar");
async function withEnv(name, value, fn) {
    const previous = process.env[name];
    if (value === undefined) {
        delete process.env[name];
    }
    else {
        process.env[name] = value;
    }
    try {
        await fn();
    }
    finally {
        if (previous === undefined) {
            delete process.env[name];
        }
        else {
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
async function getFreePort() {
    return await new Promise((resolve, reject) => {
        const server = node_net_1.default.createServer();
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            if (!address || typeof address === 'string') {
                server.close(() => reject(new Error('Unable to resolve a free port for workflow sidecar test.')));
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
async function removeDirWithRetries(targetPath, attempts = 20) {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            node_fs_1.default.rmSync(targetPath, { recursive: true, force: true });
            return;
        }
        catch (error) {
            if (!(error instanceof Error && 'code' in error)
                || ((error.code !== 'EBUSY') && (error.code !== 'ENOTEMPTY'))
                || attempt === attempts) {
                throw error;
            }
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
    }
}
(0, node_test_1.default)('workflow sidecar stays unavailable until the authenticated status probe succeeds', async () => {
    const runtimeRoot = node_fs_1.default.mkdtempSync(node_path_1.default.join(node_os_1.default.tmpdir(), 'ie-workflow-sidecar-'));
    const sidecarDir = node_path_1.default.join(runtimeRoot, 'local-tracker', 'dist', 'messagingGateway');
    node_fs_1.default.mkdirSync(sidecarDir, { recursive: true });
    node_fs_1.default.writeFileSync(node_path_1.default.join(sidecarDir, 'workflowSidecar.js'), `
      const http = require('node:http');
      const token = process.env.INSTRUCTION_ENGINE_WORKFLOW_SIDECAR_TOKEN;
      const host = process.env.INSTRUCTION_ENGINE_WORKFLOW_SIDECAR_HOST || '127.0.0.1';
      const port = Number(process.env.INSTRUCTION_ENGINE_WORKFLOW_SIDECAR_PORT || '4111');
      const delayMs = Number(process.env.INSTRUCTION_ENGINE_TEST_WORKFLOW_SIDECAR_DELAY_MS || '0');

      const isAuthorized = (req) => req.headers.authorization === 'Bearer ' + token;
      const server = http.createServer((req, res) => {
        if (!isAuthorized(req)) {
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
    `, 'utf8');
    const token = 'workflow-sidecar-test-token';
    const port = await getFreePort();
    try {
        await withEnv('INSTRUCTION_ENGINE_ENABLE_WORKFLOW_SIDECAR', '1', async () => {
            await withEnv('INSTRUCTION_ENGINE_WORKFLOW_SIDECAR_TOKEN', token, async () => {
                await withEnv('INSTRUCTION_ENGINE_WORKFLOW_SIDECAR_PORT', String(port), async () => {
                    await withEnv('INSTRUCTION_ENGINE_TEST_WORKFLOW_SIDECAR_DELAY_MS', '250', async () => {
                        const manager = await (0, workflowSidecar_1.startWorkflowSidecar)({
                            runtimeRoot,
                            processExecPath: process.execPath,
                            isPackaged: false,
                            copilotHome: runtimeRoot,
                        });
                        try {
                            strict_1.default.equal(manager.getPublicState().state, 'unavailable');
                            strict_1.default.equal(manager.getDispatchTarget(), null);
                            await waitFor(() => manager.getPublicState().state === 'ready', 5_000);
                            strict_1.default.equal(manager.getPublicState().state, 'ready');
                            strict_1.default.ok(manager.getDispatchTarget());
                        }
                        finally {
                            await manager.stop();
                        }
                    });
                });
            });
        });
    }
    finally {
        await removeDirWithRetries(runtimeRoot);
    }
});
