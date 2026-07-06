'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const CONFIG_SCHEMA_VERSION = 1;
const DEFAULT_PORT = 3333;

let mcpProcess = null;
let tunnelProcess = null;

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function expandHome(inputPath) {
  const raw = normalizeString(inputPath);
  if (!raw) return raw;
  if (raw === '~') return os.homedir();
  if (raw.startsWith('~/') || raw.startsWith('~\\')) return path.join(os.homedir(), raw.slice(2));
  return raw;
}

function resolveElegyHome(inputPath) {
  return path.resolve(expandHome(inputPath || '~/.elegy'));
}

function resolveConfigPath(elegyHome) {
  return path.join(resolveElegyHome(elegyHome), 'local-repo-mcp', 'config.json');
}

function readJsonIfExists(filePath) {
  try {
    if (!fs.statSync(filePath).isFile()) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2) + '\n', 'utf8');
  fs.renameSync(tempPath, filePath);
}

function createDefaultConfig() {
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    port: DEFAULT_PORT,
    publicBaseUrl: '',
    authIssuer: '',
    authAudience: '',
    requiredScopes: ['repo:read'],
    cloudflareTunnelName: '',
    cloudflareConfigPath: '',
    cloudflaredPath: '',
    updatedAt: null,
  };
}

function normalizeConfig(raw) {
  const defaults = createDefaultConfig();
  const requiredScopes = Array.isArray(raw?.requiredScopes)
    ? raw.requiredScopes.map(normalizeString).filter(Boolean)
    : defaults.requiredScopes;
  return {
    ...defaults,
    port: Number.isInteger(raw?.port) && raw.port > 0 ? raw.port : defaults.port,
    publicBaseUrl: normalizeString(raw?.publicBaseUrl).replace(/\/+$/, ''),
    authIssuer: normalizeString(raw?.authIssuer),
    authAudience: normalizeString(raw?.authAudience),
    requiredScopes: requiredScopes.length ? requiredScopes : defaults.requiredScopes,
    cloudflareTunnelName: normalizeString(raw?.cloudflareTunnelName),
    cloudflareConfigPath: normalizeString(raw?.cloudflareConfigPath),
    cloudflaredPath: normalizeString(raw?.cloudflaredPath),
    updatedAt: normalizeString(raw?.updatedAt) || null,
  };
}

function loadConfig(options = {}) {
  return normalizeConfig(readJsonIfExists(resolveConfigPath(options.elegyHome || options.elegyHomeAbs)) || {});
}

function saveConfig(options = {}) {
  const elegyHome = resolveElegyHome(options.elegyHome || options.elegyHomeAbs);
  const config = normalizeConfig({ ...loadConfig({ elegyHome }), ...options.config, updatedAt: new Date().toISOString() });
  writeJsonAtomic(resolveConfigPath(elegyHome), config);
  return config;
}

function isRunning(child) {
  return Boolean(child && child.exitCode == null && child.signalCode == null && !child.killed);
}

function resolveMcpPackageRoot(engineRoot) {
  return path.join(path.resolve(engineRoot), 'local-repo-mcp');
}

function resolveCloudflared(config) {
  if (config.cloudflaredPath && fs.existsSync(config.cloudflaredPath)) return config.cloudflaredPath;
  const candidates = [
    'cloudflared',
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'cloudflared', 'cloudflared.exe'),
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'cloudflared', 'cloudflared.exe'),
  ];
  return candidates.find((candidate) => candidate === 'cloudflared' || fs.existsSync(candidate)) || 'cloudflared';
}

function computeSecurityState(config, serverRunning, tunnelRunning) {
  if (!serverRunning && !tunnelRunning) return 'Stopped';
  if (!config.publicBaseUrl || !config.authIssuer || !config.authAudience) return 'Misconfigured';
  if (serverRunning && tunnelRunning) return 'OAuth protected';
  return 'Local only';
}

function validateOAuthConfig(config) {
  if (!config.publicBaseUrl) throw Object.assign(new Error('publicBaseUrl is required'), { statusCode: 400 });
  if (!config.authIssuer) throw Object.assign(new Error('authIssuer is required'), { statusCode: 400 });
  if (!config.authAudience) throw Object.assign(new Error('authAudience is required'), { statusCode: 400 });
}

