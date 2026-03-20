#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const DEFAULT_SERVER_ID = 'github';
const DEFAULT_TOKEN_ENV_VAR = 'GITHUB_MCP_PAT';
const DEFAULT_GITHUB_MCP_URL = 'https://api.githubcopilot.com/mcp/';

function parseArgs(argv) {
  const args = {
    workspaceRoot: path.resolve(path.join(path.dirname(fileURLToPath(import.meta.url)), '..')),
    mcpPath: null,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    if (arg === '--workspace-root') {
      args.workspaceRoot = path.resolve(argv[i + 1] || '');
      i += 1;
      continue;
    }
    if (arg.startsWith('--workspace-root=')) {
      args.workspaceRoot = path.resolve(arg.slice('--workspace-root='.length));
      continue;
    }
    if (arg === '--mcp') {
      args.mcpPath = path.resolve(argv[i + 1] || '');
      i += 1;
      continue;
    }
    if (arg.startsWith('--mcp=')) {
      args.mcpPath = path.resolve(arg.slice('--mcp='.length));
      continue;
    }
    throw new Error(`Unknown arg: ${arg} (supported: --dry-run, --workspace-root <path>, --mcp <path>)`);
  }

  return args;
}

function loadDocument(mcpPath) {
  try {
    const raw = fs.readFileSync(mcpPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('mcp.json root must be an object');
    }
    return {
      exists: true,
      document: parsed,
    };
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return {
        exists: false,
        document: {},
      };
    }
    throw new Error(`Unable to parse ${mcpPath}: ${error.message}`);
  }
}

function buildGithubServer() {
  return {
    type: 'http',
    url: DEFAULT_GITHUB_MCP_URL,
    headers: {
      Authorization: `Bearer \${env:${DEFAULT_TOKEN_ENV_VAR}}`,
    },
  };
}

function deepEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function ensureGithubMcp({ mcpPath, dryRun }) {
  const { exists, document } = loadDocument(mcpPath);
  const next = { ...document };
  const currentServers =
    next.mcpServers && typeof next.mcpServers === 'object' && !Array.isArray(next.mcpServers)
      ? { ...next.mcpServers }
      : {};

  const githubServer = buildGithubServer();
  const previousServer =
    currentServers[DEFAULT_SERVER_ID] &&
    typeof currentServers[DEFAULT_SERVER_ID] === 'object' &&
    !Array.isArray(currentServers[DEFAULT_SERVER_ID])
      ? currentServers[DEFAULT_SERVER_ID]
      : null;

  currentServers[DEFAULT_SERVER_ID] = githubServer;
  next.mcpServers = currentServers;

  const changed = !deepEqual(document, next);
  if (changed && !dryRun) {
    fs.mkdirSync(path.dirname(mcpPath), { recursive: true });
    fs.writeFileSync(mcpPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  }

  return {
    ok: true,
    changed,
    dryRun,
    existed: exists,
    mcpPath,
    schema: 'mcpServers',
    serverId: DEFAULT_SERVER_ID,
    url: githubServer.url,
    tokenEnvVar: DEFAULT_TOKEN_ENV_VAR,
    previousServerConfigured: Boolean(previousServer),
    createdFile: !exists && changed && !dryRun,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const mcpPath = args.mcpPath || path.join(args.workspaceRoot, '.vscode', 'mcp.json');
  const result = ensureGithubMcp({
    mcpPath,
    dryRun: args.dryRun,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
