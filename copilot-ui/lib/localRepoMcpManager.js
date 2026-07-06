'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const CONFIG_SCHEMA_VERSION = 1;
const DEFAULT_PORT = 3333;

let mcpProcess = null;
let tunnelProcess = null;
let tunnelMode = 'none';
let quickTunnelBaseUrl = '';

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
  return candidates.find((candidate) => fs.existsSync(candidate) || findExecutableOnPath(candidate)) || null;
}

function findExecutableOnPath(command) {
  if (!command || path.basename(command) !== command) return false;
  const pathEntries = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const extensions = process.platform === 'win32'
    ? String(process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)
    : [''];
  return pathEntries.some((entry) => {
    const base = path.join(entry, command);
    if (fs.existsSync(base)) return true;
    return extensions.some((extension) => fs.existsSync(`${base}${extension}`));
  });
}

function getCloudflaredStatus(config) {
  const resolvedPath = resolveCloudflared(config);
  return {
    available: Boolean(resolvedPath),
    path: resolvedPath || config.cloudflaredPath || 'cloudflared',
  };
}

function requireCloudflared(config) {
  const cloudflared = getCloudflaredStatus(config);
  if (!cloudflared.available) {
    throw Object.assign(
      new Error('cloudflared is required before exposing Local Repo Reader to ChatGPT. Install cloudflared on PATH or set an absolute cloudflared path in Advanced Stable Tunnel.'),
      { statusCode: 400 },
    );
  }
  return cloudflared.path;
}

function connectorUrlFromBase(baseUrl) {
  const normalized = normalizeString(baseUrl).replace(/\/+$/, '');
  return normalized ? `${normalized}/mcp` : '';
}

function hasOAuthConfig(config) {
  return Boolean(config.authIssuer && getEffectiveAuthAudience(config));
}

function getEffectivePublicBaseUrl(config) {
  return quickTunnelBaseUrl || config.publicBaseUrl;
}

function getEffectiveAuthAudience(config) {
  return config.authAudience || getEffectivePublicBaseUrl(config);
}

function computeSecurityState(config, serverRunning, tunnelRunning) {
  if (!serverRunning && !tunnelRunning) return 'Stopped';
  if (tunnelRunning && (!getEffectivePublicBaseUrl(config) || !hasOAuthConfig(config))) return 'Misconfigured';
  if (serverRunning && tunnelRunning) return 'OAuth protected';
  return 'Local only';
}

function validateOAuthConfig(config) {
  if (!config.publicBaseUrl) throw Object.assign(new Error('publicBaseUrl is required'), { statusCode: 400 });
  if (!config.authIssuer) throw Object.assign(new Error('authIssuer is required'), { statusCode: 400 });
  if (!config.authAudience) throw Object.assign(new Error('authAudience is required'), { statusCode: 400 });
}

function validateExposureOAuthConfig(config) {
  if (!config.authIssuer) {
    throw Object.assign(new Error('OAuth issuer is required before exposing Local Repo Reader to ChatGPT.'), { statusCode: 400 });
  }
}

function getStatus(options = {}) {
  const config = loadConfig(options);
  const serverRunning = isRunning(mcpProcess);
  const tunnelRunning = isRunning(tunnelProcess);
  const connectorUrl = connectorUrlFromBase(getEffectivePublicBaseUrl(config));
  const audienceEffective = getEffectiveAuthAudience(config);
  const securityState = computeSecurityState(config, serverRunning, tunnelRunning);
  return {
    config,
    configPath: resolveConfigPath(options.elegyHome || options.elegyHomeAbs),
    connectorUrl,
    server: {
      running: serverRunning,
      pid: serverRunning ? mcpProcess.pid : null,
      url: `http://127.0.0.1:${config.port}/mcp`,
    },
    tunnel: {
      running: tunnelRunning,
      pid: tunnelRunning ? tunnelProcess.pid : null,
      mode: tunnelRunning ? tunnelMode : 'none',
      publicUrl: tunnelRunning ? connectorUrl : '',
    },
    securityState,
    prerequisites: {
      cloudflared: getCloudflaredStatus(config),
      oauth: {
        issuerConfigured: Boolean(config.authIssuer),
        audienceEffective,
      },
      chatGptAccessReady: securityState === 'OAuth protected',
    },
  };
}