function getStatus(options = {}) {
  const config = loadConfig(options);
  const serverRunning = isRunning(mcpProcess);
  const tunnelRunning = isRunning(tunnelProcess);
  return {
    config,
    configPath: resolveConfigPath(options.elegyHome || options.elegyHomeAbs),
    server: {
      running: serverRunning,
      pid: serverRunning ? mcpProcess.pid : null,
      url: `http://127.0.0.1:${config.port}/mcp`,
    },
    tunnel: {
      running: tunnelRunning,
      pid: tunnelRunning ? tunnelProcess.pid : null,
      publicUrl: config.publicBaseUrl ? `${config.publicBaseUrl}/mcp` : '',
    },
    securityState: computeSecurityState(config, serverRunning, tunnelRunning),
  };
}

function startServer(options = {}) {
  const config = loadConfig(options);
  validateOAuthConfig(config);
  if (isRunning(mcpProcess)) return getStatus(options);
  const packageRoot = resolveMcpPackageRoot(options.engineRoot || process.cwd());
  const entry = path.join(packageRoot, 'dist', 'server.js');
  if (!fs.existsSync(entry)) {
    throw Object.assign(new Error('local-repo-mcp is not built. Run npm --prefix local-repo-mcp run build.'), { statusCode: 400 });
  }
  mcpProcess = spawn(process.execPath, [entry], {
    cwd: packageRoot,
    windowsHide: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      LOCAL_REPO_MCP_PORT: String(config.port),
      LOCAL_REPO_MCP_PUBLIC_BASE_URL: config.publicBaseUrl,
      LOCAL_REPO_MCP_AUTH_ISSUER: config.authIssuer,
      LOCAL_REPO_MCP_AUTH_AUDIENCE: config.authAudience,
      LOCAL_REPO_MCP_REQUIRED_SCOPES: config.requiredScopes.join(' '),
      ELEGY_HOME: resolveElegyHome(options.elegyHome || options.elegyHomeAbs),
    },
  });
  mcpProcess.once('exit', () => { mcpProcess = null; });
  return getStatus(options);
}

async function stopChild(child) {
  if (!isRunning(child)) return;
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
      resolve();
    }, 2000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    try { child.kill(); } catch { resolve(); }
  });
}

async function stopServer(options = {}) {
  await stopChild(mcpProcess);
  mcpProcess = null;
  return getStatus(options);
}

function startTunnel(options = {}) {
  const config = loadConfig(options);
  validateOAuthConfig(config);
  if (!config.cloudflareTunnelName) {
    throw Object.assign(new Error('cloudflareTunnelName is required for named tunnel mode'), { statusCode: 400 });
  }
  if (isRunning(tunnelProcess)) return getStatus(options);
  const args = config.cloudflareConfigPath
    ? ['tunnel', '--config', config.cloudflareConfigPath, 'run', config.cloudflareTunnelName]
    : ['tunnel', 'run', config.cloudflareTunnelName];
  tunnelProcess = spawn(resolveCloudflared(config), args, {
    windowsHide: true,
    stdio: 'ignore',
  });
  tunnelProcess.once('exit', () => { tunnelProcess = null; });
  return getStatus(options);
}

async function stopTunnel(options = {}) {
  await stopChild(tunnelProcess);
  tunnelProcess = null;
  return getStatus(options);
}

async function probe(options = {}) {
  const status = getStatus(options);
  const response = await fetch(status.server.url.replace(/\/mcp$/, '/.well-known/oauth-protected-resource'));
  return {
    ...status,
    probe: {
      ok: response.ok,
      status: response.status,
      metadata: response.ok ? await response.json() : null,
    },
  };
}

module.exports = {
  CONFIG_SCHEMA_VERSION,
  createDefaultConfig,
  loadConfig,
  saveConfig,
  getStatus,
  startServer,
  stopServer,
  startTunnel,
  stopTunnel,
  probe,
};
