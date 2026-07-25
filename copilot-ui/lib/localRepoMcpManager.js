'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, spawn } = require('child_process');
const {
  CloudflareConfigError,
  createManagedTunnelProvisioningPreview,
  executeManagedTunnelProvisioning,
  inspectNamedTunnelConfiguration,
} = require('./localRepoMcpCloudflare');

const CONFIG_SCHEMA_VERSION = 3;
const DEFAULT_PORT = 3333;
const provisioningPreviews = new Map();
const RECOVERY_DELAYS_MS = [1000, 2000, 5000, 10000, 30000];

let mcpProcess = null;
let tunnelProcess = null;
let tunnelMode = 'none';
let quickTunnelBaseUrl = '';
let tunnelLastExit = null;
let tunnelOutput = { stdout: '', stderr: '' };
let mcpLastExit = null;
let mcpLastProbe = null;
let mcpLastNotice = '';
let mcpOutput = { stdout: '', stderr: '' };
const MCP_OUTPUT_LIMIT = 4000;
let managedLifecycle = {
  options: null,
  monitorTimer: null,
  recoveryTimer: null,
  failures: [],
  stopping: false,
  manualStop: false,
  suppressRecovery: false,
  last: {
    code: 'not_initialized',
    blocked: false,
    recovering: false,
  },
};

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

