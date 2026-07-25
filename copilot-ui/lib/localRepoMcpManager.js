'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, spawn } = require('child_process');

const CONFIG_SCHEMA_VERSION = 2;
const DEFAULT_PORT = 3333;

let mcpProcess = null;
let tunnelProcess = null;
let tunnelMode = 'none';
let quickTunnelBaseUrl = '';
let mcpLastExit = null;
let mcpLastProbe = null;
let mcpLastNotice = '';
let mcpOutput = { stdout: '', stderr: '' };
const MCP_OUTPUT_LIMIT = 4000;

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

function resolveApprovalSecretPath(elegyHome) {
  return path.join(resolveElegyHome(elegyHome), 'local-repo-mcp', 'approval-secret');
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
    activeExposureMode: 'quick',
    quickTunnel: {
      enabled: true,
    },
    stableTunnel: {
      configured: false,
      publicOrigin: '',
      canonicalResource: '',
      hostname: '',
      cloudflareTunnelName: '',
      cloudflareTunnelId: '',
      cloudflareConfigPath: '',
      cloudflareCredentialsPath: '',
      cloudflaredPath: '',
      autoStart: false,
    },
    oauth: {
      provider: 'builtin',
      issuer: '',
      audience: '',
      requiredScopes: ['repo:read'],
      accessTokenTtlSeconds: 3600,
      refreshTokenTtlSeconds: 2592000,
    },
    // Compatibility aliases for existing clients. Remove only after all shipped
    // desktop versions understand the v2 profile fields.
    authProvider: 'builtin',
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
  const stableRaw = raw?.stableTunnel && typeof raw.stableTunnel === 'object' ? raw.stableTunnel : {};
  const oauthRaw = raw?.oauth && typeof raw.oauth === 'object' ? raw.oauth : {};
  const publicOrigin = normalizeString(stableRaw.publicOrigin || raw?.publicBaseUrl).replace(/\/+$/, '');
  const canonicalResource = normalizeString(stableRaw.canonicalResource || connectorUrlFromBase(publicOrigin));
  const requiredScopesSource = Array.isArray(oauthRaw.requiredScopes) ? oauthRaw.requiredScopes : raw?.requiredScopes;
  const requiredScopes = Array.isArray(requiredScopesSource)
    ? requiredScopesSource.map(normalizeString).filter(Boolean)
    : defaults.requiredScopes;
  const authProvider = normalizeString(oauthRaw.provider || raw?.authProvider) === 'external' ? 'external' : 'builtin';
  const authIssuer = authProvider === 'builtin'
    ? publicOrigin
    : normalizeString(oauthRaw.issuer || raw?.authIssuer);
  const authAudience = authProvider === 'builtin'
    ? canonicalResource
    : normalizeString(oauthRaw.audience || raw?.authAudience);
  const cloudflareTunnelName = normalizeString(stableRaw.cloudflareTunnelName || raw?.cloudflareTunnelName);
  const cloudflareConfigPath = normalizeString(stableRaw.cloudflareConfigPath || raw?.cloudflareConfigPath);
  const cloudflaredPath = normalizeString(stableRaw.cloudflaredPath || raw?.cloudflaredPath);
  const stableConfigured = Boolean(publicOrigin && cloudflareTunnelName);
  const activeExposureMode = normalizeString(raw?.activeExposureMode) === 'stable' ? 'stable' : 'quick';
  return {
    ...raw,
    ...defaults,
    schemaVersion: CONFIG_SCHEMA_VERSION,
    port: Number.isInteger(raw?.port) && raw.port > 0 ? raw.port : defaults.port,
    activeExposureMode,
    quickTunnel: {
      enabled: raw?.quickTunnel?.enabled !== false,
    },
    stableTunnel: {
      ...defaults.stableTunnel,
      ...stableRaw,
      configured: stableConfigured,
      publicOrigin,
      canonicalResource,
      hostname: normalizeString(stableRaw.hostname || (() => {
        try { return publicOrigin ? new URL(publicOrigin).hostname : ''; } catch { return ''; }
      })()),
      cloudflareTunnelName,
      cloudflareTunnelId: normalizeString(stableRaw.cloudflareTunnelId),
      cloudflareConfigPath,
      cloudflareCredentialsPath: normalizeString(stableRaw.cloudflareCredentialsPath),
      cloudflaredPath,
      autoStart: stableRaw.autoStart === true,
    },
    oauth: {
      ...defaults.oauth,
      ...oauthRaw,
      provider: authProvider,
      issuer: authIssuer,
      audience: authAudience,
      requiredScopes: requiredScopes.length ? requiredScopes : defaults.requiredScopes,
    },
    authProvider,
    publicBaseUrl: publicOrigin,
    authIssuer,
    authAudience,
    requiredScopes: requiredScopes.length ? requiredScopes : defaults.requiredScopes,
    cloudflareTunnelName,
    cloudflareConfigPath,
    cloudflaredPath,
    updatedAt: normalizeString(raw?.updatedAt) || null,
  };
}

