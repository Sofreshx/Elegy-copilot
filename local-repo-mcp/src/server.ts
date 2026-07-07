import http from 'node:http';
import crypto from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { getOAuthConfig, getRepoRoots, PORT } from './config.js';
import { AuthError, buildProtectedResourceMetadata, buildWwwAuthenticate, verifyRequest } from './auth.js';
import {
  LocalOAuthError,
  approvePendingAuthorization,
  buildAuthorizationServerMetadata,
  createPendingAuthorization,
  exchangeAuthorizationCode,
  getAuthorizationStatus,
  getPublicJwks,
  listPendingAuthorizations,
} from './localOAuth.js';
import { isMcpPathAllowed } from './publicAccess.js';
import { findRoot, gitLog, gitStatus, listTree, readFile, searchText, toPublicRoot } from './repoAccess.js';

type ToolArgs = Record<string, unknown>;
const oauth = getOAuthConfig();
const approvalSecret = process.env.LOCAL_REPO_MCP_APPROVAL_SECRET || '';

function asText(payload: unknown) {
  return {
    content: [{ type: 'text' as const, text: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2) }],
  };
}

function stringArg(args: ToolArgs, name: string): string {
  const value = args[name];
  if (typeof value !== 'string') throw new Error(`${name} must be a string.`);
  return value;
}

function optionalStringArg(args: ToolArgs, name: string, fallback: string): string {
  const value = args[name];
  if (value === undefined) return fallback;
  if (typeof value !== 'string') throw new Error(`${name} must be a string.`);
  return value;
}

function optionalNumberArg(args: ToolArgs, name: string, fallback: number): number {
  const value = args[name];
  if (value === undefined) return fallback;
  if (typeof value !== 'number') throw new Error(`${name} must be a number.`);
  return value;
}

function registerTool(
  server: McpServer,
  name: string,
  config: { description: string; inputSchema: Record<string, z.ZodTypeAny> },
  handler: (args: ToolArgs) => Promise<ReturnType<typeof asText>>,
): void {
  const toolConfig = oauth.enabled
    ? {
      ...config,
      _meta: {
        securitySchemes: [{
          type: 'oauth2',
          scopes: oauth.requiredScopes,
        }],
      },
    }
    : config;

  server.registerTool(name, {
    ...toolConfig,
  } as never, handler as never);
}

function createMcpServer(): McpServer {
  const server = new McpServer({ name: 'local-repo-reader', version: '0.1.0' });

  registerTool(server, 'repo_roots', {
    description: 'List the local roots exposed by this read-only MCP server.',
    inputSchema: {},
  }, async () => asText({ roots: getRepoRoots().map(toPublicRoot) }));

  registerTool(server, 'repo_tree', {
    description: 'List files and directories under an exposed root. Paths are relative to the selected root.',
    inputSchema: { rootId: z.string(), path: z.string().optional(), limit: z.number().int().min(1).max(2000).optional() },
  }, async (args) => {
    const roots = getRepoRoots();
    const rootId = stringArg(args, 'rootId');
    return asText({
      rootId,
      entries: await listTree(findRoot(roots, rootId), optionalStringArg(args, 'path', '.'), optionalNumberArg(args, 'limit', 500)),
    });
  });

  registerTool(server, 'repo_read_file', {
    description: 'Read one text file from an exposed root. The file must be below the size limit and not denied.',
    inputSchema: { rootId: z.string(), path: z.string() },
  }, async (args) => {
    const roots = getRepoRoots();
    return asText(await readFile(findRoot(roots, stringArg(args, 'rootId')), stringArg(args, 'path')));
  });

  registerTool(server, 'repo_search', {
    description: 'Search text in allowed files under an exposed root.',
    inputSchema: { rootId: z.string(), query: z.string(), path: z.string().optional(), limit: z.number().int().min(1).max(500).optional() },
  }, async (args) => {
    const roots = getRepoRoots();
    const rootId = stringArg(args, 'rootId');
    const query = stringArg(args, 'query');
    return asText({
      rootId,
      query,
      matches: await searchText(findRoot(roots, rootId), query, optionalStringArg(args, 'path', '.'), optionalNumberArg(args, 'limit', 100)),
    });
  });

  registerTool(server, 'repo_git_status', {
    description: 'Return git status --short for an exposed root when it is a valid git worktree.',
    inputSchema: { rootId: z.string() },
  }, async (args) => {
    const roots = getRepoRoots();
    return asText(await gitStatus(findRoot(roots, stringArg(args, 'rootId'))));
  });

  registerTool(server, 'repo_git_log', {
    description: 'Return recent git commits for an exposed root when it is a valid git worktree.',
    inputSchema: { rootId: z.string(), limit: z.number().int().min(1).max(100).optional() },
  }, async (args) => {
    const roots = getRepoRoots();
    return asText(await gitLog(findRoot(roots, stringArg(args, 'rootId')), optionalNumberArg(args, 'limit', 20)));
  });

  return server;
}