function resolveRuntimeStatePath(elegyHome) {
  return path.join(resolveElegyHome(elegyHome), 'local-repo-mcp', 'runtime-state.json');
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function lifecycleConfigHash(config) {
  return sha256(JSON.stringify({
    port: config.port,
    publicOrigin: config.stableTunnel?.publicOrigin || '',
    tunnelId: config.stableTunnel?.cloudflareTunnelId || '',
    tunnelName: config.stableTunnel?.cloudflareTunnelName || '',
    configPath: config.stableTunnel?.cloudflareConfigPath || '',
    credentialsPath: config.stableTunnel?.cloudflareCredentialsPath || '',
  }));
}

function readRuntimeState(options = {}) {
  return readJsonIfExists(resolveRuntimeStatePath(options.elegyHome || options.elegyHomeAbs));
}

function writeRuntimeState(options = {}, value) {
  writeJsonAtomic(resolveRuntimeStatePath(options.elegyHome || options.elegyHomeAbs), value);
}

function recordOwnedProcess(kind, child, command, args, config, options = {}) {
  if (!child?.pid || tunnelMode !== 'named') return;
  const current = readRuntimeState(options) || {};
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  writeRuntimeState(options, {
    version: 1,
    mode: 'stable',
    instanceId: normalizeString(current.instanceId) || crypto.randomUUID(),
    updatedAt: new Date(nowMs).toISOString(),
    processes: {
      ...(current.processes && typeof current.processes === 'object' ? current.processes : {}),
      [kind]: {
        pid: child.pid,
        startedAt: new Date(nowMs).toISOString(),
        executablePath: String(command),
        args: [...args],
        argsHash: sha256(JSON.stringify(args)),
        configHash: lifecycleConfigHash(config),
      },
    },
  });
}

function forgetOwnedProcess(kind, pid, options = {}) {
  const current = readRuntimeState(options);
  if (!current?.processes?.[kind] || current.processes[kind].pid !== pid) return;
  const processes = { ...current.processes };
  delete processes[kind];
  writeRuntimeState(options, {
    ...current,
    updatedAt: new Date().toISOString(),
    processes,
  });
}

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function inspectOwnedProcess(record) {
  if (!isPidAlive(record?.pid)) return { alive: false };
  if (process.platform === 'win32') {
    const script = [
      `$p = Get-CimInstance Win32_Process -Filter "ProcessId = ${Number(record.pid)}" -ErrorAction SilentlyContinue`,
      'if ($p) {',
      '  [pscustomobject]@{',
      '    alive = $true',
      '    startedAt = $p.CreationDate.ToUniversalTime().ToString("o")',
      '    executablePath = [string]$p.ExecutablePath',
      '    commandLine = [string]$p.CommandLine',
      '  } | ConvertTo-Json -Compress',
      '}',
    ].join('\n');
    try {
      const parsed = JSON.parse(execFileSync(
        'powershell.exe',
        ['-NoProfile', '-Command', script],
        { encoding: 'utf8', windowsHide: true, timeout: 10000 },
      ));
      return parsed?.alive ? parsed : { alive: false };
    } catch {
      return { alive: true, unverifiable: true };
    }
  }
  try {
    const startedAtText = execFileSync(
      'ps',
      ['-p', String(record.pid), '-o', 'lstart='],
      { encoding: 'utf8', timeout: 10000 },
    ).trim();
    const commandLine = execFileSync(
      'ps',
      ['-p', String(record.pid), '-o', 'command='],
      { encoding: 'utf8', timeout: 10000 },
    ).trim();
    const startedAtMs = Date.parse(startedAtText);
    return {
      alive: Boolean(commandLine),
      commandLine,
      startedAt: Number.isFinite(startedAtMs) ? new Date(startedAtMs).toISOString() : '',
    };
  } catch {
    return { alive: true, unverifiable: true };
  }
}

function processRecordMatches(record, actual, config) {
  if (!actual?.alive || actual.unverifiable) return false;
  if (record.configHash !== lifecycleConfigHash(config)) return false;
  const commandLine = normalizeString(actual.commandLine);
  const executable = normalizeString(actual.executablePath).toLowerCase();
  const expectedExecutable = normalizeString(record.executablePath).toLowerCase();
  const executableMatches = executable
    ? executable === expectedExecutable || path.basename(executable) === path.basename(expectedExecutable)
    : commandLine.toLowerCase().includes(expectedExecutable);
  const argsMatch = Array.isArray(actual.args)
    ? sha256(JSON.stringify(actual.args)) === record.argsHash
    : Array.isArray(record.args) && record.args.every((arg) => commandLine.includes(String(arg)));
  const actualStartedAt = Date.parse(actual.startedAt || '');
  const expectedStartedAt = Date.parse(record.startedAt || '');
  const startMatches = Number.isFinite(actualStartedAt) && Number.isFinite(expectedStartedAt)
    ? Math.abs(actualStartedAt - expectedStartedAt) <= 5000
    : false;
  return executableMatches && argsMatch && startMatches;
}

function createAdoptedProcess(record, isAlive) {
  return {
    pid: record.pid,
    adopted: true,
    killed: false,
    exitCode: null,
    signalCode: null,
    isAlive,
    kill(signal = 'SIGTERM') {
      process.kill(record.pid, signal);
      this.killed = true;
    },
  };
}

function computeRecoveryDelay(failureTimestamps = [], nowMs = Date.now()) {
  const recent = failureTimestamps.filter((timestamp) =>
    Number.isFinite(timestamp) && timestamp >= nowMs - 10 * 60 * 1000
  );
  return recent.length >= RECOVERY_DELAYS_MS.length ? null : RECOVERY_DELAYS_MS[recent.length];
}

function shouldRetryManagedLifecycleError(error) {
  const code = normalizeString(error?.code);
  if (!code) return true;
  return !(
    code === 'foreign_process'
    || code === 'stable_origin_invalid'
    || code === 'cloudflared_version_failed'
    || code === 'cloudflare_tunnel_list_failed'
    || code.startsWith('cloudflare_credentials')
    || code.startsWith('cloudflare_config')
    || code.startsWith('cloudflare_ingress')
    || code.startsWith('cloudflare_service')
    || code.startsWith('cloudflare_hostname')
    || code.startsWith('cloudflare_catch_all')
    || code.startsWith('cloudflare_tunnel_')
  );
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
      managementMode: 'existing',
      setupVersion: 0,
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
      managementMode: stableRaw.managementMode === 'managed' ? 'managed' : 'existing',
      setupVersion: Number.isInteger(stableRaw.setupVersion) && stableRaw.setupVersion > 0
        ? stableRaw.setupVersion
        : 0,
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
    const sourceVersion = Number.isInteger(raw.schemaVersion) && raw.schemaVersion > 0 ? raw.schemaVersion : 1;
    const backupPath = path.join(path.dirname(configPath), `config.v${sourceVersion}.backup.json`);
    if (!fs.existsSync(backupPath)) writeJsonAtomic(backupPath, raw);
    writeJsonAtomic(configPath, config);
  }
  return config;
}

