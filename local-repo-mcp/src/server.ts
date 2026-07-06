import http from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { getOAuthConfig, getRepoRoots, PORT } from './config.js';
import { AuthError, buildProtectedResourceMetadata, buildWwwAuthenticate, verifyRequest } from './auth.js';
import { findRoot, gitLog, gitStatus, listTree, readFile, searchText, toPublicRoot } from './repoAccess.js';

type ToolArgs = Record<string, unknown>;
const oauth = getOAuthConfig();

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
  server.registerTool(name, {
    ...config,
    _meta: {
      securitySchemes: [{
        type: 'oauth2',
        scopes: oauth.requiredScopes,
      }],
    },
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

const httpServer = http.createServer(async (req, res) => {
  if (req.url === '/.well-known/oauth-protected-resource') {
    sendJson(res, 200, buildProtectedResourceMetadata(oauth));
    return;
  }

  if (!req.url?.startsWith('/mcp')) {
    sendJson(res, 404, { error: 'not_found' });
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