function sendJson(res: http.ServerResponse, statusCode: number, payload: unknown, headers: Record<string, string> = {}) {
  res.writeHead(statusCode, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(payload));
}

function sendHtml(res: http.ServerResponse, statusCode: number, html: string): void {
  res.writeHead(statusCode, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
      if (body.length > 100000) {
        reject(new Error('Request body is too large.'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function hasApprovalSecret(req: http.IncomingMessage): boolean {
  const header = req.headers['x-local-repo-mcp-approval-secret'];
  const value = Array.isArray(header) ? header[0] : header;
  return Boolean(approvalSecret && value && cryptoSafeEqual(value, approvalSecret));
}

function cryptoSafeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function authorizationHtml(pending: ReturnType<typeof createPendingAuthorization>): string {
  const id = JSON.stringify(pending.id);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Elegy Local Repo Reader Authorization</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 2rem; line-height: 1.5; color: #111827; }
    main { max-width: 42rem; }
    code { background: #f3f4f6; padding: .2rem .4rem; border-radius: .25rem; }
    .code { font-size: 2rem; letter-spacing: .1em; font-weight: 700; }
  </style>
</head>
<body>
  <main>
    <h1>Approve Local Repo Reader</h1>
    <p>Open Elegy Copilot on this machine and approve the pending ChatGPT request.</p>
    <p>Approval code</p>
    <p class="code">${escapeHtml(pending.userCode)}</p>
    <p id="status">Waiting for local approval...</p>
  </main>
  <script>
    const id = ${id};
    async function poll() {
      const response = await fetch('/oauth/status?id=' + encodeURIComponent(id));
      const payload = await response.json();
      if (payload.status === 'approved' && payload.redirectUrl) {
        document.getElementById('status').textContent = 'Approved. Redirecting...';
        window.location.href = payload.redirectUrl;
        return;
      }
      if (payload.status === 'expired' || payload.status === 'missing') {
        document.getElementById('status').textContent = 'This authorization request expired. Start the connection again from ChatGPT.';
        return;
      }
      setTimeout(poll, 1500);
    }
    poll();
  </script>
</body>
</html>`;
}

const httpServer = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url || '/', oauth.publicBaseUrl || `http://127.0.0.1:${PORT}`);

  if (requestUrl.pathname === '/.well-known/oauth-protected-resource') {
    sendJson(res, 200, buildProtectedResourceMetadata(oauth));
    return;
  }

  if (oauth.enabled && oauth.provider === 'builtin' && requestUrl.pathname === '/.well-known/openid-configuration') {
    sendJson(res, 200, buildAuthorizationServerMetadata(oauth));
    return;
  }

  if (oauth.enabled && oauth.provider === 'builtin' && requestUrl.pathname === '/.well-known/oauth-authorization-server') {
    sendJson(res, 200, buildAuthorizationServerMetadata(oauth));
    return;
  }

  if (oauth.enabled && oauth.provider === 'builtin' && requestUrl.pathname === '/.well-known/jwks.json') {
    sendJson(res, 200, await getPublicJwks(oauth));
    return;
  }

  if (oauth.enabled && oauth.provider === 'builtin' && req.method === 'GET' && requestUrl.pathname === '/oauth/authorize') {
    try {
      const pending = createPendingAuthorization(oauth, requestUrl);
      sendHtml(res, 200, authorizationHtml(pending));
    } catch (error) {
      const statusCode = error instanceof LocalOAuthError ? error.statusCode : 400;
      sendJson(res, statusCode, { error: error instanceof LocalOAuthError ? error.code : 'invalid_request', message: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  if (oauth.enabled && oauth.provider === 'builtin' && req.method === 'GET' && requestUrl.pathname === '/oauth/status') {
    sendJson(res, 200, getAuthorizationStatus(oauth, requestUrl.searchParams.get('id') || ''));
    return;
  }

  if (oauth.enabled && oauth.provider === 'builtin' && req.method === 'GET' && requestUrl.pathname === '/oauth/pending') {
    if (!hasApprovalSecret(req)) {
      sendJson(res, 403, { error: 'forbidden' });
      return;
    }
    sendJson(res, 200, { pending: listPendingAuthorizations(oauth) });
    return;
  }

  if (oauth.enabled && oauth.provider === 'builtin' && req.method === 'POST' && requestUrl.pathname === '/oauth/approve') {
    if (!hasApprovalSecret(req)) {
      sendJson(res, 403, { error: 'forbidden' });
      return;
    }
    try {
      const body = JSON.parse(await readBody(req) || '{}') as { id?: string };
      sendJson(res, 200, approvePendingAuthorization(oauth, body.id || ''));
    } catch (error) {
      const statusCode = error instanceof LocalOAuthError ? error.statusCode : 400;
      sendJson(res, statusCode, { error: error instanceof LocalOAuthError ? error.code : 'invalid_request', message: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  if (oauth.enabled && oauth.provider === 'builtin' && req.method === 'POST' && requestUrl.pathname === '/oauth/token') {
    try {
      const form = new URLSearchParams(await readBody(req));
      sendJson(res, 200, await exchangeAuthorizationCode(oauth, form), { 'cache-control': 'no-store' });
    } catch (error) {
      const statusCode = error instanceof LocalOAuthError ? error.statusCode : 400;
      sendJson(res, statusCode, { error: error instanceof LocalOAuthError ? error.code : 'invalid_grant', error_description: error instanceof Error ? error.message : String(error) }, { 'cache-control': 'no-store' });
    }
    return;
  }

  if (!req.url?.startsWith('/mcp')) {
    sendJson(res, 404, { error: 'not_found' });
    return;
  }

  if (!isMcpPathAllowed(requestUrl.pathname, oauth)) {
    sendJson(res, 403, { error: 'forbidden', message: 'Invalid Local Repo Reader access token.' });
    return;
  }

  try {
    await verifyRequest(req, oauth);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(res, 401, { error: 'unauthorized', message }, { 'WWW-Authenticate': buildWwwAuthenticate(oauth) });
    return;
  }

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const server = createMcpServer();
  res.on('close', () => {
    void transport.close();
    void server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res);
  } catch (error) {
    if (error instanceof AuthError) {
      sendJson(res, error.statusCode, { error: error.code, message: error.message }, { 'WWW-Authenticate': buildWwwAuthenticate(oauth) });
      return;
    }
    if (!res.headersSent) sendJson(res, 500, { error: 'mcp_error', message: error instanceof Error ? error.message : String(error) });
    else res.end();
  }
});

httpServer.listen(PORT, '127.0.0.1', () => {
  console.log(`Local Repo MCP listening on http://127.0.0.1:${PORT}/mcp`);
  console.log(`OAuth: ${oauth.enabled ? 'enabled' : 'disabled'}`);
});