function provisioningScope(options = {}) {
  return resolveElegyHome(options.elegyHome || options.elegyHomeAbs);
}

function previewManagedTunnelProvisioning(options = {}) {
  const config = loadConfig(options);
  const cloudflaredPath = requireCloudflared(config);
  const previewId = normalizeString(options.previewId) || crypto.randomUUID();
  const preview = createManagedTunnelProvisioningPreview({
    zone: options.zone,
    previewId,
    nowMs: options.nowMs,
    port: config.port,
    cloudflaredPath,
    configDir: options.cloudflareConfigDir,
    exec: execFileSync,
  });
  provisioningPreviews.set(previewId, {
    scope: provisioningScope(options),
    preview,
  });
  return preview;
}

function consumeProvisioningPreview(options = {}) {
  const previewId = normalizeString(options.previewId);
  const stored = provisioningPreviews.get(previewId);
  if (!stored || stored.scope !== provisioningScope(options)) {
    throw new CloudflareConfigError(
      'cloudflare_preview_not_found',
      'Cloudflare provisioning preview was not found or has already been used.',
    );
  }
  provisioningPreviews.delete(previewId);
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  if (Date.parse(stored.preview.expiresAt) < nowMs) {
    throw new CloudflareConfigError(
      'cloudflare_preview_expired',
      'Cloudflare provisioning preview expired. Generate and review a new preview.',
    );
  }
  return stored.preview;
}

function confirmManagedTunnelProvisioning(options = {}) {
  const preview = consumeProvisioningPreview(options);
  const provisioning = executeManagedTunnelProvisioning(preview, { exec: execFileSync });
  const config = saveConfig({
    ...options,
    config: {
      activeExposureMode: 'stable',
      publicBaseUrl: provisioning.publicOrigin,
      cloudflareTunnelName: provisioning.tunnel.name,
      cloudflareConfigPath: provisioning.configPath,
      cloudflaredPath: preview.cloudflaredPath,
      stableTunnel: {
        configured: true,
        managementMode: 'managed',
        setupVersion: 1,
        autoStart: false,
        publicOrigin: provisioning.publicOrigin,
        canonicalResource: provisioning.canonicalResource,
        hostname: provisioning.hostname,
        cloudflareTunnelName: provisioning.tunnel.name,
        cloudflareTunnelId: provisioning.tunnel.id,
        cloudflareConfigPath: provisioning.configPath,
        cloudflareCredentialsPath: provisioning.credentialsPath,
        cloudflaredPath: preview.cloudflaredPath,
      },
    },
  });
  return { provisioning, config };
}

function cancelManagedTunnelProvisioning(options = {}) {
  const preview = consumeProvisioningPreview(options);
  return { cancelled: true, previewId: preview.previewId };
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
  if (!child || child.exitCode != null || child.signalCode != null || child.killed) return false;
  return child.adopted === true
    ? (typeof child.isAlive === 'function' ? child.isAlive() : isPidAlive(child.pid))
    : true;
}

function appendOutput(kind, chunk) {
  const text = chunk.toString();
  mcpOutput = {
    ...mcpOutput,
    [kind]: `${mcpOutput[kind] || ''}${text}`.slice(-MCP_OUTPUT_LIMIT),
  };
}