function loadConfig(options = {}) {
  const configPath = resolveConfigPath(options.elegyHome || options.elegyHomeAbs);
  const raw = readJsonIfExists(configPath) || {};
  const config = normalizeConfig(raw);
  if (Object.keys(raw).length > 0 && raw.schemaVersion !== CONFIG_SCHEMA_VERSION) {
    const backupPath = path.join(path.dirname(configPath), 'config.v1.backup.json');
    if (!fs.existsSync(backupPath)) writeJsonAtomic(backupPath, raw);
    writeJsonAtomic(configPath, config);
  }
  return config;
}

function saveConfig(options = {}) {
  const elegyHome = resolveElegyHome(options.elegyHome || options.elegyHomeAbs);
  const current = loadConfig({ elegyHome });
  const incoming = options.config && typeof options.config === 'object' ? options.config : {};
  const stableTunnel = {
    ...current.stableTunnel,
    ...(incoming.stableTunnel && typeof incoming.stableTunnel === 'object' ? incoming.stableTunnel : {}),
  };
  if (Object.hasOwn(incoming, 'publicBaseUrl')) stableTunnel.publicOrigin = incoming.publicBaseUrl;
  if (Object.hasOwn(incoming, 'cloudflareTunnelName')) stableTunnel.cloudflareTunnelName = incoming.cloudflareTunnelName;
  if (Object.hasOwn(incoming, 'cloudflareConfigPath')) stableTunnel.cloudflareConfigPath = incoming.cloudflareConfigPath;
  if (Object.hasOwn(incoming, 'cloudflaredPath')) stableTunnel.cloudflaredPath = incoming.cloudflaredPath;
  const oauth = {
    ...current.oauth,
    ...(incoming.oauth && typeof incoming.oauth === 'object' ? incoming.oauth : {}),
  };
  if (Object.hasOwn(incoming, 'authProvider')) oauth.provider = incoming.authProvider;
  if (Object.hasOwn(incoming, 'authIssuer')) oauth.issuer = incoming.authIssuer;
  if (Object.hasOwn(incoming, 'authAudience')) oauth.audience = incoming.authAudience;
  if (Object.hasOwn(incoming, 'requiredScopes')) oauth.requiredScopes = incoming.requiredScopes;
  const config = normalizeConfig({
    ...current,
    ...incoming,
    stableTunnel,
    oauth,
    updatedAt: new Date().toISOString(),
  });
  writeJsonAtomic(resolveConfigPath(elegyHome), config);
  return config;
}

function getApprovalSecret(options = {}) {
  const secretPath = resolveApprovalSecretPath(options.elegyHome || options.elegyHomeAbs);
  const existing = normalizeString(readTextIfExists(secretPath));
  if (existing) return existing;
  const secret = crypto.randomBytes(32).toString('base64url');
  fs.mkdirSync(path.dirname(secretPath), { recursive: true });
  fs.writeFileSync(secretPath, `${secret}\n`, 'utf8');
  return secret;
}

