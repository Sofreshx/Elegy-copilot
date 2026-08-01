import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import fs from 'node:fs';
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

async function startServer(port: number, authMode: 'disabled' | 'default' | 'builtin' = 'disabled'): Promise<ChildProcess> {
  const publicOrigin = 'https://repo-mcp.example.com';
  const env = {
    ...process.env,
    LOCAL_REPO_MCP_PORT: String(port),
    LOCAL_REPO_MCP_AUTH_MODE: authMode === 'default' ? undefined : authMode === 'builtin' ? 'oauth' : 'disabled',
    LOCAL_REPO_MCP_AUTH_PROVIDER: authMode === 'builtin' ? 'builtin' : undefined,
    LOCAL_REPO_MCP_PUBLIC_BASE_URL: publicOrigin,
    LOCAL_REPO_MCP_AUTH_ISSUER: publicOrigin,
    LOCAL_REPO_MCP_AUTH_AUDIENCE: `${publicOrigin}/mcp`,
    LOCAL_REPO_MCP_APPROVAL_SECRET: authMode === 'builtin' ? 'test-approval-secret' : undefined,
    LOCAL_REPO_MCP_OAUTH_STATE_DIR: authMode === 'builtin' ? fs.mkdtempSync(path.join(os.tmpdir(), 'local-repo-mcp-http-oauth-')) : undefined,
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

test('built-in OAuth completes registration, PKCE authorization, refresh, and revocation flow', async () => {
  const port = await getOpenPort();
  const child = await startServer(port, 'builtin');
  const base = `http://127.0.0.1:${port}`;
  const resource = 'https://repo-mcp.example.com/mcp';
  try {
    const protectedMetadata = await fetch(`${base}/.well-known/oauth-protected-resource`).then((response) => response.json());
    assert.equal(protectedMetadata.resource, resource);

    const unauthorized = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: mcpHeaders(),
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    assert.equal(unauthorized.status, 401);
    assert.match(unauthorized.headers.get('www-authenticate') || '', /resource="https:\/\/repo-mcp\.example\.com\/mcp"/);

    const registration = await fetch(`${base}/oauth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: 'ChatGPT test',
        redirect_uris: ['https://chatgpt.com/connector/oauth/cb'],
        token_endpoint_auth_method: 'none',
      }),
    });
    assert.equal(registration.status, 201);
    const client = await registration.json() as { client_id: string };

    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const authorize = new URL(`${base}/oauth/authorize`);
    authorize.search = new URLSearchParams({
      response_type: 'code',
      client_id: client.client_id,
      redirect_uri: 'https://chatgpt.com/connector/oauth/cb',
      scope: 'repo:read offline_access',
      state: 'state-1',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      resource,
    }).toString();
    const authorizationPage = await fetch(authorize);
    assert.equal(authorizationPage.status, 200);
    assert.match(await authorizationPage.text(), /Approve Local Repo Reader/);

    const pendingResponse = await fetch(`${base}/oauth/pending`, {
      headers: { 'x-local-repo-mcp-approval-secret': 'test-approval-secret' },
    });
    const pending = await pendingResponse.json() as { pending: Array<{ id: string }> };
    assert.equal(pending.pending.length, 1);

    const approval = await fetch(`${base}/oauth/approve`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-local-repo-mcp-approval-secret': 'test-approval-secret',
      },
      body: JSON.stringify({ id: pending.pending[0].id }),
    }).then((response) => response.json()) as { redirectUrl: string };
    const code = new URL(approval.redirectUrl).searchParams.get('code') || '';

    const token = await fetch(`${base}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: 'https://chatgpt.com/connector/oauth/cb',
        code_verifier: verifier,
        client_id: client.client_id,
        resource,
      }),
    }).then((response) => response.json()) as { access_token: string; refresh_token: string };
    assert.ok(token.access_token);
    assert.ok(token.refresh_token);

    const refreshed = await fetch(`${base}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: token.refresh_token,
        client_id: client.client_id,
        resource,
      }),
    }).then((response) => response.json()) as { access_token: string; refresh_token: string };
    assert.ok(refreshed.access_token);
    assert.notEqual(refreshed.refresh_token, token.refresh_token);

    const revocation = await fetch(`${base}/oauth/revoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: refreshed.refresh_token }),
    });
    assert.equal(revocation.status, 200);
    const afterRevocation = await fetch(`${base}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshed.refresh_token,
        client_id: client.client_id,
        resource,
      }),
    });
    assert.equal(afterRevocation.status, 401);
  } finally {
    await stopServer(child);
  }
});