function appendTunnelOutput(kind, chunk) {
  tunnelOutput = {
    ...tunnelOutput,
    [kind]: `${tunnelOutput[kind] || ''}${chunk.toString()}`.slice(-MCP_OUTPUT_LIMIT),
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

async function fetchJson(url, init = {}) {
  const response = await fetch(url, init);
  const text = await response.text().catch(() => '');
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
  return { response, payload, text };
}

async function probeOAuthFlow(options = {}) {
  const config = loadConfig(options);
  const publicOrigin = config.publicBaseUrl;
  const resource = config.stableTunnel.canonicalResource;
  const localOrigin = `http://127.0.0.1:${config.port}`;
  if (!publicOrigin || !resource) {
    return { ok: false, code: 'oauth_config_missing', message: 'Persistent OAuth origin and canonical resource are required.' };
  }
  try {
    const protectedResult = await fetchJson(`${publicOrigin}/.well-known/oauth-protected-resource`);
    if (!protectedResult.response.ok || protectedResult.payload?.resource !== resource) {
      return { ok: false, code: 'protected_resource_metadata_invalid', status: protectedResult.response.status, message: 'Protected Resource Metadata does not advertise the canonical MCP resource.' };
    }
    const authorizationServer = protectedResult.payload?.authorization_servers?.[0];
    if (!authorizationServer) return { ok: false, code: 'authorization_server_missing', message: 'Protected Resource Metadata has no authorization server.' };
    const metadataResult = await fetchJson(`${authorizationServer}/.well-known/oauth-authorization-server`);
    const metadata = metadataResult.payload || {};
    if (!metadataResult.response.ok || !metadata.registration_endpoint || !metadata.token_endpoint || !metadata.revocation_endpoint) {
      return { ok: false, code: 'authorization_server_metadata_invalid', status: metadataResult.response.status, message: 'Authorization Server Metadata is incomplete.' };
    }

    const challengeResponse = await postMcpProbe(resource, 1, 'initialize');
    if (challengeResponse.status !== 401 || !hasOAuthChallenge(challengeResponse)) {
      return { ok: false, code: 'oauth_challenge_missing', status: challengeResponse.status, message: 'Unauthenticated MCP request did not return an OAuth bearer challenge.' };
    }

    const redirectUri = 'https://chatgpt.com/connector/oauth/cb';
    const registration = await fetchJson(metadata.registration_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_name: 'Elegy OAuth readiness probe', redirect_uris: [redirectUri], token_endpoint_auth_method: 'none' }),
    });
    const clientId = registration.payload?.client_id;
    if (!registration.response.ok || !clientId) {
      return { ok: false, code: 'client_registration_failed', status: registration.response.status, message: 'Dynamic client registration failed.' };
    }

    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const authorizeUrl = new URL(metadata.authorization_endpoint);
    authorizeUrl.search = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: `${config.requiredScopes.join(' ')} offline_access`,
      state: crypto.randomBytes(16).toString('base64url'),
      code_challenge: challenge,
      code_challenge_method: 'S256',
      resource,
    }).toString();
    const authorization = await fetch(authorizeUrl);
    if (!authorization.ok) return { ok: false, code: 'authorization_request_failed', status: authorization.status, message: 'Authorization request failed.' };

    const approvalSecret = getApprovalSecret(options);
    const pendingResult = await fetchJson(`${localOrigin}/oauth/pending`, {
      headers: { 'x-local-repo-mcp-approval-secret': approvalSecret },
    });
    const pending = Array.isArray(pendingResult.payload?.pending)
      ? pendingResult.payload.pending.find((entry) => entry.clientId === clientId)
      : null;
    if (!pending) return { ok: false, code: 'authorization_pending_missing', message: 'Synthetic authorization request was not found on the local approval channel.' };
    const approval = await fetchJson(`${localOrigin}/oauth/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-local-repo-mcp-approval-secret': approvalSecret },
      body: JSON.stringify({ id: pending.id }),
    });
    if (!approval.response.ok || !approval.payload?.redirectUrl) {
      return { ok: false, code: 'authorization_approval_failed', status: approval.response.status, message: 'Synthetic authorization could not be approved.' };
    }
    const code = new URL(approval.payload.redirectUrl).searchParams.get('code') || '';
    const tokenResult = await fetchJson(metadata.token_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verifier, client_id: clientId, resource }),
    });
    if (!tokenResult.response.ok || !tokenResult.payload?.access_token || !tokenResult.payload?.refresh_token) {
      return { ok: false, code: 'token_exchange_failed', status: tokenResult.response.status, message: 'Authorization-code token exchange failed.' };
    }
    const refreshResult = await fetchJson(metadata.token_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokenResult.payload.refresh_token, client_id: clientId, resource }),
    });
    if (!refreshResult.response.ok || !refreshResult.payload?.access_token || !refreshResult.payload?.refresh_token) {
      return { ok: false, code: 'refresh_exchange_failed', status: refreshResult.response.status, message: 'Refresh-token rotation failed.' };
    }
    const authenticated = await fetch(resource, {
      method: 'POST',
      headers: {
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${refreshResult.payload.access_token}`,
        'content-type': 'application/json',
      },
      body: buildMcpProbeBody(3, 'tools/list'),
    });
    const authenticatedText = await authenticated.text().catch(() => '');
    const authenticatedPayload = parseMcpJson(authenticatedText);
    if (!authenticated.ok || !Array.isArray(authenticatedPayload?.result?.tools)) {
      return { ok: false, code: 'authenticated_mcp_failed', status: authenticated.status, message: 'Authenticated MCP tools/list failed.' };
    }
    await fetch(metadata.revocation_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: refreshResult.payload.refresh_token, client_id: clientId }),
    });
    return {
      ok: true,
      code: 'oauth_flow_ok',
      status: authenticated.status,
      message: 'OAuth discovery, PKCE, refresh rotation, revocation, and authenticated MCP access succeeded.',
      tools: authenticatedPayload.result.tools.map((tool) => normalizeString(tool?.name)).filter(Boolean),
    };
  } catch (error) {
    return { ok: false, code: 'oauth_flow_error', status: null, message: error instanceof Error ? error.message : String(error) };
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
  const stableReady = Boolean(stableOnline && mcpLastProbe?.ok && mcpLastProbe?.code === 'oauth_flow_ok');
  const lifecycleState = exposureMode === 'quick'
    ? (quickReady ? 'quick_ready' : 'stopped')
    : !stableConfigured
      ? 'not_configured'
      : !stableOnline
        ? 'configured_offline'
        : stableReady
          ? 'oauth_ready'
          : mcpLastProbe?.ok
            ? 'online_unverified'
          : 'degraded';
  const chatGptReady = quickReady || stableReady;
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
      lastExit: tunnelLastExit,
      output: tunnelOutput,
    },
    probe: mcpLastProbe,
    lifecycle: managedLifecycle.last,
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
  const cloudflared = requireCloudflared(config);
  const inspection = inspectNamedTunnelConfiguration(config, cloudflared, { exec: execFileSync });
  return {
    ...getStatus(options),
    validation: {
      mode: 'stable',
      cloudflaredPath: cloudflared,
      ...inspection,
    },
  };
}

