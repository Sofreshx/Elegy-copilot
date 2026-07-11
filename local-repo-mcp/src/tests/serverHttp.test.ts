import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.resolve(__dirname, '..', 'server.js');

async function getOpenPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Unable to allocate test port.')));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

async function startServer(port: number, authMode: 'disabled' | 'default' = 'disabled'): Promise<ChildProcess> {
  const env = {
    ...process.env,
    LOCAL_REPO_MCP_PORT: String(port),
    LOCAL_REPO_MCP_AUTH_MODE: authMode === 'default' ? undefined : 'disabled',
    LOCAL_REPO_MCP_PUBLIC_BASE_URL: 'https://sample.trycloudflare.com',
    LOCAL_REPO_MCP_ROOTS_JSON: JSON.stringify([{ id: 'repo', label: 'repo', rootPath: process.cwd() }]),
  };
  if (authMode === 'default') delete env.LOCAL_REPO_MCP_AUTH_MODE;
  const child = spawn(process.execPath, [serverPath], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Server did not become ready. Output: ${output}`)), 5000);
    child.stdout?.on('data', (chunk) => {
      output += chunk.toString();
      if (output.includes(`http://127.0.0.1:${port}/mcp`)) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.stderr?.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`Server exited early (${signal || code}). Output: ${output}`));
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });

  return child;
}

async function stopServer(child: ChildProcess): Promise<void> {
  if (child.exitCode != null || child.signalCode != null) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve();
    }, 2000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill();
  });
}

function mcpHeaders(): Record<string, string> {
  return {
    accept: 'application/json, text/event-stream',
    'content-type': 'application/json',
  };
}

test('disabled auth does not publish OAuth protected-resource metadata', async () => {
  const port = await getOpenPort();
  const child = await startServer(port);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/.well-known/oauth-protected-resource`);
    assert.equal(response.status, 404);
    assert.equal(response.headers.has('www-authenticate'), false);
  } finally {
    await stopServer(child);
  }
});

test('default auth mode is anonymous when no auth env is set', async () => {
  const port = await getOpenPort();
  const child = await startServer(port, 'default');
  try {
    const response = await fetch(`http://127.0.0.1:${port}/.well-known/oauth-protected-resource`);
    assert.equal(response.status, 404);
    assert.equal(response.headers.has('www-authenticate'), false);
  } finally {
    await stopServer(child);
  }
});

test('disabled auth lists tools without bearer challenge', async () => {
  const port = await getOpenPort();
  const child = await startServer(port);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: mcpHeaders(),
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    const body = await response.text();
    assert.equal(response.status, 200);
    assert.equal(response.headers.has('www-authenticate'), false);
    assert.match(body, /repo_roots/);
    assert.match(body, /repo_read_many/);
    assert.match(body, /repo_git_changed_files/);
    assert.match(body, /repo_capabilities/);
  } finally {
    await stopServer(child);
  }
});