function readTextIfExists(filePath) {
  try {
    if (!fs.statSync(filePath).isFile()) return '';
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function isRunning(child) {
  return Boolean(child && child.exitCode == null && child.signalCode == null && !child.killed);
}

function appendOutput(kind, chunk) {
  const text = chunk.toString();
  mcpOutput = {
    ...mcpOutput,
    [kind]: `${mcpOutput[kind] || ''}${text}`.slice(-MCP_OUTPUT_LIMIT),
  };
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
  if (!normalized) return '';
  return `${normalized}/mcp`;
}

function hasOAuthConfig(config) {
  if (config.authProvider === 'builtin') return Boolean(getEffectivePublicBaseUrl(config));
  return Boolean(config.authIssuer && getEffectiveAuthAudience(config));
}

function getEffectivePublicBaseUrl(config) {
  return quickTunnelBaseUrl || config.publicBaseUrl;
}

function getEffectiveAuthAudience(config) {
  return config.authAudience || getEffectivePublicBaseUrl(config);
}

function getEffectiveAuthIssuer(config) {
  return config.authProvider === 'builtin'
    ? getEffectivePublicBaseUrl(config)
    : config.authIssuer;
}

function getQuickConnectorUrl() {
  return connectorUrlFromBase(quickTunnelBaseUrl);
}

function computeSecurityState(config, serverRunning, tunnelRunning) {
  if (!serverRunning && !tunnelRunning) return 'Stopped';
  if (tunnelRunning && !serverRunning) return 'Misconfigured';
  if (serverRunning && tunnelRunning && tunnelMode === 'quick' && quickTunnelBaseUrl) {
    return mcpLastProbe?.ok ? 'ChatGPT ready' : 'Misconfigured';
  }
  if (tunnelRunning && (!getEffectivePublicBaseUrl(config) || !hasOAuthConfig(config))) return 'Misconfigured';
  if (serverRunning && tunnelRunning) return 'OAuth protected';
  return 'Local only';
}

function validateOAuthConfig(config) {
  if (!config.publicBaseUrl) throw Object.assign(new Error('publicBaseUrl is required'), { statusCode: 400 });
  if (config.authProvider === 'external') {
    if (!config.authIssuer) throw Object.assign(new Error('authIssuer is required'), { statusCode: 400 });
    if (!config.authAudience) throw Object.assign(new Error('authAudience is required'), { statusCode: 400 });
  }
}

function buildMcpProbeBody(id, method) {
  return JSON.stringify({
    jsonrpc: '2.0',
    id,
    method,
    params: method === 'initialize'
      ? {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'elegy-local-repo-mcp-probe', version: '0.1.0' },
      }
      : {},
  });
}

function parseMcpJson(text) {
  const dataLine = String(text || '').split(/\r?\n/).find((line) => line.startsWith('data:'));
  const raw = dataLine ? dataLine.slice('data:'.length).trim() : text;
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function hasOAuthChallenge(response) {
  return Boolean(response.headers?.get?.('www-authenticate'));
}

async function postMcpProbe(url, id, method) {
  return fetch(url, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
    },
    body: buildMcpProbeBody(id, method),
  });
}