function setLifecycleStatus(next) {
  managedLifecycle.last = {
    ...managedLifecycle.last,
    ...next,
    checkedAt: new Date().toISOString(),
  };
  return managedLifecycle.last;
}

function adoptOwnedRuntimeProcesses(options, config) {
  const runtime = readRuntimeState(options);
  if (!runtime?.processes || runtime.mode !== 'stable') return { adopted: [] };
  const inspect = typeof options.inspectProcess === 'function' ? options.inspectProcess : inspectOwnedProcess;
  const adopted = [];
  const stale = [];
  for (const kind of ['tunnel', 'mcp']) {
    const record = runtime.processes[kind];
    if (!record) continue;
    const actual = inspect(record, kind);
    if (!actual?.alive) {
      stale.push(kind);
      continue;
    }
    if (!processRecordMatches(record, actual, config)) {
      return {
        adopted,
        blocker: {
          code: 'foreign_process',
          blocked: true,
          recovering: false,
          message: `A surviving process for ${kind} does not match Elegy ownership metadata. It was not adopted or terminated.`,
          pid: record.pid,
        },
      };
    }
    const handle = createAdoptedProcess(record, () => {
      const latest = inspect(record, kind);
      return processRecordMatches(record, latest, config);
    });
    if (kind === 'tunnel') {
      tunnelProcess = handle;
      tunnelMode = 'named';
    } else {
      mcpProcess = handle;
    }
    adopted.push(kind);
  }
  if (stale.length > 0) {
    const processes = { ...runtime.processes };
    for (const kind of stale) delete processes[kind];
    writeRuntimeState(options, { ...runtime, updatedAt: new Date().toISOString(), processes });
  }
  return { adopted };
}

