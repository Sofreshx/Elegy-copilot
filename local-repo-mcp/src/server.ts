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
import {
  findRoot,
  gitChangedFiles,
  gitDiff,
  gitLog,
  gitStatus,
  listTreeDetailed,
  readFile,
  readMany,
  searchTextDetailed,
  toPublicRoot,
} from './repoAccess.js';

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

function optionalBooleanArg(args: ToolArgs, name: string): boolean | undefined {
  const value = args[name];
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw new Error(`${name} must be a boolean.`);
  return value;
}

function optionalStringArrayArg(args: ToolArgs, name: string): string[] | undefined {
  const value = args[name];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) throw new Error(`${name} must be an array of strings.`);
  return value as string[];
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
    inputSchema: {
      rootId: z.string(),
      path: z.string().optional(),
      maxDepth: z.number().int().min(0).max(100).optional(),
      includeFiles: z.boolean().optional(),
      includeDirectories: z.boolean().optional(),
      trackedOnly: z.boolean().optional(),
      includeGlobs: z.array(z.string()).optional(),
      excludeGlobs: z.array(z.string()).optional(),
      limit: z.number().int().min(1).max(2000).optional(),
      cursor: z.string().optional(),
    },
  }, async (args) => {
    const roots = getRepoRoots();
    const rootId = stringArg(args, 'rootId');
    return asText({
      rootId,
      ...(await listTreeDetailed(findRoot(roots, rootId), {
        path: optionalStringArg(args, 'path', '.'),
        maxDepth: args.maxDepth === undefined ? undefined : optionalNumberArg(args, 'maxDepth', 2),
        includeFiles: optionalBooleanArg(args, 'includeFiles'),
        includeDirectories: optionalBooleanArg(args, 'includeDirectories'),
        trackedOnly: optionalBooleanArg(args, 'trackedOnly'),
        includeGlobs: optionalStringArrayArg(args, 'includeGlobs'),
        excludeGlobs: optionalStringArrayArg(args, 'excludeGlobs'),
        limit: optionalNumberArg(args, 'limit', 500),
        cursor: optionalStringArg(args, 'cursor', ''),
      })),
    });
  });

  registerTool(server, 'repo_read_file', {
    description: 'Read one bounded text-file range from an exposed root. Paths are relative and denied files are rejected.',
    inputSchema: {
      rootId: z.string(),
      path: z.string(),
      startLine: z.number().int().min(1).optional(),
      endLine: z.number().int().min(1).optional(),
      maxBytes: z.number().int().min(1).max(200000).optional(),
    },
  }, async (args) => {
    const roots = getRepoRoots();
    return asText(await readFile(findRoot(roots, stringArg(args, 'rootId')), stringArg(args, 'path'), {
      startLine: args.startLine === undefined ? undefined : optionalNumberArg(args, 'startLine', 1),
      endLine: args.endLine === undefined ? undefined : optionalNumberArg(args, 'endLine', 1),
      maxBytes: args.maxBytes === undefined ? undefined : optionalNumberArg(args, 'maxBytes', 200000),
    }));
  });

  registerTool(server, 'repo_read_many', {
    description: 'Read several bounded text-file ranges from an exposed root in request order.',
    inputSchema: {
      rootId: z.string(),
      files: z.array(z.object({
        path: z.string(),
        startLine: z.number().int().min(1).optional(),
        endLine: z.number().int().min(1).optional(),
      })).max(20),
      maxTotalBytes: z.number().int().min(1).max(500000).optional(),
    },
  }, async (args) => {
    const roots = getRepoRoots();
    const files = args.files;
    if (!Array.isArray(files)) throw new Error('files must be an array.');
    return asText(await readMany(findRoot(roots, stringArg(args, 'rootId')), files.map((file) => {
      if (!file || typeof file !== 'object' || typeof (file as { path?: unknown }).path !== 'string') throw new Error('Each file needs a path.');
      const entry = file as { path: string; startLine?: number; endLine?: number };
      return entry;
    }), optionalNumberArg(args, 'maxTotalBytes', 500000)));
  });

  registerTool(server, 'repo_search', {
    description: 'Search text in allowed files under an exposed root.',
    inputSchema: {
      rootId: z.string(),
      query: z.string(),
      path: z.string().optional(),
      caseSensitive: z.boolean().optional(),
      includeGlobs: z.array(z.string()).optional(),
      excludeGlobs: z.array(z.string()).optional(),
      limit: z.number().int().min(1).max(500).optional(),
      contextBefore: z.number().int().min(0).max(20).optional(),
      contextAfter: z.number().int().min(0).max(20).optional(),
      maxMatches: z.number().int().min(1).max(500).optional(),
      maxMatchesPerFile: z.number().int().min(1).max(500).optional(),
      trackedOnly: z.boolean().optional(),
      cursor: z.string().optional(),
    },
  }, async (args) => {
    const roots = getRepoRoots();
    const rootId = stringArg(args, 'rootId');
    const query = stringArg(args, 'query');
    return asText(await searchTextDetailed(findRoot(roots, rootId), query, {
      path: optionalStringArg(args, 'path', '.'),
      caseSensitive: optionalBooleanArg(args, 'caseSensitive'),
      includeGlobs: optionalStringArrayArg(args, 'includeGlobs'),
      excludeGlobs: optionalStringArrayArg(args, 'excludeGlobs'),
      contextBefore: args.contextBefore === undefined ? undefined : optionalNumberArg(args, 'contextBefore', 0),
      contextAfter: args.contextAfter === undefined ? undefined : optionalNumberArg(args, 'contextAfter', 0),
      maxMatches: args.maxMatches === undefined ? (args.limit === undefined ? undefined : optionalNumberArg(args, 'limit', 100)) : optionalNumberArg(args, 'maxMatches', 100),
      maxMatchesPerFile: args.maxMatchesPerFile === undefined ? undefined : optionalNumberArg(args, 'maxMatchesPerFile', 100),
      trackedOnly: optionalBooleanArg(args, 'trackedOnly'),
      cursor: optionalStringArg(args, 'cursor', ''),
    }));
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

  registerTool(server, 'repo_git_diff', {
    description: 'Return bounded structured staged or unstaged current-worktree changes relative to HEAD.',
    inputSchema: {
      rootId: z.string(),
      staged: z.boolean().optional(),
      paths: z.array(z.string()).optional(),
      contextLines: z.number().int().min(0).max(20).optional(),
      maxBytes: z.number().int().min(1).max(500000).optional(),
    },
  }, async (args) => {
    const roots = getRepoRoots();
    return asText(await gitDiff(findRoot(roots, stringArg(args, 'rootId')), {
      staged: optionalBooleanArg(args, 'staged'),
      paths: optionalStringArrayArg(args, 'paths'),
      contextLines: optionalNumberArg(args, 'contextLines', 3),
      maxBytes: optionalNumberArg(args, 'maxBytes', 500000),
    }));
  });

  registerTool(server, 'repo_git_changed_files', {
    description: 'Return normalized staged, unstaged, deleted, renamed, binary, and untracked worktree changes.',
    inputSchema: {
      rootId: z.string(),
      includeUntracked: z.boolean().optional(),
      includeStaged: z.boolean().optional(),
    },
  }, async (args) => {
    const roots = getRepoRoots();
    return asText(await gitChangedFiles(findRoot(roots, stringArg(args, 'rootId')), {
      includeUntracked: optionalBooleanArg(args, 'includeUntracked'),
      includeStaged: optionalBooleanArg(args, 'includeStaged'),
    }));
  });

  registerTool(server, 'repo_capabilities', {
    description: 'Describe bounded repository-reader capabilities supported by this server.',
    inputSchema: {},
  }, async () => asText({
    protocolVersion: '1.1',
    tools: {
      repo_read_file: { lineRanges: true },
      repo_read_many: { maxFiles: 20, maxTotalBytes: 500000 },
      repo_search: { literal: true, globs: true, context: true, pagination: true },
      repo_git_changed_files: { staged: true, unstaged: true, untracked: true },
      repo_git_diff: { workingTree: true, structuredFiles: true },
      repo_tree: { deniedGitInternals: true },
    },
  }));

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
    if (!oauth.enabled) {
      sendJson(res, 404, { error: 'not_found' });
      return;
    }
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
    const headers: Record<string, string> | undefined = oauth.enabled ? { 'WWW-Authenticate': buildWwwAuthenticate(oauth) } : undefined;
    sendJson(res, 401, { error: 'unauthorized', message }, headers);
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
      const headers: Record<string, string> | undefined = oauth.enabled ? { 'WWW-Authenticate': buildWwwAuthenticate(oauth) } : undefined;
      sendJson(res, error.statusCode, { error: error.code, message: error.message }, headers);
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
