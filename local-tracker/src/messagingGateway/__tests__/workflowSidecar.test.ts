import http from 'http';
import net from 'net';

import { WorkflowSidecarServer } from '../workflowSidecar';

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

async function getFreePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer();
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

async function requestJson(options: http.RequestOptions, body?: unknown): Promise<{ statusCode: number; body: any }> {
  return await new Promise((resolve, reject) => {
    const request = http.request(options, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      response.on('end', () => {
        const rawBody = Buffer.concat(chunks).toString('utf8').trim();
        resolve({
          statusCode: Number(response.statusCode) || 500,
          body: rawBody ? JSON.parse(rawBody) : null,
        });
      });
    });
    request.on('error', reject);
    if (body !== undefined) {
      request.write(JSON.stringify(body));
    }
    request.end();
  });
}

describe('workflow sidecar fail-closed posture', () => {
  it('reports unavailable until a verified runtime binding exists', async () => {
    const port = await getFreePort();

    await withEnv('INSTRUCTION_ENGINE_WORKFLOW_SIDECAR_TOKEN', 'test-token', async () => {
      await withEnv('INSTRUCTION_ENGINE_WORKFLOW_SIDECAR_PORT', String(port), async () => {
        const server = new WorkflowSidecarServer();
        await server.start();

        try {
          const response = await requestJson({
            hostname: '127.0.0.1',
            port,
            path: '/api/status',
            method: 'GET',
            headers: {
              Authorization: 'Bearer test-token',
            },
          });

          expect(response.statusCode).toBe(200);
          expect(response.body.state).toBe('unavailable');
          expect(response.body.ready).toBe(false);
          expect(response.body.runtime).toBe('contract-only');
          expect(response.body.runtimeBinding).toEqual({
            present: false,
            verified: false,
            reason: 'workflow_runtime_binding_missing',
          });
        } finally {
          await server.stop();
        }
      });
    });
  });

  it('rejects trigger dispatch while no verified runtime binding exists', async () => {
    const port = await getFreePort();

    await withEnv('INSTRUCTION_ENGINE_WORKFLOW_SIDECAR_TOKEN', 'test-token', async () => {
      await withEnv('INSTRUCTION_ENGINE_WORKFLOW_SIDECAR_PORT', String(port), async () => {
        const server = new WorkflowSidecarServer();
        await server.start();

        try {
          const triggerResponse = await requestJson(
            {
              hostname: '127.0.0.1',
              port,
              path: '/api/triggers',
              method: 'POST',
              headers: {
                Authorization: 'Bearer test-token',
                'Content-Type': 'application/json',
              },
            },
            {
              triggerId: 'trigger-1',
              eventType: 'executor.run.queued',
              at: '2026-04-07T00:00:00.000Z',
              source: 'executor',
            },
          );

          expect(triggerResponse.statusCode).toBe(503);
          expect(triggerResponse.body.accepted).toBe(false);
          expect(triggerResponse.body.code).toBe('workflow_runtime_binding_missing');

          const statusResponse = await requestJson({
            hostname: '127.0.0.1',
            port,
            path: '/api/status',
            method: 'GET',
            headers: {
              Authorization: 'Bearer test-token',
            },
          });

          expect(statusResponse.body.capturedTriggerCount).toBe(0);
          expect(statusResponse.body.lastTriggerAt).toBeNull();
        } finally {
          await server.stop();
        }
      });
    });
  });
});