function scheduleManagedRecovery(reason) {
  const options = managedLifecycle.options;
  if (
    !options
    || managedLifecycle.stopping
    || managedLifecycle.manualStop
    || managedLifecycle.suppressRecovery
    || managedLifecycle.recoveryTimer
  ) return;
  const nowMs = typeof options.now === 'function' ? options.now() : Date.now();
  const delay = computeRecoveryDelay(managedLifecycle.failures, nowMs);
  if (delay == null) {
    setLifecycleStatus({
      code: 'recovery_exhausted',
      blocked: true,
      recovering: false,
      message: 'Persistent tunnel recovery stopped after five failures in ten minutes.',
      reason,
    });
    return;
  }
  managedLifecycle.failures = managedLifecycle.failures
    .filter((timestamp) => timestamp >= nowMs - 10 * 60 * 1000)
    .concat(nowMs);
  setLifecycleStatus({
    code: 'recovery_scheduled',
    blocked: false,
    recovering: true,
    message: `Persistent tunnel recovery is scheduled in ${delay}ms.`,
    reason,
    retryDelayMs: delay,
  });
  const schedule = typeof options.setTimeout === 'function' ? options.setTimeout : setTimeout;
  managedLifecycle.recoveryTimer = schedule(async () => {
    managedLifecycle.recoveryTimer = null;
    if (managedLifecycle.stopping || managedLifecycle.manualStop) return;
    try {
      await startTunnel({ ...options, lifecycleInternal: true });
      managedLifecycle.failures = [];
      setLifecycleStatus({
        code: 'recovered',
        blocked: false,
        recovering: false,
        message: 'Persistent tunnel processes recovered successfully.',
      });
    } catch (error) {
      if (!shouldRetryManagedLifecycleError(error)) {
        setLifecycleStatus({
          code: error?.code || 'recovery_blocked',
          blocked: true,
          recovering: false,
          message: error instanceof Error ? error.message : String(error),
        });
        return;
      }
      setLifecycleStatus({
        code: error?.code || 'recovery_failed',
        blocked: false,
        recovering: true,
        message: error instanceof Error ? error.message : String(error),
      });
      scheduleManagedRecovery('recovery_attempt_failed');
    }
  }, delay);
  managedLifecycle.recoveryTimer?.unref?.();
}

function runManagedLifecycleCheck() {
  if (!managedLifecycle.options || managedLifecycle.stopping || managedLifecycle.manualStop) {
    return managedLifecycle.last;
  }
  if (!isRunning(tunnelProcess) || !isRunning(mcpProcess)) {
    scheduleManagedRecovery('owned_process_not_running');
  }
  return managedLifecycle.last;
}

async function initializeManagedLifecycle(options = {}) {
  managedLifecycle.options = { ...options };
  managedLifecycle.stopping = false;
  managedLifecycle.manualStop = false;
  managedLifecycle.failures = [];
  const config = loadConfig(options);
  if (
    config.stableTunnel?.managementMode !== 'managed'
    || config.stableTunnel?.setupVersion !== 1
    || config.stableTunnel?.autoStart !== true
  ) {
    setLifecycleStatus({
      code: 'autostart_disabled',
      blocked: false,
      recovering: false,
      message: 'Persistent tunnel autostart is not enabled for a completed managed setup.',
    });
    return getStatus(options);
  }
  const adoption = adoptOwnedRuntimeProcesses(options, config);
  if (adoption.blocker) {
    setLifecycleStatus(adoption.blocker);
    return getStatus(options);
  }
  if (adoption.adopted.includes('tunnel') && adoption.adopted.includes('mcp')) {
    setLifecycleStatus({
      code: 'owned_processes_adopted',
      blocked: false,
      recovering: false,
      message: 'Adopted the matching persistent tunnel processes from the previous Elegy runtime.',
    });
  } else {
    try {
      validateStableConfiguration(options);
      await startTunnel({ ...options, lifecycleInternal: true });
      setLifecycleStatus({
        code: 'autostart_started',
        blocked: false,
        recovering: false,
        message: 'Persistent tunnel autostart completed.',
      });
    } catch (error) {
      setLifecycleStatus({
        code: error?.code || 'autostart_blocked',
        blocked: true,
        recovering: false,
        message: error instanceof Error ? error.message : String(error),
      });
      return getStatus(options);
    }
  }
  if (options.monitor !== false && !managedLifecycle.monitorTimer) {
    const scheduleInterval = typeof options.setInterval === 'function' ? options.setInterval : setInterval;
    managedLifecycle.monitorTimer = scheduleInterval(runManagedLifecycleCheck, 5000);
    managedLifecycle.monitorTimer?.unref?.();
  }
  return getStatus(options);
}