function startServer(options = {}) {
  const config = loadConfig(options);
  if (isRunning(mcpProcess)) return getStatus(options);
  const packageRoot = resolveMcpPackageRoot(options.engineRoot || process.cwd());
  const entry = path.join(packageRoot, 'dist', 'server.js');
  if (!fs.existsSync(entry)) {
    throw Object.assign(new Error('local-repo-mcp is not built. Run npm --prefix local-repo-mcp run build.'), { statusCode: 400 });
  }
  const effectivePublicBaseUrl = getEffectivePublicBaseUrl(config);
  const effectiveAuthAudience = getEffectiveAuthAudience(config);
  const authEnabled = Boolean(effectivePublicBaseUrl && hasOAuthConfig(config));
  mcpProcess = spawn(process.execPath, [entry], {
    cwd: packageRoot,
    windowsHide: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      LOCAL_REPO_MCP_PORT: String(config.port),
      LOCAL_REPO_MCP_PUBLIC_BASE_URL: effectivePublicBaseUrl,
      LOCAL_REPO_MCP_AUTH_ISSUER: config.authIssuer,
      LOCAL_REPO_MCP_AUTH_AUDIENCE: effectiveAuthAudience,
      LOCAL_REPO_MCP_AUTH_MODE: authEnabled ? 'oauth' : 'disabled',
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

function waitForQuickTunnelUrl(child) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let output = '';
    const timer = setTimeout(() => {
      finish(new Error('Timed out waiting for cloudflared quick tunnel URL.'));
    }, 30000);

    function finish(error, url) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(url);
    }

    function onData(chunk) {
      output += chunk.toString();
      const match = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
      if (match) finish(null, match[0].replace(/\/+$/, ''));
    }

    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.once('error', (error) => finish(error));
    child.once('exit', (code, signal) => {
      if (!settled) finish(new Error(`cloudflared quick tunnel exited before publishing a URL (${signal || code}).`));
    });
  });
}

async function startQuickTunnel(options = {}) {
  const config = loadConfig(options);
  validateExposureOAuthConfig(config);
  const cloudflaredPath = requireCloudflared(config);
  if (isRunning(tunnelProcess) && tunnelMode === 'quick' && quickTunnelBaseUrl) return getStatus(options);
  if (isRunning(tunnelProcess)) await stopTunnel(options);

  tunnelMode = 'quick';
  quickTunnelBaseUrl = '';
  tunnelProcess = spawn(cloudflaredPath, ['tunnel', '--url', `http://127.0.0.1:${config.port}`], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  tunnelProcess.once('exit', () => {
    tunnelProcess = null;
    tunnelMode = 'none';
    quickTunnelBaseUrl = '';
  });

  try {
    quickTunnelBaseUrl = await waitForQuickTunnelUrl(tunnelProcess);
  } catch (error) {
    await stopTunnel(options);
    throw Object.assign(error, { statusCode: error.statusCode || 500 });
  }

  if (isRunning(mcpProcess)) await stopServer(options);
  return startServer(options);
}

function startTunnel(options = {}) {
  const config = loadConfig(options);
  validateOAuthConfig(config);
  const cloudflaredPath = requireCloudflared(config);
  if (!config.cloudflareTunnelName) {
    throw Object.assign(new Error('cloudflareTunnelName is required for named tunnel mode'), { statusCode: 400 });
  }
  if (isRunning(tunnelProcess)) return getStatus(options);
  const args = config.cloudflareConfigPath
    ? ['tunnel', '--config', config.cloudflareConfigPath, 'run', config.cloudflareTunnelName]
    : ['tunnel', 'run', config.cloudflareTunnelName];
  tunnelProcess = spawn(cloudflaredPath, args, {
    windowsHide: true,
    stdio: 'ignore',
  });
  tunnelMode = 'named';
  quickTunnelBaseUrl = '';
  tunnelProcess.once('exit', () => {
    tunnelProcess = null;
    tunnelMode = 'none';
  });
  return getStatus(options);
}

async function stopTunnel(options = {}) {
  await stopChild(tunnelProcess);
  tunnelProcess = null;
  tunnelMode = 'none';
  quickTunnelBaseUrl = '';
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
  startQuickTunnel,
  stopTunnel,
  probe,
};