async function probeMcpEndpoint(url) {
  try {
    const initialize = await postMcpProbe(url, 1, 'initialize');
    const initializeText = await initialize.text().catch(() => '');
    if (initialize.status === 401 || hasOAuthChallenge(initialize)) {
      return { ok: false, status: initialize.status, code: 'oauth_challenge', message: 'MCP endpoint requires OAuth or bearer auth.' };
    }
    if (!initialize.ok) {
      return { ok: false, status: initialize.status, code: 'initialize_failed', message: `MCP initialize returned ${initialize.status}.`, body: initializeText.slice(0, 500) };
    }

    const tools = await postMcpProbe(url, 2, 'tools/list');
    const toolsText = await tools.text().catch(() => '');
    if (tools.status === 401 || hasOAuthChallenge(tools)) {
      return { ok: false, status: tools.status, code: 'oauth_challenge', message: 'MCP tools/list requires OAuth or bearer auth.' };
    }
    if (!tools.ok) {
      return { ok: false, status: tools.status, code: 'tools_list_failed', message: `MCP tools/list returned ${tools.status}.`, body: toolsText.slice(0, 500) };
    }

    const payload = parseMcpJson(toolsText);
    const toolNames = Array.isArray(payload?.result?.tools)
      ? payload.result.tools.map((tool) => normalizeString(tool?.name)).filter(Boolean)
      : [];
    if (toolNames.length === 0) {
      return { ok: false, status: tools.status, code: 'no_tools', message: 'MCP tools/list returned no tools.', body: toolsText.slice(0, 500) };
    }
    return { ok: true, status: tools.status, code: 'ok', message: 'MCP tools/list succeeded.', tools: toolNames };
  } catch (error) {
    return { ok: false, status: null, code: 'probe_error', message: error instanceof Error ? error.message : String(error) };
  }
}

async function probeOAuthMetadata(baseUrl) {
  const normalized = normalizeString(baseUrl).replace(/\/+$/, '');
  if (!normalized) return { ok: false, status: null, oauth: false };
  try {
    const response = await fetch(`${normalized}/.well-known/oauth-protected-resource`);
    const text = await response.text().catch(() => '');
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
    const authorizationServers = Array.isArray(payload?.authorization_servers)
      ? payload.authorization_servers.filter(Boolean)
      : [];
    return {
      ok: response.ok,
      status: response.status,
      oauth: response.ok && authorizationServers.length > 0,
      authorizationServers,
    };
  } catch (error) {
    return { ok: false, status: null, oauth: false, message: error instanceof Error ? error.message : String(error) };
  }
}

