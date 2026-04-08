import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { startWorkflowSidecar } from './workflowSidecar';

async function withEnv(name: string, value: string | undefined, fn: () => Promise<void>): Promise<void> {
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

async function waitFor(condition: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Timed out waiting for condition.');
}

test('workflow sidecar stays unavailable until the authenticated status probe succeeds', async () => {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-workflow-sidecar-'));
  const sidecarDir = path.join(runtimeRoot, 'local-tracker', 'dist', 'messagingGateway');
  fs.mkdirSync(sidecarDir, { recursive: true });
  fs.writeFileSync(
    path.join(sidecarDir, 'workflowSidecar.js'),
    `
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
            auth: 'bearer',
            loopbackOnly: true,
            triggerPath: '/api/triggers',
            healthPath: '/api/status',
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
    `,
    'utf8',
  );

  const token = 'workflow-sidecar-test-token';
  const port = 4181;

  try {
    await withEnv('INSTRUCTION_ENGINE_ENABLE_WORKFLOW_SIDECAR', '1', async () => {
      await withEnv('INSTRUCTION_ENGINE_WORKFLOW_SIDECAR_TOKEN', token, async () => {
        await withEnv('INSTRUCTION_ENGINE_WORKFLOW_SIDECAR_PORT', String(port), async () => {
          await withEnv('INSTRUCTION_ENGINE_TEST_WORKFLOW_SIDECAR_DELAY_MS', '250', async () => {
            const manager = await startWorkflowSidecar({
              runtimeRoot,
              processExecPath: process.execPath,
              isPackaged: false,
              copilotHome: runtimeRoot,
            });

            try {
              assert.equal(manager.getPublicState().state, 'unavailable');
              assert.equal(manager.getDispatchTarget(), null);

              await waitFor(() => manager.getPublicState().state === 'ready', 5_000);

              assert.equal(manager.getPublicState().state, 'ready');
              assert.ok(manager.getDispatchTarget());
            } finally {
              await manager.stop();
            }
          });
        });
      });
    });
  } finally {
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }
});