async function shutdownManagedLifecycle(options = {}) {
  managedLifecycle.stopping = true;
  const lifecycleOptions = managedLifecycle.options || options;
  const clearScheduledTimeout = typeof lifecycleOptions.clearTimeout === 'function'
    ? lifecycleOptions.clearTimeout
    : clearTimeout;
  const clearScheduledInterval = typeof lifecycleOptions.clearInterval === 'function'
    ? lifecycleOptions.clearInterval
    : clearInterval;
  if (managedLifecycle.recoveryTimer) clearScheduledTimeout(managedLifecycle.recoveryTimer);
  if (managedLifecycle.monitorTimer) clearScheduledInterval(managedLifecycle.monitorTimer);
  managedLifecycle.recoveryTimer = null;
  managedLifecycle.monitorTimer = null;
  if (options.stopProcesses !== false) {
    await stopServer({ ...lifecycleOptions, lifecycleInternal: true });
    await stopTunnel({ ...lifecycleOptions, lifecycleInternal: true });
    const runtimePath = resolveRuntimeStatePath(lifecycleOptions.elegyHome || lifecycleOptions.elegyHomeAbs);
    if (fs.existsSync(runtimePath)) fs.rmSync(runtimePath, { force: true });
  }
  managedLifecycle.options = null;
  setLifecycleStatus({
    code: 'stopped',
    blocked: false,
    recovering: false,
    message: 'Persistent tunnel lifecycle supervision stopped.',
  });
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
      LOCAL_REPO_MCP_ACCESS_TOKEN_TTL_SECONDS: String(config.oauth.accessTokenTtlSeconds),
      LOCAL_REPO_MCP_REFRESH_TOKEN_TTL_SECONDS: String(config.oauth.refreshTokenTtlSeconds),
      LOCAL_REPO_MCP_PUBLIC_ACCESS_TOKEN: '',
      LOCAL_REPO_MCP_APPROVAL_SECRET: getApprovalSecret(options),
      ELEGY_HOME: resolveElegyHome(options.elegyHome || options.elegyHomeAbs),
    },
  });
  recordOwnedProcess('mcp', mcpProcess, process.execPath, [entry], config, options);
  const ownedMcpPid = mcpProcess.pid;
  mcpProcess.stdout?.on('data', (chunk) => appendOutput('stdout', chunk));
  mcpProcess.stderr?.on('data', (chunk) => appendOutput('stderr', chunk));
  mcpProcess.once('error', (error) => {
    mcpLastExit = { error: error.message, at: new Date().toISOString(), stdout: mcpOutput.stdout, stderr: mcpOutput.stderr };
  });
  mcpProcess.once('exit', (code, signal) => {
    mcpLastExit = { code, signal, at: new Date().toISOString(), stdout: mcpOutput.stdout, stderr: mcpOutput.stderr };
    mcpProcess = null;
    forgetOwnedProcess('mcp', ownedMcpPid, options);
    scheduleManagedRecovery('mcp_process_exited');
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
  if (child.adopted === true) {
    try { child.kill(); } catch { /* process already exited */ }
    return;
  }
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
  if (!options.lifecycleInternal) managedLifecycle.manualStop = true;
  const previousSuppression = managedLifecycle.suppressRecovery;
  managedLifecycle.suppressRecovery = true;
  try {
    await stopChild(mcpProcess);
  } finally {
    managedLifecycle.suppressRecovery = previousSuppression;
  }
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
  tunnelLastExit = null;
  tunnelOutput = { stdout: '', stderr: '' };
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
    tunnelLastExit = { at: new Date().toISOString(), output: tunnelOutput };
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
  managedLifecycle.manualStop = false;
  const config = loadConfig(options);
  const validated = validateStableConfiguration(options);
  const cloudflaredPath = validated.validation.cloudflarePath || validated.validation.cloudflaredPath;
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
    await stopServer({ ...options, lifecycleInternal: true });
    startServer({ ...options, authMode: 'oauth' });
    return waitForMcpReady(options);
  }
  if (isRunning(tunnelProcess)) await stopTunnel({ ...options, lifecycleInternal: true });
  const args = config.cloudflareConfigPath
    ? ['tunnel', '--config', config.cloudflareConfigPath, 'run', config.cloudflareTunnelName]
    : ['tunnel', 'run', config.cloudflareTunnelName];
  tunnelLastExit = null;
  tunnelOutput = { stdout: '', stderr: '' };
  tunnelProcess = spawn(cloudflaredPath, args, {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  tunnelMode = 'named';
  recordOwnedProcess('tunnel', tunnelProcess, cloudflaredPath, args, stableConfig, options);
  const ownedTunnelPid = tunnelProcess.pid;
  tunnelProcess.stdout?.on('data', (chunk) => appendTunnelOutput('stdout', chunk));
  tunnelProcess.stderr?.on('data', (chunk) => appendTunnelOutput('stderr', chunk));
  quickTunnelBaseUrl = '';
  mcpLastProbe = null;
  tunnelProcess.once('exit', (code, signal) => {
    tunnelLastExit = { code, signal, at: new Date().toISOString(), output: tunnelOutput };
    tunnelProcess = null;
    tunnelMode = 'none';
    forgetOwnedProcess('tunnel', ownedTunnelPid, options);
    scheduleManagedRecovery('tunnel_process_exited');
  });
  if (isRunning(mcpProcess)) await stopServer({ ...options, lifecycleInternal: true });
  startServer({ ...options, authMode: 'oauth' });
  try {
    return await waitForMcpReady(options);
  } catch (error) {
    await stopServer({ ...options, lifecycleInternal: true });
    await stopTunnel({ ...options, lifecycleInternal: true });
    throw Object.assign(error, { statusCode: error.statusCode || 500 });
  }
}

async function stopTunnel(options = {}) {
  if (!options.lifecycleInternal) managedLifecycle.manualStop = true;
  const previousSuppression = managedLifecycle.suppressRecovery;
  managedLifecycle.suppressRecovery = true;
  try {
    await stopChild(tunnelProcess);
  } finally {
    managedLifecycle.suppressRecovery = previousSuppression;
  }
  tunnelProcess = null;
  tunnelMode = 'none';
  quickTunnelBaseUrl = '';
  mcpLastProbe = null;
  return getStatus(options);
}

async function probe(options = {}) {
  const status = getStatus(options);
  const probeResult = status.chatGptAccess.mode === 'stable' && status.server.running && status.tunnel.running
    ? await probeOAuthFlow(options)
    : await probeMcpEndpoint(status.server.url);
  const target = status.chatGptAccess.mode === 'stable' ? status.chatGptAccess.url : status.server.url;
  mcpLastProbe = { ...probeResult, target, checkedAt: new Date().toISOString() };
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
  previewManagedTunnelProvisioning,
  confirmManagedTunnelProvisioning,
  cancelManagedTunnelProvisioning,
  computeRecoveryDelay,
  shouldRetryManagedLifecycleError,
  initializeManagedLifecycle,
  runManagedLifecycleCheck,
  shutdownManagedLifecycle,
  stopTunnel,
  probe,
  getPendingAuthorizations,
  approveAuthorization,
};