function escapePowerShellSingleQuoted(value) {
  return String(value || '').replace(/'/g, "''");
}

function stopUntrackedLocalRepoMcpProcesses(config, options = {}) {
  if (process.platform !== 'win32') return [];
  const port = Number.isInteger(config?.port) && config.port > 0 ? config.port : DEFAULT_PORT;
  const packageRoot = resolveMcpPackageRoot(options.engineRoot || process.cwd());
  const entry = path.join(packageRoot, 'dist', 'server.js');
  const escapedEntry = escapePowerShellSingleQuoted(entry);
  const script = [
    `$port = ${port}`,
    `$entry = '${escapedEntry}'`,
    '$listeners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue',
    '$listeners | ForEach-Object {',
    '  $owner = $_.OwningProcess',
    '  if (-not $owner -or $owner -eq $PID) { return }',
    '  $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $owner" -ErrorAction SilentlyContinue',
    '  if (-not $proc) { return }',
    "  $cmd = [string]$proc.CommandLine",
    "  $isNode = [string]$proc.Name -match '^node(\\.exe)?$'",
    "  $ownsThisEntry = $entry -and $cmd.IndexOf($entry, [StringComparison]::OrdinalIgnoreCase) -ge 0",
    "  $looksLikeLocalRepoMcp = $cmd -match 'local-repo-mcp[\\\\/]dist[\\\\/]server\\.js'",
    '  if ($isNode -and ($ownsThisEntry -or $looksLikeLocalRepoMcp)) {',
    '    try { Stop-Process -Id $owner -Force -ErrorAction Stop; [string]$owner } catch {}',
    '  }',
    '}',
  ].join('\n');
  try {
    return execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8', windowsHide: true })
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function getStatus(options = {}) {
  const config = loadConfig(options);
  const serverRunning = isRunning(mcpProcess);
  const tunnelRunning = isRunning(tunnelProcess);
  const quickConnectorUrl = tunnelRunning && tunnelMode === 'quick' ? getQuickConnectorUrl() : '';
  const connectorUrl = quickConnectorUrl || connectorUrlFromBase(getEffectivePublicBaseUrl(config));
  const audienceEffective = getEffectiveAuthAudience(config);
  const issuerEffective = getEffectiveAuthIssuer(config);
  const securityState = computeSecurityState(config, serverRunning, tunnelRunning);
  const stableConfigured = Boolean(config.stableTunnel?.configured);
  const stableUrl = config.stableTunnel?.canonicalResource || connectorUrlFromBase(config.publicBaseUrl);
  const exposureMode = tunnelRunning && tunnelMode === 'quick'
    ? 'quick'
    : stableConfigured ? 'stable' : 'none';
  const quickReady = Boolean(serverRunning && tunnelRunning && tunnelMode === 'quick' && quickConnectorUrl && mcpLastProbe?.ok);
  // The current stable probe proves discovery metadata only. It must not be
  // promoted to ChatGPT-ready until the full OAuth flow is exercised.
  const stableOnline = Boolean(serverRunning && tunnelRunning && tunnelMode === 'named');
  const lifecycleState = exposureMode === 'quick'
    ? (quickReady ? 'quick_ready' : 'stopped')
    : !stableConfigured
      ? 'not_configured'
      : !stableOnline
        ? 'configured_offline'
        : mcpLastProbe?.ok
          ? 'online_unverified'
          : 'degraded';
  const chatGptReady = quickReady;
  const cloudflared = getCloudflaredStatus(config);
  return {
    config,
    configPath: resolveConfigPath(options.elegyHome || options.elegyHomeAbs),
    connectorUrl,
    server: {
      running: serverRunning,
      pid: serverRunning ? mcpProcess.pid : null,
      url: `http://127.0.0.1:${config.port}/mcp`,
      lastExit: mcpLastExit,
      notice: mcpLastNotice,
      output: mcpOutput,
    },
    tunnel: {
      running: tunnelRunning,
      pid: tunnelRunning ? tunnelProcess.pid : null,
      mode: tunnelRunning ? tunnelMode : 'none',
      publicUrl: tunnelRunning ? connectorUrl : '',
    },
    probe: mcpLastProbe,
    securityState,
    chatGptAccess: {
      mode: exposureMode,
      configured: exposureMode === 'quick' ? true : stableConfigured,
      online: exposureMode === 'quick' ? quickReady : stableOnline,
      ready: chatGptReady,
      url: exposureMode === 'quick' ? (quickReady ? quickConnectorUrl : '') : stableUrl,
      auth: exposureMode === 'stable' ? 'oauth' : 'none',
      urlStable: exposureMode === 'stable',
      lifecycleState,
      blocker: cloudflared.available ? '' : 'cloudflared is required before exposing Local Repo Reader to ChatGPT.',
    },
    prerequisites: {
      cloudflared,
      oauth: {
        provider: config.authProvider,
        issuerConfigured: Boolean(issuerEffective),
        issuerEffective,
        audienceEffective,
      },
      chatGptAccessReady: chatGptReady,
    },
  };
}

function validateStableConfiguration(options = {}) {
  const config = loadConfig(options);
  validateOAuthConfig(config);
  let publicUrl;
  try {
    publicUrl = new URL(config.publicBaseUrl);
  } catch {
    throw Object.assign(new Error('publicBaseUrl must be a valid HTTPS origin'), { statusCode: 400 });
  }
  if (publicUrl.protocol !== 'https:' || publicUrl.pathname !== '/' || publicUrl.search || publicUrl.hash) {
    throw Object.assign(new Error('publicBaseUrl must be an HTTPS origin without a path, query, or fragment'), { statusCode: 400 });
  }
  if (!config.cloudflareTunnelName) {
    throw Object.assign(new Error('cloudflareTunnelName is required'), { statusCode: 400 });
  }
  if (config.cloudflareConfigPath && !fs.existsSync(expandHome(config.cloudflareConfigPath))) {
    throw Object.assign(new Error('cloudflareConfigPath does not exist'), { statusCode: 400 });
  }
  const cloudflared = requireCloudflared(config);
  return {
    ...getStatus(options),
    validation: {
      ok: true,
      mode: 'stable',
      cloudflaredPath: cloudflared,
      publicOrigin: config.publicBaseUrl,
      canonicalResource: config.stableTunnel.canonicalResource,
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
  const effectiveAuthIssuer = getEffectiveAuthIssuer(config);
  const explicitAuthMode = normalizeString(options.authMode).toLowerCase();
  const authEnabled = explicitAuthMode === 'oauth'
    ? Boolean(isRunning(tunnelProcess) && effectivePublicBaseUrl && hasOAuthConfig(config))
    : false;
  mcpLastExit = null;
  mcpLastProbe = null;
  mcpOutput = { stdout: '', stderr: '' };
  mcpProcess = spawn(process.execPath, [entry], {
    cwd: packageRoot,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      LOCAL_REPO_MCP_PORT: String(config.port),
      LOCAL_REPO_MCP_PUBLIC_BASE_URL: effectivePublicBaseUrl,
      LOCAL_REPO_MCP_AUTH_PROVIDER: config.authProvider,
      LOCAL_REPO_MCP_AUTH_ISSUER: effectiveAuthIssuer,
      LOCAL_REPO_MCP_AUTH_AUDIENCE: effectiveAuthAudience,
      LOCAL_REPO_MCP_AUTH_MODE: authEnabled ? 'oauth' : 'disabled',
      LOCAL_REPO_MCP_REQUIRED_SCOPES: config.requiredScopes.join(' '),
      LOCAL_REPO_MCP_PUBLIC_ACCESS_TOKEN: '',
      LOCAL_REPO_MCP_APPROVAL_SECRET: getApprovalSecret(options),
      ELEGY_HOME: resolveElegyHome(options.elegyHome || options.elegyHomeAbs),
    },
  });
  mcpProcess.stdout?.on('data', (chunk) => appendOutput('stdout', chunk));
  mcpProcess.stderr?.on('data', (chunk) => appendOutput('stderr', chunk));
  mcpProcess.once('error', (error) => {
    mcpLastExit = { error: error.message, at: new Date().toISOString(), stdout: mcpOutput.stdout, stderr: mcpOutput.stderr };
  });
  mcpProcess.once('exit', (code, signal) => {
    mcpLastExit = { code, signal, at: new Date().toISOString(), stdout: mcpOutput.stdout, stderr: mcpOutput.stderr };
    mcpProcess = null;
  });
  return getStatus(options);
}

async function waitForMcpReady(options = {}) {
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : (tunnelMode === 'quick' ? 30000 : 8000);
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    const status = getStatus(options);
    if (!status.server.running) {
      const detail = mcpLastExit?.stderr || mcpLastExit?.error || mcpLastExit?.code;
      throw Object.assign(
        new Error(`Local Repo MCP exited before becoming ready${detail ? `: ${detail}` : '.'}`),
        { statusCode: 500 },
      );
    }

    if (tunnelMode === 'quick') {
      const localProbe = await probeMcpEndpoint(status.server.url);
      mcpLastProbe = { ...localProbe, target: status.server.url, checkedAt: new Date().toISOString() };
      if (!localProbe.ok) {
        lastError = new Error(localProbe.message || `MCP probe returned ${localProbe.status}`);
      } else {
        const localMetadata = await probeOAuthMetadata(status.server.url.replace(/\/mcp$/, ''));
        if (localMetadata.oauth) {
          mcpLastProbe = {
            ok: false,
            status: localMetadata.status,
            code: 'oauth_metadata',
            message: 'No-auth quick tunnel is still advertising OAuth protected-resource metadata.',
            target: status.server.url,
            checkedAt: new Date().toISOString(),
          };
          lastError = new Error(mcpLastProbe.message);
        } else {
          return getStatus(options);
        }
      }
    } else {
      try {
        const response = await fetch(status.server.url.replace(/\/mcp$/, '/.well-known/oauth-protected-resource'));
        if (response.ok) {
          mcpLastProbe = { ok: true, status: response.status, code: 'oauth_metadata', message: 'OAuth metadata endpoint is reachable.', target: status.server.url, checkedAt: new Date().toISOString() };
          return getStatus(options);
        }
        lastError = new Error(`readiness probe returned ${response.status}`);
      } catch (error) {
        lastError = error;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, tunnelMode === 'quick' ? 500 : 150));
  }

  throw Object.assign(
    new Error(`Timed out waiting for Local Repo MCP to become ready${lastError instanceof Error ? `: ${lastError.message}` : '.'}`),
    { statusCode: 500 },
  );
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
  const cloudflaredPath = requireCloudflared(config);
  mcpLastNotice = '';
  const stoppedPids = isRunning(mcpProcess) ? [] : stopUntrackedLocalRepoMcpProcesses(config, options);
  if (stoppedPids.length > 0) {
    mcpLastNotice = `Stopped stale Local Repo MCP process(es): ${stoppedPids.join(', ')}`;
  }
  const currentStatus = getStatus(options);
  if (
    currentStatus.server.running
    && currentStatus.tunnel.running
    && currentStatus.tunnel.mode === 'quick'
    && currentStatus.chatGptAccess?.ready
  ) {
    return currentStatus;
  }
  if (isRunning(tunnelProcess)) await stopTunnel(options);

  tunnelMode = 'quick';
  quickTunnelBaseUrl = '';
  if (isRunning(mcpProcess)) await stopServer(options);
  startServer({ ...options, authMode: 'disabled' });
  try {
    await waitForMcpReady(options);
  } catch (error) {
    await stopServer(options);
    tunnelMode = 'none';
    throw Object.assign(error, { statusCode: error.statusCode || 500 });
  }

  tunnelProcess = spawn(cloudflaredPath, ['tunnel', '--url', `http://127.0.0.1:${config.port}`], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  tunnelProcess.once('exit', () => {
    tunnelProcess = null;
    tunnelMode = 'none';
    quickTunnelBaseUrl = '';
    mcpLastProbe = null;
  });

  try {
    quickTunnelBaseUrl = await waitForQuickTunnelUrl(tunnelProcess);
  } catch (error) {
    await stopServer(options);
    await stopTunnel(options);
    throw Object.assign(error, { statusCode: error.statusCode || 500 });
  }

  const publicProbe = await probeMcpEndpoint(getQuickConnectorUrl());
  if (!publicProbe.ok) {
    const publicMessage = publicProbe.message || `MCP probe returned ${publicProbe.status || publicProbe.code || 'unknown status'}`;
    mcpLastNotice = [mcpLastNotice, `Public ChatGPT URL probe failed for ${getQuickConnectorUrl()}: ${publicMessage}`]
      .filter(Boolean)
      .join(' ');
  }
  return getStatus(options);
}

async function startTunnel(options = {}) {
  const config = loadConfig(options);
  validateOAuthConfig(config);
  const cloudflaredPath = requireCloudflared(config);
  if (!config.cloudflareTunnelName) {
    throw Object.assign(new Error('cloudflareTunnelName is required for named tunnel mode'), { statusCode: 400 });
  }
  const stableBaseUrl = config.publicBaseUrl.replace(/\/+$/, '');
  const canonicalResource = connectorUrlFromBase(stableBaseUrl);
  const stableConfig = {
    ...config,
    activeExposureMode: 'stable',
    stableTunnel: {
      ...config.stableTunnel,
      configured: true,
      publicOrigin: stableBaseUrl,
      canonicalResource,
    },
    authProvider: config.authProvider || 'builtin',
    publicBaseUrl: stableBaseUrl,
    authIssuer: config.authProvider === 'external' ? config.authIssuer : stableBaseUrl,
    authAudience: config.authProvider === 'external' ? config.authAudience : canonicalResource,
    oauth: {
      ...config.oauth,
      provider: config.authProvider || 'builtin',
      issuer: config.authProvider === 'external' ? config.authIssuer : stableBaseUrl,
      audience: config.authProvider === 'external' ? config.authAudience : canonicalResource,
    },
  };
  saveConfig({ ...options, config: stableConfig });
  const currentStatus = getStatus(options);
  if (currentStatus.securityState === 'OAuth protected' && currentStatus.tunnel.mode === 'named') {
    await stopServer(options);
    startServer(options);
    return waitForMcpReady(options);
  }
  if (isRunning(tunnelProcess)) await stopTunnel(options);
  const args = config.cloudflareConfigPath
    ? ['tunnel', '--config', config.cloudflareConfigPath, 'run', config.cloudflareTunnelName]
    : ['tunnel', 'run', config.cloudflareTunnelName];
  tunnelProcess = spawn(cloudflaredPath, args, {
    windowsHide: true,
    stdio: 'ignore',
  });
  tunnelMode = 'named';
  quickTunnelBaseUrl = '';
  mcpLastProbe = null;
  tunnelProcess.once('exit', () => {
    tunnelProcess = null;
    tunnelMode = 'none';
  });
  if (isRunning(mcpProcess)) await stopServer(options);
  startServer({ ...options, authMode: 'oauth' });
  try {
    return await waitForMcpReady(options);
  } catch (error) {
    await stopServer(options);
    await stopTunnel(options);
    throw Object.assign(error, { statusCode: error.statusCode || 500 });
  }
}

async function stopTunnel(options = {}) {
  await stopChild(tunnelProcess);
  tunnelProcess = null;
  tunnelMode = 'none';
  quickTunnelBaseUrl = '';
  mcpLastProbe = null;
  return getStatus(options);
}

async function probe(options = {}) {
  const status = getStatus(options);
  const probeResult = await probeMcpEndpoint(status.server.url);
  mcpLastProbe = { ...probeResult, target: status.server.url, checkedAt: new Date().toISOString() };
  return {
    ...getStatus(options),
    probe: mcpLastProbe,
  };
}

async function getPendingAuthorizations(options = {}) {
  const status = getStatus(options);
  if (!status.server.running) return { ...status, pending: [], pendingError: 'Local Repo MCP is not running.' };
  if (status.securityState !== 'OAuth protected' || status.config.authProvider !== 'builtin') {
    return { ...status, pending: [] };
  }
  try {
    const response = await fetch(status.server.url.replace(/\/mcp$/, '/oauth/pending'), {
      headers: { 'x-local-repo-mcp-approval-secret': getApprovalSecret(options) },
    });
    if (!response.ok) {
      const pendingErrorCode = response.status === 403 ? 'approval_secret_mismatch' : 'pending_request_failed';
      return { ...status, pending: [], pendingErrorCode, pendingError: `Unable to read pending OAuth authorizations (${response.status}).` };
    }
    const payload = await response.json();
    return { ...status, pending: Array.isArray(payload.pending) ? payload.pending : [] };
  } catch (error) {
    return { ...status, pending: [], pendingError: error instanceof Error ? error.message : String(error) };
  }
}

async function approveAuthorization(options = {}) {
  const status = getStatus(options);
  if (!status.server.running) {
    throw Object.assign(new Error('Local Repo MCP must be running before approving ChatGPT access.'), { statusCode: 400 });
  }
  const response = await fetch(status.server.url.replace(/\/mcp$/, '/oauth/approve'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-local-repo-mcp-approval-secret': getApprovalSecret(options),
    },
    body: JSON.stringify({ id: options.id }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error(payload.message || payload.error || `Unable to approve authorization (${response.status}).`), { statusCode: response.status });
  }
  return { ...status, approval: payload };
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
  validateStableConfiguration,
  stopTunnel,
  probe,
  getPendingAuthorizations,
  approveAuthorization,
};
