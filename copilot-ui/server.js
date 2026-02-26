#!/usr/bin/env node
/* eslint-disable no-console */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const childProcess = require('child_process');
const crypto = require('crypto');

const sessions = require('./lib/sessions');
const assets = require('./lib/assets');
const planState = require('./lib/planState');
const { resolvePermissionLocations } = require('./lib/permissionLocationsResolver');
const {
  CAPABILITY_STATES,
  RUNTIME_PROVIDER_SELECTION_SOURCES,
  SESSION_RECONCILIATION_CONTRACT_VERSION,
  SESSION_RECONCILIATION_SOURCES,
  SESSION_RECONCILIATION_SOURCE_PRECEDENCE,
  SESSION_RECONCILIATION_SOURCE_OF_TRUTH,
  SESSION_STATE_AUTHORITIES,
  normalizeCapabilityState,
  buildCompatibilityRuntimeContract,
} = require('./lib/runtimeContracts');
const {
  buildPlanningScopeIsolationPredicate,
  deriveNextPlanningRecordNumber,
  deriveBackfillRecoveryMarker,
  deriveBackfillSourceIdempotencyKey,
  buildPlanningProviderStatePersistencePayload,
  evaluatePlanningOptimisticConcurrencyGuard,
  listPersistedPlanningRecords,
  persistPlanningRecord,
  readPlanningPersistenceConfig,
  readPlanningProviderState,
  reconcileBackfillItemStatusTransition,
  validatePlanningPersistenceConfig,
  validatePlanningReadWriteContext,
  getPlanningPersistenceHealth,
  runPlanningMigrations,
} = require('./lib/planningPersistence');
const {
  SEMANTIC_SCORING_CONTRACT_VERSION,
  scorePlanningCandidate,
  sortPlanningCandidates,
  determineSemanticDegradedMode,
  classifyEmbeddingLifecycle,
  evaluateSemanticGate,
} = require('./lib/planningSemantic');
const {
  PLANNING_API_CONTRACT_VERSION,
  buildPlanningPersistenceHealthEnvelope,
  buildFinishCompatibilityHookContract,
  evaluateProviderLifecycleCapability,
  buildLifecycleUnsupportedCapabilityMarker,
  createPlanningApiState,
  replacePlanningProjectionFromPersistedRecords,
  createPlanningRecordOperation,
  listPlanningRecordsOperation,
  searchPlanningRecordsOperation,
  comparePlanningRecordsOperation,
} = require('./lib/planningApiContracts');

const WS3_AUTHORITY_DEPENDENCY_GATE_CONTRACT_VERSION = '1';
const WS3_AUTHORITY_DEPENDENCY_NAME = 'ws3_authority_reconciliation_contract';
const WS3_AUTHORITY_DEPENDENCY_BLOCK_CODE = 'planning_durability_dependency_gate_blocked';
const LIFECYCLE_MIXED_VERSION_COMPATIBILITY_CONTRACT_VERSION = '1';
const LIFECYCLE_MIXED_VERSION_COMPATIBILITY_CAPABILITY = 'mixed-version-lifecycle-v1';
const LIFECYCLE_COMPATIBILITY_HEADER_CONTRACT_VERSION = 'x-instruction-engine-lifecycle-contract-version';
const LIFECYCLE_COMPATIBILITY_HEADER_CAPABILITY = 'x-instruction-engine-lifecycle-capability';

function normalizeLifecycleCompatibilityToken(value) {
  if (Array.isArray(value)) {
    return normalizeLifecycleCompatibilityToken(value.length > 0 ? value[0] : '');
  }
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().toLowerCase();
}

function readLifecycleCompatibilityHeaderToken(headers, headerName) {
  const source = headers && typeof headers === 'object' ? headers : {};
  const token = source[String(headerName || '').toLowerCase()];
  return normalizeLifecycleCompatibilityToken(token);
}

function createLifecycleCompatibilityRequestHeaders() {
  return {
    'X-Instruction-Engine-Lifecycle-Contract-Version': LIFECYCLE_MIXED_VERSION_COMPATIBILITY_CONTRACT_VERSION,
    'X-Instruction-Engine-Lifecycle-Capability': LIFECYCLE_MIXED_VERSION_COMPATIBILITY_CAPABILITY,
  };
}

function buildLifecycleMixedVersionUnsupportedMarker(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const directionToken = String(source.direction || '').trim().toLowerCase();
  const direction = directionToken === 'old_client_new_tracker'
    ? 'old_client_new_tracker'
    : 'new_client_old_tracker';

  return {
    error: 'Lifecycle compatibility unsupported',
    code: 'lifecycle_compatibility_unsupported',
    action: String(source.action || '').trim() || null,
    reason: String(source.reason || '').trim() || 'compatibility_check_failed',
    deterministic: true,
    unsupported: {
      marker: 'unsupported',
      direction,
      expected: {
        contractVersion: LIFECYCLE_MIXED_VERSION_COMPATIBILITY_CONTRACT_VERSION,
        capability: LIFECYCLE_MIXED_VERSION_COMPATIBILITY_CAPABILITY,
      },
      received: {
        contractVersion: String(source.receivedContractVersion || '').trim() || null,
        capability: String(source.receivedCapability || '').trim() || null,
      },
    },
    compatibility: {
      contractVersion: LIFECYCLE_MIXED_VERSION_COMPATIBILITY_CONTRACT_VERSION,
      capability: LIFECYCLE_MIXED_VERSION_COMPATIBILITY_CAPABILITY,
      direction,
    },
  };
}

function evaluateLifecycleMixedVersionCompatibility(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const directionToken = String(source.direction || '').trim().toLowerCase();
  const direction = directionToken === 'old_client_new_tracker'
    ? 'old_client_new_tracker'
    : 'new_client_old_tracker';
  const reasonPrefix = direction === 'old_client_new_tracker' ? 'client' : 'tracker';

  const receivedContractVersion = readLifecycleCompatibilityHeaderToken(
    source.headers,
    LIFECYCLE_COMPATIBILITY_HEADER_CONTRACT_VERSION
  );
  const receivedCapability = readLifecycleCompatibilityHeaderToken(
    source.headers,
    LIFECYCLE_COMPATIBILITY_HEADER_CAPABILITY
  );

  const expectedContractVersion = normalizeLifecycleCompatibilityToken(
    LIFECYCLE_MIXED_VERSION_COMPATIBILITY_CONTRACT_VERSION
  );
  const expectedCapability = normalizeLifecycleCompatibilityToken(
    LIFECYCLE_MIXED_VERSION_COMPATIBILITY_CAPABILITY
  );

  let reason = '';
  if (!receivedContractVersion) {
    reason = `${reasonPrefix}_contract_version_missing`;
  } else if (receivedContractVersion !== expectedContractVersion) {
    reason = `${reasonPrefix}_contract_version_unsupported`;
  } else if (!receivedCapability) {
    reason = `${reasonPrefix}_capability_missing`;
  } else if (receivedCapability !== expectedCapability) {
    reason = `${reasonPrefix}_capability_unsupported`;
  }

  if (!reason) {
    return {
      compatible: true,
      direction,
      reason: 'compatibility_supported',
      receivedContractVersion: receivedContractVersion || null,
      receivedCapability: receivedCapability || null,
    };
  }

  return {
    compatible: false,
    statusCode: 501,
    direction,
    reason,
    receivedContractVersion: receivedContractVersion || null,
    receivedCapability: receivedCapability || null,
    body: buildLifecycleMixedVersionUnsupportedMarker({
      action: source.action,
      direction,
      reason,
      receivedContractVersion,
      receivedCapability,
    }),
  };
}

function createChangeTracker(copilotHomeAbs, vscodeHomeAbs, sandboxesHomeAbs) {
  let version = 0;
  let lastChangedMs = Date.now();
  let timer = null;
  const watchers = [];

  function bump() {
    version += 1;
    lastChangedMs = Date.now();
  }

  function scheduleBump() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(bump, 150);
  }

  function tryWatch(dirAbs, opts = {}) {
    try {
      if (!fs.existsSync(dirAbs) || !fs.statSync(dirAbs).isDirectory()) return;
      const recursive = Boolean(opts.recursive);
      const w = fs.watch(dirAbs, { persistent: false, recursive }, () => scheduleBump());
      watchers.push(w);
    } catch {
      // best-effort
    }
  }

  // Watch the primary folders users care about.
  // Also watch the Copilot home root so newly created folders (agents/skills) trigger updates.
  tryWatch(copilotHomeAbs);
  tryWatch(path.join(copilotHomeAbs, 'session-state'), { recursive: true });
  tryWatch(path.join(copilotHomeAbs, 'agents'));
  tryWatch(path.join(copilotHomeAbs, 'skills'));
  tryWatch(path.join(copilotHomeAbs, 'prompts'));

  // VS Code session store (separate root)
  if (vscodeHomeAbs) {
    tryWatch(vscodeHomeAbs);
    tryWatch(path.join(vscodeHomeAbs, 'session-state'), { recursive: true });
    tryWatch(path.join(vscodeHomeAbs, 'sessions-archive'), { recursive: true });
    // VS Code installed assets (non-recursive watch; best-effort)
    tryWatch(path.join(vscodeHomeAbs, 'agents'));
    tryWatch(path.join(vscodeHomeAbs, 'skills'));
    tryWatch(path.join(vscodeHomeAbs, 'prompts'));
  }

  // Watch sandbox directories.
  if (sandboxesHomeAbs) {
    tryWatch(sandboxesHomeAbs, { recursive: true });
  }

  // Periodic bump as a fallback: ensures UI stays roughly current even if fs.watch is flaky.
  const interval = setInterval(() => bump(), 60 * 1000);

  return {
    get() {
      return { version, lastChangedMs };
    },
    close() {
      if (timer) clearTimeout(timer);
      clearInterval(interval);
      for (const w of watchers) {
        try {
          w.close();
        } catch {
          // ignore
        }
      }
    },
  };
}

function parseArgs(argv) {
  const args = { port: 3210, host: '127.0.0.1', token: null, copilotHome: null, vscodeHome: null, sandboxesHome: null, trackerUrl: null, trackerToken: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      args.help = true;
      continue;
    }
    if (a === '--port') {
      const v = argv[++i];
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0) throw new Error(`Invalid --port: ${v}`);
      args.port = Math.floor(n);
      continue;
    }
    if (a.startsWith('--port=')) {
      const v = a.slice('--port='.length);
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0) throw new Error(`Invalid --port: ${v}`);
      args.port = Math.floor(n);
      continue;
    }
    if (a === '--copilot-home') {
      args.copilotHome = argv[++i];
      if (!args.copilotHome) throw new Error('Missing value for --copilot-home');
      continue;
    }
    if (a.startsWith('--copilot-home=')) {
      args.copilotHome = a.slice('--copilot-home='.length);
      if (!args.copilotHome) throw new Error('Missing value for --copilot-home');
      continue;
    }
    if (a === '--vscode-home') {
      args.vscodeHome = argv[++i];
      if (!args.vscodeHome) throw new Error('Missing value for --vscode-home');
      continue;
    }
    if (a.startsWith('--vscode-home=')) {
      args.vscodeHome = a.slice('--vscode-home='.length);
      if (!args.vscodeHome) throw new Error('Missing value for --vscode-home');
      continue;
    }
    if (a === '--host') {
      args.host = argv[++i];
      if (!args.host) throw new Error('Missing value for --host');
      continue;
    }
    if (a.startsWith('--host=')) {
      args.host = a.slice('--host='.length);
      if (!args.host) throw new Error('Missing value for --host');
      continue;
    }
    if (a === '--token') {
      args.token = argv[++i];
      if (!args.token) throw new Error('Missing value for --token');
      continue;
    }
    if (a.startsWith('--token=')) {
      args.token = a.slice('--token='.length);
      if (!args.token) throw new Error('Missing value for --token');
      continue;
    }
    if (a === '--sandboxes-home') {
      args.sandboxesHome = argv[++i];
      if (!args.sandboxesHome) throw new Error('Missing value for --sandboxes-home');
      continue;
    }
    if (a.startsWith('--sandboxes-home=')) {
      args.sandboxesHome = a.slice('--sandboxes-home='.length);
      if (!args.sandboxesHome) throw new Error('Missing value for --sandboxes-home');
      continue;
    }
    if (a === '--tracker-url') {
      args.trackerUrl = argv[++i];
      if (!args.trackerUrl) throw new Error('Missing value for --tracker-url');
      continue;
    }
    if (a.startsWith('--tracker-url=')) {
      args.trackerUrl = a.slice('--tracker-url='.length);
      if (!args.trackerUrl) throw new Error('Missing value for --tracker-url');
      continue;
    }
    if (a === '--tracker-token') {
      args.trackerToken = argv[++i];
      if (!args.trackerToken) throw new Error('Missing value for --tracker-token');
      continue;
    }
    if (a.startsWith('--tracker-token=')) {
      args.trackerToken = a.slice('--tracker-token='.length);
      if (!args.trackerToken) throw new Error('Missing value for --tracker-token');
      continue;
    }
  }
  return args;
}

function isNonLoopback(host) {
  return host !== '127.0.0.1' && host !== '::1' && host !== 'localhost';
}

function isLoopbackRequest(req) {
  const addr = req.socket.remoteAddress || '';
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

// Bearer-only auth. No cookies, no query-param tokens, no CSRF surface.
function checkAuth(req, token, options = {}) {
  // No token configured → pass (only possible on loopback bind)
  if (!token) return true;
  const allowLoopbackBypass = options.allowLoopbackBypass !== false;
  if (allowLoopbackBypass && isLoopbackRequest(req)) return true;
  // Extract bearer token from Authorization header
  const authHeader = req.headers['authorization'] || '';
  if (!authHeader.startsWith('Bearer ')) return false;
  const provided = authHeader.slice('Bearer '.length);
  // Constant-time comparison to prevent timing attacks
  const a = Buffer.from(token);
  const b = Buffer.from(provided);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function resolveToken(args, host) {
  // 3-tier precedence: --token CLI arg > COPILOT_UI_TOKEN env var > auto-generated
  if (args.token) return args.token;
  if (process.env.COPILOT_UI_TOKEN) return process.env.COPILOT_UI_TOKEN;
  if (isNonLoopback(host)) return crypto.randomBytes(32).toString('hex');
  return null;
}

function derivePlanningActorId(token) {
  if (typeof token === 'string' && token.trim()) {
    const digest = crypto.createHash('sha256').update(token.trim(), 'utf8').digest('hex');
    return `auth-${digest.slice(0, 16)}`;
  }
  return 'local-loopback-user';
}

function resolveCopilotHome(args) {
  if (args && typeof args.copilotHome === 'string' && args.copilotHome.trim()) {
    return path.resolve(args.copilotHome);
  }
  if (process.env.XDG_CONFIG_HOME && process.env.XDG_CONFIG_HOME.trim()) {
    return path.resolve(process.env.XDG_CONFIG_HOME);
  }
  const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
  return path.join(path.resolve(home), '.copilot');
}

function defaultVscodeHome() {
  const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
  return path.join(path.resolve(home), '.copilot');
}

function resolveVscodeHome(args) {
  if (args && typeof args.vscodeHome === 'string' && args.vscodeHome.trim()) {
    return path.resolve(args.vscodeHome);
  }
  return defaultVscodeHome();
}

function resolveSandboxesHome(args) {
  if (args && typeof args.sandboxesHome === 'string' && args.sandboxesHome.trim()) {
    return path.resolve(args.sandboxesHome);
  }
  const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
  return path.join(path.resolve(home), '.copilot', 'sandboxes');
}

function resolveTrackerUrl(args) {
  if (args && typeof args.trackerUrl === 'string' && args.trackerUrl.trim()) return args.trackerUrl.trim();
  if (process.env.INSTRUCTION_ENGINE_TRACKER_URL) return process.env.INSTRUCTION_ENGINE_TRACKER_URL.trim();
  return 'http://127.0.0.1:4100';
}

function resolveTrackerToken(args) {
  if (args && typeof args.trackerToken === 'string' && args.trackerToken.trim()) return args.trackerToken.trim();
  if (process.env.INSTRUCTION_ENGINE_GATEWAY_HTTP_TOKEN) return process.env.INSTRUCTION_ENGINE_GATEWAY_HTTP_TOKEN.trim();
  return null;
}

function resolveForcedCapabilityState(capabilityName) {
  const key = `INSTRUCTION_ENGINE_FORCE_${String(capabilityName || '').trim().toUpperCase()}_STATE`;
  const raw = process.env[key];
  if (!raw || !raw.trim()) return null;
  return normalizeCapabilityState(raw);
}

function probeCapability(command, args, timeoutMs = 1500) {
  try {
    const result = childProcess.spawnSync(command, args, {
      encoding: 'utf8',
      windowsHide: true,
      timeout: timeoutMs,
      maxBuffer: 256 * 1024,
    });
    return result.status === 0 ? CAPABILITY_STATES.AVAILABLE : CAPABILITY_STATES.UNAVAILABLE;
  } catch {
    return CAPABILITY_STATES.UNAVAILABLE;
  }
}

function detectDockerCapability() {
  const forced = resolveForcedCapabilityState('docker');
  if (forced) return forced;
  return probeCapability('docker', ['version', '--format', '{{.Server.Version}}']);
}

function detectWsl2Capability() {
  const forced = resolveForcedCapabilityState('wsl2');
  if (forced) return forced;
  if (process.platform !== 'win32') return CAPABILITY_STATES.UNKNOWN;
  return probeCapability('wsl.exe', ['--status']);
}

function detectSandboxCapability(dockerCapability, sandboxesHome) {
  const forced = resolveForcedCapabilityState('sandbox');
  if (forced) return forced;

  if (dockerCapability !== CAPABILITY_STATES.AVAILABLE) {
    return CAPABILITY_STATES.UNAVAILABLE;
  }

  if (typeof sandboxesHome !== 'string' || !sandboxesHome.trim()) {
    return CAPABILITY_STATES.UNAVAILABLE;
  }

  try {
    const sandboxesHomeAbs = path.resolve(sandboxesHome);
    fs.mkdirSync(sandboxesHomeAbs, { recursive: true });
    fs.accessSync(sandboxesHomeAbs, fs.constants.R_OK | fs.constants.W_OK);
    return CAPABILITY_STATES.AVAILABLE;
  } catch {
    return CAPABILITY_STATES.UNAVAILABLE;
  }
}

let runtimeHealthCache = {
  expiresAtMs: 0,
  value: null,
};

function getRuntimeHealth({ engineRoot, sandboxesHome, providerState }) {
  const now = Date.now();
  if (runtimeHealthCache.value && now < runtimeHealthCache.expiresAtMs) {
    return runtimeHealthCache.value;
  }

  const docker = detectDockerCapability();
  const wsl2 = detectWsl2Capability();
  const sandbox = detectSandboxCapability(docker, sandboxesHome);
  const resolvedProviderState = readPlanningProviderState({
    persistedState: providerState,
    env: process.env,
  });
  const canonicalProviderState = buildPlanningProviderStatePersistencePayload(resolvedProviderState);

  const runtime = buildCompatibilityRuntimeContract({
    mode: process.env.INSTRUCTION_ENGINE_RUNTIME_MODE,
    selectedProvider: canonicalProviderState.selectionSource === RUNTIME_PROVIDER_SELECTION_SOURCES.EXPLICIT
      ? canonicalProviderState.selectedProvider
      : null,
    defaultProvider: canonicalProviderState.defaultProvider,
    engineRoot,
    capabilities: {
      docker,
      wsl2,
      sandbox,
    },
  });

  runtime.finishCompatibilityHook = buildFinishCompatibilityHookContract();

  runtimeHealthCache = {
    value: runtime,
    expiresAtMs: now + 15_000,
  };

  return runtime;
}

function resolveSessionsHome(source, copilotHome, vscodeHome, sandboxesHome) {
  const s = String(source || '').trim().toLowerCase();
  if (s === 'vscode') return { source: 'vscode', home: vscodeHome };
  if (s === 'sandbox') return { source: 'sandbox', home: sandboxesHome };
  return { source: 'cli', home: copilotHome };
}

function isValidSessionId(id) {
  if (typeof id !== 'string' || id.length === 0 || id.length > 256) return false;
  if (id.includes('..') || id.includes('/') || id.includes('\\')) return false;
  return true;
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function uniqueArchiveDir(baseArchiveDir, id) {
  const safe = String(id || '').replace(/[^A-Za-z0-9_.-]/g, '_');
  const first = path.join(baseArchiveDir, safe);
  if (!fs.existsSync(first)) return first;
  for (let i = 2; i < 10000; i++) {
    const candidate = path.join(baseArchiveDir, `${safe}--archived-${i}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  throw new Error('Unable to allocate archive folder');
}

function safeResolveUnder(baseAbs, relPath) {
  if (typeof relPath !== 'string' || relPath.length === 0) throw new Error('path must be a non-empty string');
  if (path.isAbsolute(relPath)) throw new Error('path must be relative');
  const base = path.resolve(baseAbs);
  const abs = path.resolve(base, relPath);
  const prefix = base.endsWith(path.sep) ? base : base + path.sep;
  if (!abs.startsWith(prefix)) throw new Error('path escapes base');
  return abs;
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj, null, 2);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function sendText(res, code, text, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
  res.end(text || '');
}

async function readJsonBody(req, maxBytes = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > maxBytes) {
        reject(Object.assign(new Error('Request body too large'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(Object.assign(new Error('Invalid JSON body'), { statusCode: 400, cause: e }));
      }
    });
    req.on('error', reject);
  });
}

const OPEN_TERMINAL_ALLOWED_LAUNCHERS = new Set(['auto', 'pwsh', 'terminal', 'x-terminal-emulator']);
const OPEN_TERMINAL_ALLOWED_PROFILES = new Set(['default']);
const FINISH_PR_ACTIONS = new Set(['skip-pr', 'open-pr', 'open-pr:canceled']);
const SHELL_META_CHAR_RE = /[;&|`<>]/;
const SHELL_EXPANSION_RE = /(\$\(|\$\{|\$[A-Za-z_][A-Za-z0-9_]*|%[^%\r\n\s]+%|![^!\r\n\s]+!)/;
const SANDBOX_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,63}$/;
const BRANCH_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,127}$/;

function containsUnsafeShellSyntax(input) {
  const value = String(input || '');
  return SHELL_META_CHAR_RE.test(value) || SHELL_EXPANSION_RE.test(value);
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeKey(key) {
  return String(key || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function isForbiddenEnvKey(key) {
  const normalized = normalizeKey(key);
  return normalized === 'env'
    || normalized === 'environment'
    || normalized === 'processenv'
    || normalized === 'shellenv'
    || normalized === 'environmentvariables';
}

function findForbiddenEnvPath(value, prefix = '') {
  if (!isPlainObject(value)) return null;
  for (const [key, child] of Object.entries(value)) {
    const next = prefix ? `${prefix}.${key}` : key;
    if (isForbiddenEnvKey(key)) return next;
    const nested = findForbiddenEnvPath(child, next);
    if (nested) return nested;
  }
  return null;
}

function validateOpenTerminalLifecyclePayload(payload) {
  if (!isPlainObject(payload)) {
    return { ok: false, error: { code: 'invalid_lifecycle_payload', reason: 'payload_not_object' } };
  }

  const forbiddenEnvPath = findForbiddenEnvPath(payload);
  if (forbiddenEnvPath) {
    return { ok: false, error: { code: 'env_injection_denied', reason: `forbidden_field:${forbiddenEnvPath}` } };
  }

  for (const key of Object.keys(payload)) {
    if (key !== 'sandboxId' && key !== 'launcher' && key !== 'profile') {
      return { ok: false, error: { code: 'invalid_lifecycle_payload', reason: `unexpected_field:${key}` } };
    }
  }

  if (typeof payload.sandboxId !== 'string' || !payload.sandboxId.trim()) {
    return { ok: false, error: { code: 'invalid_lifecycle_payload', reason: 'missing_or_invalid_sandbox_id' } };
  }
  const sandboxId = payload.sandboxId.trim();
  if (containsUnsafeShellSyntax(sandboxId)) {
    return { ok: false, error: { code: 'invalid_lifecycle_payload', reason: 'unsafe_shell_syntax:sandboxId' } };
  }
  if (!SANDBOX_ID_RE.test(sandboxId)) {
    return { ok: false, error: { code: 'invalid_lifecycle_payload', reason: 'invalid_sandbox_id_format' } };
  }

  let launcher;
  if (payload.launcher !== undefined) {
    if (typeof payload.launcher !== 'string' || !payload.launcher.trim()) {
      return { ok: false, error: { code: 'invalid_lifecycle_payload', reason: 'invalid_launcher' } };
    }
    launcher = payload.launcher.trim();
    if (containsUnsafeShellSyntax(launcher)) {
      return { ok: false, error: { code: 'invalid_lifecycle_payload', reason: 'unsafe_shell_syntax:launcher' } };
    }
    if (!OPEN_TERMINAL_ALLOWED_LAUNCHERS.has(launcher)) {
      return { ok: false, error: { code: 'invalid_lifecycle_payload', reason: 'invalid_launcher' } };
    }
  }

  let profile;
  if (payload.profile !== undefined) {
    if (typeof payload.profile !== 'string' || !payload.profile.trim()) {
      return { ok: false, error: { code: 'invalid_lifecycle_payload', reason: 'invalid_profile' } };
    }
    profile = payload.profile.trim();
    if (containsUnsafeShellSyntax(profile)) {
      return { ok: false, error: { code: 'invalid_lifecycle_payload', reason: 'unsafe_shell_syntax:profile' } };
    }
    if (!OPEN_TERMINAL_ALLOWED_PROFILES.has(profile)) {
      return { ok: false, error: { code: 'invalid_lifecycle_payload', reason: 'invalid_profile' } };
    }
  }

  return {
    ok: true,
    value: {
      sandboxId,
      ...(launcher ? { launcher } : {}),
      ...(profile ? { profile } : {}),
    },
  };
}

function validateLifecycleBranchToken(value, fieldName) {
  if (typeof value !== 'string' || !value.trim()) {
    return {
      ok: false,
      error: {
        code: 'invalid_lifecycle_payload',
        reason: `missing_or_invalid_${fieldName}`,
      },
    };
  }

  const branch = value.trim();
  if (containsUnsafeShellSyntax(branch)) {
    return {
      ok: false,
      error: {
        code: 'invalid_lifecycle_payload',
        reason: `unsafe_shell_syntax:${fieldName}`,
      },
    };
  }

  if (!BRANCH_NAME_RE.test(branch)) {
    return {
      ok: false,
      error: {
        code: 'invalid_lifecycle_payload',
        reason: `invalid_${fieldName}_format`,
      },
    };
  }

  return {
    ok: true,
    value: branch,
  };
}

function validateFinishLifecyclePayload(payload) {
  if (!isPlainObject(payload)) {
    return { ok: false, error: { code: 'invalid_lifecycle_payload', reason: 'payload_not_object' } };
  }

  const forbiddenEnvPath = findForbiddenEnvPath(payload);
  if (forbiddenEnvPath) {
    return { ok: false, error: { code: 'env_injection_denied', reason: `forbidden_field:${forbiddenEnvPath}` } };
  }

  for (const key of Object.keys(payload)) {
    if (key !== 'sandboxId' && key !== 'prAction' && key !== 'baseBranch' && key !== 'headBranch') {
      return { ok: false, error: { code: 'invalid_lifecycle_payload', reason: `unexpected_field:${key}` } };
    }
  }

  if (typeof payload.sandboxId !== 'string' || !payload.sandboxId.trim()) {
    return { ok: false, error: { code: 'invalid_lifecycle_payload', reason: 'missing_or_invalid_sandbox_id' } };
  }

  const sandboxId = payload.sandboxId.trim();
  if (containsUnsafeShellSyntax(sandboxId)) {
    return { ok: false, error: { code: 'invalid_lifecycle_payload', reason: 'unsafe_shell_syntax:sandboxId' } };
  }
  if (!SANDBOX_ID_RE.test(sandboxId)) {
    return { ok: false, error: { code: 'invalid_lifecycle_payload', reason: 'invalid_sandbox_id_format' } };
  }

  const prActionToken = payload.prAction === undefined || payload.prAction === null
    ? 'skip-pr'
    : String(payload.prAction).trim();

  if (!FINISH_PR_ACTIONS.has(prActionToken)) {
    return { ok: false, error: { code: 'invalid_lifecycle_payload', reason: 'invalid_finish_pr_action' } };
  }

  if (prActionToken !== 'open-pr' && (payload.baseBranch !== undefined || payload.headBranch !== undefined)) {
    return { ok: false, error: { code: 'invalid_lifecycle_payload', reason: 'pr_branches_require_open_pr_action' } };
  }

  if (prActionToken === 'open-pr') {
    const baseBranch = validateLifecycleBranchToken(payload.baseBranch, 'baseBranch');
    if (!baseBranch.ok) return baseBranch;

    const headBranch = validateLifecycleBranchToken(payload.headBranch, 'headBranch');
    if (!headBranch.ok) return headBranch;

    return {
      ok: true,
      value: {
        sandboxId,
        prAction: prActionToken,
        baseBranch: baseBranch.value,
        headBranch: headBranch.value,
      },
    };
  }

  return {
    ok: true,
    value: {
      sandboxId,
      prAction: prActionToken,
    },
  };
}

function collectFinishResponseSandboxObservations(body) {
  if (!isPlainObject(body)) return [];

  const observations = [];
  const seen = new Set();

  const appendObservation = (pathToken, value) => {
    if (typeof value !== 'string') return;
    const sandboxId = value.trim();
    if (!sandboxId) return;
    const dedupeKey = `${pathToken}:${sandboxId}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    observations.push({ path: pathToken, sandboxId });
  };

  appendObservation('sandboxId', body.sandboxId);

  const result = isPlainObject(body.result) ? body.result : null;
  if (result) {
    appendObservation('result.sandboxId', result.sandboxId);
    const close = isPlainObject(result.close) ? result.close : null;
    const closeResult = close && isPlainObject(close.result) ? close.result : null;
    if (closeResult) {
      appendObservation('result.close.result.sandboxId', closeResult.sandboxId);
    }
  }

  const close = isPlainObject(body.close) ? body.close : null;
  const closeResult = close && isPlainObject(close.result) ? close.result : null;
  if (closeResult) {
    appendObservation('close.result.sandboxId', closeResult.sandboxId);
  }

  return observations;
}

function buildLifecycleInvariantViolationBody({ expectedSandboxId, observed, prAction, providerState }) {
  const migration = providerState && isPlainObject(providerState.migration)
    ? providerState.migration
    : {};
  const migrationReasonCodes = normalizeDeterministicReasonCodes(
    Array.isArray(migration.reasonCodes) ? migration.reasonCodes : []
  );
  const reasonCodes = normalizeDeterministicReasonCodes([
    'canonical_sandbox_id_mismatch',
    'canonical_sandbox_id_persisted_invariant',
    prAction === 'open-pr' ? 'finish_pr_open_path' : 'finish_pr_skip_path',
    migration.required ? 'provider_state_migration_present' : '',
    ...migrationReasonCodes,
  ]);

  return {
    error: 'Lifecycle canonical sandboxId invariant violated',
    code: 'canonical_sandbox_id_invariant_violation',
    action: 'finish',
    reason: 'canonical_sandbox_id_mismatch',
    deterministic: true,
    invariant: {
      marker: 'conflict',
      scope: 'cross_ws_canonical_id',
      expectedSandboxId,
      receivedSandboxId: observed.sandboxId,
      receivedPath: observed.path,
      reasonCodes,
      providerState: {
        selectedProvider: providerState && typeof providerState.selectedProvider === 'string'
          ? providerState.selectedProvider
          : null,
        defaultProvider: providerState && typeof providerState.defaultProvider === 'string'
          ? providerState.defaultProvider
          : null,
        migration: {
          required: Boolean(migration.required),
          reasonCodes: migrationReasonCodes,
        },
      },
    },
  };
}

function validateFinishCanonicalSandboxIdInvariant({ canonicalSandboxId, prAction, trackerBody, providerState }) {
  if (typeof canonicalSandboxId !== 'string' || !canonicalSandboxId.trim()) {
    return {
      ok: false,
      statusCode: 409,
      body: {
        error: 'Lifecycle canonical sandboxId invariant violated',
        code: 'canonical_sandbox_id_invariant_violation',
        action: 'finish',
        reason: 'missing_canonical_sandbox_id',
        deterministic: true,
        invariant: {
          marker: 'conflict',
          scope: 'cross_ws_canonical_id',
          expectedSandboxId: null,
          receivedSandboxId: null,
          receivedPath: null,
          reasonCodes: ['missing_canonical_sandbox_id'],
        },
      },
    };
  }

  const expectedSandboxId = canonicalSandboxId.trim();
  const observations = collectFinishResponseSandboxObservations(trackerBody);
  for (const observation of observations) {
    if (observation.sandboxId !== expectedSandboxId) {
      return {
        ok: false,
        statusCode: 409,
        body: buildLifecycleInvariantViolationBody({
          expectedSandboxId,
          observed: observation,
          prAction,
          providerState,
        }),
      };
    }
  }

  return { ok: true };
}

function normalizeScopeList(scopes) {
  if (!Array.isArray(scopes)) return [];
  const out = [];
  const seen = new Set();
  for (const scope of scopes) {
    const normalized = planState.normalizePlanningScope(scope);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function normalizeIdentity(value) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  return normalized ? normalized.toLowerCase() : '';
}

function canReadPlanningRecord(record, context = {}) {
  if (!record || typeof record !== 'object') return false;

  const scope = planState.normalizePlanningScope(record);
  const userId = normalizeIdentity(context.userId);
  const repoId = normalizeIdentity(context.repoId);

  if (!scope || !userId) return false;

  const ownerId = normalizeIdentity(record.ownerId);
  const recordRepoId = normalizeIdentity(record.repoId);

  if (scope === 'repo') {
    return Boolean(ownerId && recordRepoId && ownerId === userId && repoId && recordRepoId === repoId);
  }

  if (scope === 'global' || scope === 'user') {
    return Boolean(ownerId && ownerId === userId);
  }

  return false;
}

function canWritePlanningRecord(record, context = {}) {
  return canReadPlanningRecord(record, context);
}

function filterPlanningRecordsForCompare(records, context = {}) {
  const requestedScopes = normalizeScopeList(context.requestedScopes);
  const result = { records: [], deniedScopes: [] };

  if (!requestedScopes.length) {
    return result;
  }

  const userId = normalizeIdentity(context.userId);
  const repoId = normalizeIdentity(context.repoId);

  const allowedScopes = new Set();
  for (const scope of requestedScopes) {
    if (!userId) {
      result.deniedScopes.push(scope);
      continue;
    }
    if (scope === 'repo') {
      if (!repoId) {
        result.deniedScopes.push(scope);
        continue;
      }
      allowedScopes.add(scope);
      continue;
    }
    if (scope === 'global' || scope === 'user') {
      allowedScopes.add(scope);
      continue;
    }
    result.deniedScopes.push(scope);
  }

  if (!Array.isArray(records) || !records.length) {
    result.deniedScopes = [...new Set(result.deniedScopes)].sort();
    return result;
  }

  for (const record of records) {
    const scope = planState.normalizePlanningScope(record);
    if (!scope || !allowedScopes.has(scope)) continue;
    if (canReadPlanningRecord(record, context)) {
      result.records.push(record);
    }
  }

  result.deniedScopes = [...new Set(result.deniedScopes)].sort();
  return result;
}

function firstStringValue(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (typeof entry === 'string' && entry.trim()) {
          return entry.trim();
        }
      }
    }
  }
  return '';
}

function parsePlanningScopesFromRequest(u, body = null) {
  if (body && Array.isArray(body.scopes)) {
    return body.scopes;
  }

  const scopesParam = u.searchParams.get('scopes');
  if (typeof scopesParam === 'string' && scopesParam.trim()) {
    return scopesParam.split(',').map((scope) => scope.trim()).filter(Boolean);
  }

  const repeated = u.searchParams.getAll('scope');
  if (repeated && repeated.length) {
    return repeated;
  }

  return [];
}

function buildPlanningRequestContext(req, u, body = null, authContext = {}) {
  const userId = normalizeIdentity(authContext.userId);
  const repoId = normalizeIdentity(firstStringValue(
    body && body.repoId,
    req.headers['x-planning-repo-id'],
    u.searchParams.get('repoId'),
  ));

  return { userId, repoId };
}

function resolveRequestIdempotencyKey(req, body = null) {
  return firstStringValue(
    body && body.idempotencyKey,
    req.headers['idempotency-key'],
  );
}

function resolvePlanningPersistenceAuthorityState(planningPersistenceConfig, planningPersistenceState) {
  const state = planningPersistenceState && typeof planningPersistenceState === 'object'
    ? planningPersistenceState
    : {};
  const validation = state.validation || validatePlanningPersistenceConfig(planningPersistenceConfig || {});
  const client = state.client && typeof state.client.query === 'function'
    ? state.client
    : null;

  const persistedAuthority = Boolean(validation.usable);
  const ready = persistedAuthority && Boolean(client) && String(state.status || '') === 'ready';

  return {
    persistedAuthority,
    ready,
    client,
    status: String(state.status || ''),
    validation,
    lastError: String(state.lastError || '').trim() || null,
  };
}

function buildPlanningPersistenceFailure(pathname, method, input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const reason = String(source.reason || '').trim() || 'planning_persistence_unavailable';
  const code = String(source.code || '').trim() || 'planning_persistence_unavailable';
  const statusCode = Number.isFinite(source.statusCode) ? Number(source.statusCode) : 503;

  return {
    statusCode,
    body: {
      contractVersion: PLANNING_API_CONTRACT_VERSION,
      kind: resolvePlanningDurabilityGateKind(pathname, method),
      deterministic: true,
      error: String(source.error || 'Planning persistence unavailable'),
      code,
      reason,
      planningPersistence: {
        authority: 'db',
        configured: Boolean(source.configured),
        usable: Boolean(source.usable),
        required: Boolean(source.required),
        ready: Boolean(source.ready),
        status: String(source.status || '').trim() || null,
      },
    },
  };
}

async function hydratePlanningProjectionFromPersistence(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const authority = resolvePlanningPersistenceAuthorityState(
    source.planningPersistenceConfig,
    source.planningPersistenceState,
  );

  if (!authority.persistedAuthority) {
    return {
      ok: true,
      persistedAuthority: false,
      ready: false,
      client: null,
    };
  }

  if (!authority.ready) {
    return {
      ok: false,
      failure: buildPlanningPersistenceFailure(source.pathname, source.method, {
        statusCode: 503,
        code: 'planning_persistence_unavailable',
        error: 'Planning persistence unavailable',
        reason: authority.lastError || 'planning_persistence_not_ready',
        configured: authority.validation.configured,
        usable: authority.validation.usable,
        required: authority.validation.required,
        ready: authority.ready,
        status: authority.status,
      }),
    };
  }

  const context = source.context && typeof source.context === 'object' ? source.context : {};
  if (!normalizeIdentity(context.userId)) {
    return {
      ok: true,
      persistedAuthority: true,
      ready: true,
      client: authority.client,
    };
  }

  try {
    const projection = await listPersistedPlanningRecords(authority.client, {
      actorId: context.userId,
      repoId: context.repoId,
      scopes: source.scopes,
    });

    if (!projection.ok) {
      const reason = projection.error && projection.error.reason
        ? projection.error.reason
        : 'planning_persistence_read_denied';
      const code = projection.error && projection.error.code
        ? projection.error.code
        : 'planning_persistence_read_failed';

      return {
        ok: false,
        failure: buildPlanningPersistenceFailure(source.pathname, source.method, {
          statusCode: code === 'scope_visibility_denied' ? 403 : 503,
          code,
          error: 'Planning persistence read failed',
          reason,
          configured: authority.validation.configured,
          usable: authority.validation.usable,
          required: authority.validation.required,
          ready: authority.ready,
          status: authority.status,
        }),
      };
    }

    replacePlanningProjectionFromPersistedRecords(source.planningApiState, {
      records: projection.records,
      nextRecordNumber: deriveNextPlanningRecordNumber(projection.records),
    });

    return {
      ok: true,
      persistedAuthority: true,
      ready: true,
      client: authority.client,
      projection,
    };
  } catch (error) {
    return {
      ok: false,
      failure: buildPlanningPersistenceFailure(source.pathname, source.method, {
        statusCode: 503,
        code: 'planning_persistence_read_failed',
        error: 'Planning persistence read failed',
        reason: 'planning_persistence_read_failed',
        configured: authority.validation.configured,
        usable: authority.validation.usable,
        required: authority.validation.required,
        ready: authority.ready,
        status: authority.status,
        detail: String(error && error.message ? error.message : error),
      }),
    };
  }
}

async function persistPlanningRecordToAuthority(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const authority = resolvePlanningPersistenceAuthorityState(
    source.planningPersistenceConfig,
    source.planningPersistenceState,
  );

  if (!authority.persistedAuthority) {
    return {
      ok: true,
      persistedAuthority: false,
      record: source.record,
    };
  }

  if (!authority.ready) {
    return {
      ok: false,
      failure: buildPlanningPersistenceFailure(source.pathname, source.method, {
        statusCode: 503,
        code: 'planning_persistence_unavailable',
        error: 'Planning persistence unavailable',
        reason: authority.lastError || 'planning_persistence_not_ready',
        configured: authority.validation.configured,
        usable: authority.validation.usable,
        required: authority.validation.required,
        ready: authority.ready,
        status: authority.status,
      }),
    };
  }

  try {
    const persisted = await persistPlanningRecord(authority.client, {
      actorId: source.context && source.context.userId,
      record: source.record,
    });

    if (!persisted.ok) {
      const reason = persisted.error && persisted.error.reason
        ? persisted.error.reason
        : 'planning_persistence_write_failed';
      const code = persisted.error && persisted.error.code
        ? persisted.error.code
        : 'planning_persistence_write_failed';

      return {
        ok: false,
        failure: buildPlanningPersistenceFailure(source.pathname, source.method, {
          statusCode: code === 'scope_visibility_denied' ? 403 : 503,
          code,
          error: 'Planning persistence write failed',
          reason,
          configured: authority.validation.configured,
          usable: authority.validation.usable,
          required: authority.validation.required,
          ready: authority.ready,
          status: authority.status,
        }),
      };
    }

    return {
      ok: true,
      persistedAuthority: true,
      record: persisted.record || source.record,
    };
  } catch {
    return {
      ok: false,
      failure: buildPlanningPersistenceFailure(source.pathname, source.method, {
        statusCode: 503,
        code: 'planning_persistence_write_failed',
        error: 'Planning persistence write failed',
        reason: 'planning_persistence_write_failed',
        configured: authority.validation.configured,
        usable: authority.validation.usable,
        required: authority.validation.required,
        ready: authority.ready,
        status: authority.status,
      }),
    };
  }
}

function parseDeterministicBooleanFlag(input) {
  if (typeof input !== 'string') return null;
  const value = input.trim().toLowerCase();
  if (!value) return null;
  if (value === '1' || value === 'true' || value === 'yes' || value === 'on') return true;
  if (value === '0' || value === 'false' || value === 'no' || value === 'off') return false;
  return null;
}

const PLANNING_MERGE_MAX_TOKEN_TTL_MS = 15 * 60 * 1000;
const PLANNING_MERGE_DEFAULT_TOKEN_TTL_MS = 5 * 60 * 1000;
const PLANNING_COMPARE_RECEIPT_TTL_MS = 10 * 60 * 1000;
const PLANNING_MERGE_IDEMPOTENCY_TTL_MS = 60 * 60 * 1000;
const PLANNING_MERGE_STATE_MAX_ITEMS = 5000;

function stableNormalizeValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => stableNormalizeValue(entry));
  }
  if (value && typeof value === 'object') {
    const out = {};
    const keys = Object.keys(value).sort((a, b) => a.localeCompare(b));
    for (const key of keys) {
      out[key] = stableNormalizeValue(value[key]);
    }
    return out;
  }
  return value;
}

function stableHashValue(value) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(stableNormalizeValue(value)), 'utf8')
    .digest('hex');
}

function legacyStableHash(value) {
  const normalized = JSON.stringify(stableNormalizeValue(value));
  let hash = 0;
  for (let i = 0; i < normalized.length; i += 1) {
    hash = ((hash << 5) - hash) + normalized.charCodeAt(i);
    hash |= 0;
  }
  return `h${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function cloneJsonValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizePlanningVersionVectorHash(versionVector) {
  return stableHashValue(versionVector || null);
}

function buildPlanningCompareSnapshotHash(compareBody = {}) {
  return legacyStableHash({
    requestedScopes: Array.isArray(compareBody.requestedScopes) ? compareBody.requestedScopes : [],
    deniedScopes: Array.isArray(compareBody.deniedScopes) ? compareBody.deniedScopes : [],
    pinnedVersion: compareBody.versionVector && compareBody.versionVector.pinned
      ? compareBody.versionVector.pinned
      : null,
    matchIds: Array.isArray(compareBody.matches)
      ? compareBody.matches.map((entry) => String((entry && entry.recordId) || ''))
      : [],
  });
}

function buildPlanningSourceIdsHash(sourceIds = []) {
  const normalized = [...new Set((Array.isArray(sourceIds) ? sourceIds : [])
    .map((id) => String(id || '').trim())
    .filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
  return legacyStableHash(normalized);
}

function normalizeDeterministicReasonCodes(values) {
  const list = Array.isArray(values) ? values : [];
  const normalized = [];
  for (const value of list) {
    const reason = String(value || '').trim();
    if (!reason) continue;
    normalized.push(reason);
  }
  return [...new Set(normalized)].sort((a, b) => a.localeCompare(b));
}

function evaluatePlanningDurabilityDependencyGate(input = {}) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const env = source.env && typeof source.env === 'object' ? source.env : process.env;
  const reasonCodes = [];

  if (parseDeterministicBooleanFlag(env.INSTRUCTION_ENGINE_FORCE_WS3_AUTHORITY_GATE_BLOCKED) === true) {
    reasonCodes.push('ws3_authority_gate_forced_blocked');
  }

  const sessionReconciliationContractVersion = String(SESSION_RECONCILIATION_CONTRACT_VERSION || '').trim();
  if (!sessionReconciliationContractVersion) {
    reasonCodes.push('ws3_reconciliation_contract_version_missing');
  }

  const planningPrecedenceContractVersion = String(planState.PLANNING_PRECEDENCE_CONTRACT_VERSION || '').trim();
  if (!planningPrecedenceContractVersion) {
    reasonCodes.push('ws3_planning_precedence_contract_version_missing');
  }

  const requiredAuthorities = [
    String(SESSION_STATE_AUTHORITIES.RUNTIME || '').trim(),
    String(SESSION_STATE_AUTHORITIES.RUNTIME_ONLY || '').trim(),
    String(SESSION_STATE_AUTHORITIES.ARTIFACT || '').trim(),
  ].filter(Boolean);
  const availableAuthorities = new Set(
    Object.values(SESSION_STATE_AUTHORITIES || {})
      .map((value) => String(value || '').trim())
      .filter(Boolean),
  );

  if (!availableAuthorities.has(SESSION_STATE_AUTHORITIES.RUNTIME)) {
    reasonCodes.push('ws3_authority_acp_missing');
  }
  if (!availableAuthorities.has(SESSION_STATE_AUTHORITIES.RUNTIME_ONLY)) {
    reasonCodes.push('ws3_authority_acp_only_missing');
  }
  if (!availableAuthorities.has(SESSION_STATE_AUTHORITIES.ARTIFACT)) {
    reasonCodes.push('ws3_authority_fs_missing');
  }

  const runtimeSourcePrecedence = Number(
    SESSION_RECONCILIATION_SOURCE_PRECEDENCE[SESSION_RECONCILIATION_SOURCES.RUNTIME] || 0,
  );
  const artifactSourcePrecedence = Number(
    SESSION_RECONCILIATION_SOURCE_PRECEDENCE[SESSION_RECONCILIATION_SOURCES.ARTIFACT] || 0,
  );

  if (!(runtimeSourcePrecedence > artifactSourcePrecedence)) {
    reasonCodes.push('ws3_source_precedence_not_runtime_over_artifact');
  }

  if (
    SESSION_RECONCILIATION_SOURCE_OF_TRUTH[SESSION_STATE_AUTHORITIES.RUNTIME]
    !== SESSION_RECONCILIATION_SOURCES.RUNTIME
  ) {
    reasonCodes.push('ws3_source_of_truth_runtime_mismatch');
  }
  if (
    SESSION_RECONCILIATION_SOURCE_OF_TRUTH[SESSION_STATE_AUTHORITIES.RUNTIME_ONLY]
    !== SESSION_RECONCILIATION_SOURCES.RUNTIME
  ) {
    reasonCodes.push('ws3_source_of_truth_runtime_only_mismatch');
  }
  if (
    SESSION_RECONCILIATION_SOURCE_OF_TRUTH[SESSION_STATE_AUTHORITIES.ARTIFACT]
    !== SESSION_RECONCILIATION_SOURCES.ARTIFACT
  ) {
    reasonCodes.push('ws3_source_of_truth_artifact_mismatch');
  }

  const userScopePrecedence = Number(planState.PLANNING_SCOPE_PRECEDENCE.user || 0);
  const repoScopePrecedence = Number(planState.PLANNING_SCOPE_PRECEDENCE.repo || 0);
  const globalScopePrecedence = Number(planState.PLANNING_SCOPE_PRECEDENCE.global || 0);
  if (!(userScopePrecedence > repoScopePrecedence && repoScopePrecedence > globalScopePrecedence)) {
    reasonCodes.push('ws3_scope_precedence_invalid');
  }

  const normalizedReasonCodes = normalizeDeterministicReasonCodes(reasonCodes);
  const ready = normalizedReasonCodes.length === 0;

  return {
    contractVersion: WS3_AUTHORITY_DEPENDENCY_GATE_CONTRACT_VERSION,
    dependency: WS3_AUTHORITY_DEPENDENCY_NAME,
    deterministic: true,
    required: true,
    ready,
    marker: ready ? 'ready' : 'dependency-blocked',
    reason: ready ? 'ws3_authority_contract_ready' : normalizedReasonCodes[0],
    reasonCodes: ready ? ['ws3_authority_contract_ready'] : normalizedReasonCodes,
    ws3: {
      sessionReconciliationContractVersion: sessionReconciliationContractVersion || null,
      planningPrecedenceContractVersion: planningPrecedenceContractVersion || null,
      authorities: requiredAuthorities,
      sourcePrecedence: {
        runtime: runtimeSourcePrecedence,
        artifact: artifactSourcePrecedence,
      },
      sourceOfTruth: {
        runtime: SESSION_RECONCILIATION_SOURCE_OF_TRUTH[SESSION_STATE_AUTHORITIES.RUNTIME] || null,
        runtimeOnly: SESSION_RECONCILIATION_SOURCE_OF_TRUTH[SESSION_STATE_AUTHORITIES.RUNTIME_ONLY] || null,
        artifact: SESSION_RECONCILIATION_SOURCE_OF_TRUTH[SESSION_STATE_AUTHORITIES.ARTIFACT] || null,
      },
      planningScopePrecedence: {
        user: userScopePrecedence,
        repo: repoScopePrecedence,
        global: globalScopePrecedence,
      },
    },
  };
}

function isPlanningDurabilityRoute(pathname) {
  const route = String(pathname || '').trim();
  return (
    route === '/api/planning/records'
    || route === '/api/planning/search'
    || route === '/api/planning/compare'
    || route === '/api/planning/merge-intent'
    || route === '/api/planning/merge'
  );
}

function resolvePlanningDurabilityGateKind(pathname, method) {
  const route = String(pathname || '').trim();
  const normalizedMethod = String(method || 'GET').trim().toUpperCase();

  if (route === '/api/planning/records') {
    return normalizedMethod === 'POST' ? 'planning.create' : 'planning.list';
  }
  if (route === '/api/planning/search') {
    return 'planning.search';
  }
  if (route === '/api/planning/compare') {
    return 'planning.compare';
  }
  if (route === '/api/planning/merge-intent') {
    return 'planning.merge-intent';
  }
  if (route === '/api/planning/merge') {
    return 'planning.merge';
  }

  return 'planning.unknown';
}

function buildPlanningDurabilityDependencyGateFailure(pathname, method, gateState) {
  const gate = gateState && typeof gateState === 'object' ? gateState : {};
  const reason = String(gate.reason || '').trim() || 'ws3_authority_contract_not_ready';

  return {
    statusCode: 503,
    body: {
      contractVersion: PLANNING_API_CONTRACT_VERSION,
      kind: resolvePlanningDurabilityGateKind(pathname, method),
      deterministic: true,
      error: 'Planning durability dependency gate blocked',
      code: WS3_AUTHORITY_DEPENDENCY_BLOCK_CODE,
      reason,
      dependencyGate: {
        marker: 'dependency-blocked',
        dependency: String(gate.dependency || WS3_AUTHORITY_DEPENDENCY_NAME),
        required: true,
        ready: false,
        contractVersion: String(gate.contractVersion || WS3_AUTHORITY_DEPENDENCY_GATE_CONTRACT_VERSION),
        reasonCodes: normalizeDeterministicReasonCodes(gate.reasonCodes && gate.reasonCodes.length
          ? gate.reasonCodes
          : [reason]),
        ws3: gate.ws3 || null,
      },
    },
  };
}

function normalizePlanningDowngradeMarker(input = {}, fallbackMarker = 'conflict') {
  const marker = input && typeof input === 'object' ? input : {};
  const markerToken = String(marker.marker || fallbackMarker).trim().toLowerCase();
  const normalizedMarker = markerToken === 'stale'
    ? 'stale'
    : markerToken === 'conflict'
      ? 'conflict'
      : fallbackMarker;

  const statusToken = String(marker.status || (normalizedMarker === 'stale' ? 'stale' : 'invalid')).trim().toLowerCase();
  const status = statusToken || (normalizedMarker === 'stale' ? 'stale' : 'invalid');
  const reason = String(
    marker.reason
    || marker.reasonCode
    || (normalizedMarker === 'stale' ? 'source_stale' : 'source_conflict')
  ).trim() || (normalizedMarker === 'stale' ? 'source_stale' : 'source_conflict');

  return {
    sourceId: String(marker.sourceId || '').trim() || null,
    sourceType: String(marker.sourceType || '').trim() || null,
    path: String(marker.path || '').trim() || null,
    scope: String(marker.scope || '').trim() || null,
    status,
    reason,
    marker: normalizedMarker,
  };
}

function sortPlanningDowngradeMarkers(markers) {
  return markers.sort((a, b) => {
    const sourceDiff = String(a.sourceId || '').localeCompare(String(b.sourceId || ''));
    if (sourceDiff !== 0) return sourceDiff;
    const scopeDiff = String(a.scope || '').localeCompare(String(b.scope || ''));
    if (scopeDiff !== 0) return scopeDiff;
    return String(a.reason || '').localeCompare(String(b.reason || ''));
  });
}

function dedupePlanningDowngradeMarkers(markers) {
  const deduped = new Map();
  for (const marker of markers) {
    const normalized = normalizePlanningDowngradeMarker(marker, marker && marker.marker === 'stale' ? 'stale' : 'conflict');
    const key = [
      String(normalized.marker || ''),
      String(normalized.sourceId || ''),
      String(normalized.scope || ''),
      String(normalized.reason || ''),
      String(normalized.status || ''),
    ].join('|');
    if (!deduped.has(key)) {
      deduped.set(key, normalized);
    }
  }
  return sortPlanningDowngradeMarkers(Array.from(deduped.values()));
}

function derivePlanningDowngradeMarkers(compareBody = {}) {
  const implementedOutcomes = compareBody && typeof compareBody.implementedOutcomes === 'object'
    ? compareBody.implementedOutcomes
    : {};
  const sourceMarkers = Array.isArray(implementedOutcomes.sources)
    ? implementedOutcomes.sources
    : [];

  let staleMarkers = Array.isArray(implementedOutcomes.staleMarkers)
    ? implementedOutcomes.staleMarkers.map((marker) => normalizePlanningDowngradeMarker(marker, 'stale'))
    : [];
  let conflictMarkers = Array.isArray(implementedOutcomes.conflictMarkers)
    ? implementedOutcomes.conflictMarkers.map((marker) => normalizePlanningDowngradeMarker(marker, 'conflict'))
    : [];

  const deriveStaleFromSources = staleMarkers.length === 0;
  const deriveConflictFromSources = conflictMarkers.length === 0;

  if (deriveStaleFromSources || deriveConflictFromSources) {
    for (const marker of sourceMarkers) {
      const normalized = normalizePlanningDowngradeMarker(marker, 'conflict');
      if (deriveStaleFromSources && normalized.status === 'stale') {
        staleMarkers.push({ ...normalized, marker: 'stale' });
      }
      if (deriveConflictFromSources && (normalized.status === 'invalid' || normalized.status === 'unavailable')) {
        conflictMarkers.push({ ...normalized, marker: 'conflict' });
      }
    }
  }

  if (compareBody.newerDataAvailable === true) {
    staleMarkers.push(normalizePlanningDowngradeMarker({
      sourceId: 'version-vector',
      sourceType: 'version-vector',
      status: 'stale',
      reason: 'newer_data_available',
      marker: 'stale',
    }, 'stale'));
  }

  const deniedScopes = [...new Set((Array.isArray(compareBody.deniedScopes) ? compareBody.deniedScopes : [])
    .map((scope) => String(scope || '').trim().toLowerCase())
    .filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));

  for (const scope of deniedScopes) {
    conflictMarkers.push(normalizePlanningDowngradeMarker({
      sourceId: `scope:${scope}`,
      sourceType: 'scope',
      scope,
      status: 'invalid',
      reason: 'denied_scope_present',
      marker: 'conflict',
    }, 'conflict'));
  }

  staleMarkers = dedupePlanningDowngradeMarkers(staleMarkers);
  conflictMarkers = dedupePlanningDowngradeMarkers(conflictMarkers);

  const reasonCodes = normalizeDeterministicReasonCodes([
    ...staleMarkers.map((marker) => marker.reason),
    ...conflictMarkers.map((marker) => marker.reason),
    ...(Array.isArray(implementedOutcomes.reasonCodes) ? implementedOutcomes.reasonCodes : []),
  ]);

  return {
    deterministic: true,
    staleMarkers,
    conflictMarkers,
    reasonCodes,
    hasStaleMarkers: staleMarkers.length > 0,
    hasConflictMarkers: conflictMarkers.length > 0,
  };
}

function evaluatePlanningMergeGateState(compareBody = {}) {
  const deniedScopes = Array.isArray(compareBody.deniedScopes) ? compareBody.deniedScopes : [];
  const matches = Array.isArray(compareBody.matches) ? compareBody.matches : [];
  const downgradeBase = derivePlanningDowngradeMarkers(compareBody);
  const conditionReasonCodes = normalizeDeterministicReasonCodes([
    deniedScopes.length ? 'denied_scopes_present' : '',
    !matches.length ? 'no_compare_matches' : '',
    compareBody.newerDataAvailable === true ? 'newer_data_available' : '',
    downgradeBase.hasConflictMarkers ? 'implemented_source_conflict' : '',
    downgradeBase.hasStaleMarkers ? 'implemented_source_stale' : '',
  ]);

  function buildDowngrade(primaryReason, downgraded) {
    const reasonCodes = normalizeDeterministicReasonCodes([
      ...downgradeBase.reasonCodes,
      ...conditionReasonCodes,
      primaryReason,
    ]);

    return {
      ...downgradeBase,
      primaryReason,
      downgraded,
      reasonCodes,
    };
  }

  if (deniedScopes.length) {
    return {
      gateState: 'auth-denied',
      mergeEligible: false,
      reason: 'denied_scopes_present',
      downgrade: buildDowngrade('denied_scopes_present', true),
    };
  }
  if (!matches.length) {
    return {
      gateState: 'insufficient-data',
      mergeEligible: false,
      reason: 'no_compare_matches',
      downgrade: buildDowngrade('no_compare_matches', true),
    };
  }
  if (compareBody.newerDataAvailable === true) {
    return {
      gateState: 'degraded',
      mergeEligible: false,
      reason: 'newer_data_available',
      downgrade: buildDowngrade('newer_data_available', true),
    };
  }
  if (downgradeBase.hasConflictMarkers || downgradeBase.hasStaleMarkers) {
    return {
      gateState: 'degraded',
      mergeEligible: false,
      reason: 'implemented_source_not_available',
      downgrade: buildDowngrade('implemented_source_not_available', true),
    };
  }
  return {
    gateState: 'pass',
    mergeEligible: true,
    reason: 'gate_pass',
    downgrade: buildDowngrade('gate_pass', false),
  };
}

function ensurePlanningMergeState(planningApiState) {
  const state = planningApiState && typeof planningApiState === 'object'
    ? planningApiState
    : {};

  if (!(state.mergeIntentTokens instanceof Map)) {
    state.mergeIntentTokens = new Map();
  }
  if (!(state.mergeIdempotencyRecords instanceof Map)) {
    state.mergeIdempotencyRecords = new Map();
  }
  if (!(state.compareReceipts instanceof Map)) {
    state.compareReceipts = new Map();
  }

  return state;
}

function trimMapToSize(map, maxSize) {
  if (!(map instanceof Map)) return;
  while (map.size > maxSize) {
    const first = map.keys().next();
    if (first.done) break;
    map.delete(first.value);
  }
}

function reapPlanningMergeState(planningApiState, nowMs = Date.now()) {
  const state = ensurePlanningMergeState(planningApiState);
  const now = Number.isFinite(nowMs) ? Number(nowMs) : Date.now();

  for (const [receiptId, receipt] of state.compareReceipts.entries()) {
    const expiresAtMs = parseIsoMs(receipt && receipt.expiresAt);
    if (expiresAtMs != null && now > expiresAtMs) {
      state.compareReceipts.delete(receiptId);
    }
  }

  for (const [tokenId, token] of state.mergeIntentTokens.entries()) {
    const expiresAtMs = parseIsoMs(token && token.expiresAt);
    const consumedAtMs = parseIsoMs(token && token.consumedAt);
    const consumedExpired = consumedAtMs != null && now > (consumedAtMs + PLANNING_MERGE_IDEMPOTENCY_TTL_MS);
    if ((expiresAtMs != null && now > expiresAtMs) || consumedExpired) {
      state.mergeIntentTokens.delete(tokenId);
    }
  }

  for (const [idempotencyKey, record] of state.mergeIdempotencyRecords.entries()) {
    const expiresAtMs = Number.isFinite(record && record.expiresAtMs)
      ? Number(record.expiresAtMs)
      : null;
    if (expiresAtMs != null && now > expiresAtMs) {
      state.mergeIdempotencyRecords.delete(idempotencyKey);
    }
  }

  trimMapToSize(state.compareReceipts, PLANNING_MERGE_STATE_MAX_ITEMS);
  trimMapToSize(state.mergeIntentTokens, PLANNING_MERGE_STATE_MAX_ITEMS);
  trimMapToSize(state.mergeIdempotencyRecords, PLANNING_MERGE_STATE_MAX_ITEMS);

  return state;
}

function parseIsoMs(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeMergeIdList(sourceIds) {
  return [...new Set((Array.isArray(sourceIds) ? sourceIds : [])
    .map((entry) => String(entry || '').trim())
    .filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
}

function recordPlanningCompareReceipt(planningApiState, context, compareBody, nowMs) {
  const state = reapPlanningMergeState(planningApiState, nowMs);
  const actorId = normalizeIdentity(context && context.userId);
  const repoId = normalizeIdentity(context && context.repoId);
  const sourceIds = Array.isArray(compareBody && compareBody.planningRecords)
    ? compareBody.planningRecords.map((entry) => String((entry && entry.recordId) || '').trim()).filter(Boolean)
    : [];
  const gate = evaluatePlanningMergeGateState(compareBody);

  const receiptId = `compare-${nowMs}-${crypto.randomBytes(4).toString('hex')}`;
  const expiresAtMs = nowMs + PLANNING_COMPARE_RECEIPT_TTL_MS;
  const receipt = {
    receiptId,
    actorId,
    repoId,
    compareHash: buildPlanningCompareSnapshotHash(compareBody),
    sourceIdsHash: buildPlanningSourceIdsHash(sourceIds),
    sourceIds,
    versionVector: compareBody && compareBody.versionVector ? compareBody.versionVector.pinned || null : null,
    gateState: gate.gateState,
    mergeEligible: gate.mergeEligible,
    reason: gate.reason,
    downgrade: gate.downgrade,
    issuedAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(expiresAtMs).toISOString(),
  };

  state.compareReceipts.set(receiptId, receipt);
  return receipt;
}

function resolvePlanningCompareReceipt(planningApiState, receiptId, context, nowMs) {
  const state = reapPlanningMergeState(planningApiState, nowMs);
  const id = String(receiptId || '').trim();
  if (!id) {
    return { ok: false, error: { code: 'invalid_compare_receipt', reason: 'missing_compare_receipt_id' } };
  }

  const receipt = state.compareReceipts.get(id);
  if (!receipt) {
    return { ok: false, error: { code: 'invalid_compare_receipt', reason: 'compare_receipt_not_found' } };
  }

  if (Number(nowMs) > parseIsoMs(receipt.expiresAt)) {
    return { ok: false, error: { code: 'invalid_compare_receipt', reason: 'compare_receipt_expired' } };
  }

  const actorId = normalizeIdentity(context && context.userId);
  const repoId = normalizeIdentity(context && context.repoId);
  if (!actorId || actorId !== normalizeIdentity(receipt.actorId)) {
    return { ok: false, error: { code: 'invalid_compare_receipt', reason: 'compare_receipt_actor_mismatch' } };
  }

  const receiptRepoId = normalizeIdentity(receipt.repoId);
  if (receiptRepoId && receiptRepoId !== repoId) {
    return { ok: false, error: { code: 'invalid_compare_receipt', reason: 'compare_receipt_repo_mismatch' } };
  }

  return { ok: true, receipt };
}

function hashMergePayload(request) {
  const payload = {
    actorId: request && request.actorId ? String(request.actorId) : '',
    targetId: request && request.targetId ? String(request.targetId) : '',
    sourceIdsHash: request && request.sourceIdsHash ? String(request.sourceIdsHash) : '',
    compareHash: request && request.compareHash ? String(request.compareHash) : '',
    operationType: request && request.operationType ? String(request.operationType) : 'merge',
  };
  return crypto.createHash('sha256').update(JSON.stringify(payload), 'utf8').digest('hex');
}

function validatePlanningMergeConfirmationToken(token, context = {}) {
  if (!token || typeof token !== 'object') {
    return { ok: false, error: { code: 'invalid_confirmation_token', reason: 'token_not_object' } };
  }

  const requiredFields = ['tokenId', 'actorId', 'sourceIdsHash', 'targetId', 'compareHash', 'issuedAt', 'expiresAt'];
  for (const field of requiredFields) {
    if (typeof token[field] !== 'string' || !token[field].trim()) {
      return { ok: false, error: { code: 'invalid_confirmation_token', reason: `missing_or_invalid_${field}` } };
    }
  }

  const issuedAtMs = parseIsoMs(token.issuedAt);
  const expiresAtMs = parseIsoMs(token.expiresAt);
  if (issuedAtMs == null || expiresAtMs == null || expiresAtMs <= issuedAtMs) {
    return { ok: false, error: { code: 'invalid_confirmation_token', reason: 'invalid_token_time_window' } };
  }

  if (expiresAtMs - issuedAtMs > PLANNING_MERGE_MAX_TOKEN_TTL_MS) {
    return { ok: false, error: { code: 'invalid_confirmation_token', reason: 'token_ttl_exceeds_max' } };
  }

  const nowMs = Number.isFinite(context.nowMs) ? Number(context.nowMs) : Date.now();
  if (nowMs > expiresAtMs) {
    return { ok: false, error: { code: 'invalid_confirmation_token', reason: 'token_expired' } };
  }

  if (token.consumedAt != null) {
    return { ok: false, error: { code: 'invalid_confirmation_token', reason: 'token_consumed' } };
  }

  if (context.actorId && String(context.actorId) !== token.actorId) {
    return { ok: false, error: { code: 'invalid_confirmation_token', reason: 'actor_mismatch' } };
  }
  if (context.targetId && String(context.targetId) !== token.targetId) {
    return { ok: false, error: { code: 'invalid_confirmation_token', reason: 'target_mismatch' } };
  }
  if (context.compareHash && String(context.compareHash) !== token.compareHash) {
    return { ok: false, error: { code: 'invalid_confirmation_token', reason: 'compare_hash_mismatch' } };
  }

  return {
    ok: true,
    value: {
      tokenId: token.tokenId,
      actorId: token.actorId,
      sourceIdsHash: token.sourceIdsHash,
      targetId: token.targetId,
      compareHash: token.compareHash,
      issuedAt: token.issuedAt,
      expiresAt: token.expiresAt,
    },
  };
}

function validatePlanningMergeIdempotency(request, existingRecord = null) {
  if (!request || typeof request !== 'object') {
    return { ok: false, error: { code: 'invalid_idempotency', reason: 'request_not_object' } };
  }
  if (typeof request.idempotencyKey !== 'string' || !request.idempotencyKey.trim()) {
    return { ok: false, error: { code: 'invalid_idempotency', reason: 'missing_or_invalid_idempotency_key' } };
  }

  const payloadHash = hashMergePayload(request);
  const scopeKey = [
    String(request.actorId || ''),
    String(request.targetId || ''),
    String(request.sourceIdsHash || ''),
    String(request.operationType || 'merge'),
  ].join(':');

  if (!existingRecord) {
    return {
      ok: true,
      replay: false,
      scopeKey,
      payloadHash,
      idempotencyKey: request.idempotencyKey.trim(),
    };
  }

  if (String(existingRecord.idempotencyKey || '') !== request.idempotencyKey.trim()) {
    return {
      ok: true,
      replay: false,
      scopeKey,
      payloadHash,
      idempotencyKey: request.idempotencyKey.trim(),
    };
  }

  if (String(existingRecord.payloadHash || '') !== payloadHash) {
    return { ok: false, error: { code: 'idempotency_conflict', reason: 'idempotency_key_payload_mismatch' } };
  }

  return {
    ok: true,
    replay: true,
    scopeKey,
    payloadHash,
    idempotencyKey: request.idempotencyKey.trim(),
  };
}

function validatePlanningMergeAtomicEnvelope(envelope) {
  if (!envelope || typeof envelope !== 'object') {
    return { ok: false, error: { code: 'invalid_atomic_envelope', reason: 'envelope_not_object' } };
  }

  const required = ['targetUpdate', 'sourceTransitions', 'lineageLinks', 'auditEvent', 'tokenConsumedWrite'];
  for (const field of required) {
    if (envelope[field] == null) {
      return { ok: false, error: { code: 'invalid_atomic_envelope', reason: `missing_${field}` } };
    }
  }

  if (!Array.isArray(envelope.sourceTransitions) || envelope.sourceTransitions.length === 0) {
    return { ok: false, error: { code: 'invalid_atomic_envelope', reason: 'invalid_sourceTransitions' } };
  }

  if (!Array.isArray(envelope.lineageLinks) || envelope.lineageLinks.length === 0) {
    return { ok: false, error: { code: 'invalid_atomic_envelope', reason: 'invalid_lineageLinks' } };
  }

  return { ok: true };
}

function issuePlanningMergeIntent(planningApiState, input = {}) {
  const context = input.context && typeof input.context === 'object' ? input.context : {};
  const payload = input.payload && typeof input.payload === 'object' ? input.payload : {};
  const nowMs = Number.isFinite(input.nowMs) ? Number(input.nowMs) : Date.now();
  const state = reapPlanningMergeState(planningApiState, nowMs);

  const actorId = normalizeIdentity(context.userId || payload.actorId || payload.userId);
  const targetId = String(payload.targetId || '').trim();
  const compareReceiptId = String(payload.compareReceiptId || '').trim();

  if (!actorId) {
    return {
      statusCode: 403,
      body: {
        contractVersion: PLANNING_API_CONTRACT_VERSION,
        kind: 'planning.merge-intent',
        deterministic: true,
        error: { code: 'scope_visibility_denied', reason: 'missing_user_context' },
      },
    };
  }

  if (!targetId || !compareReceiptId) {
    return {
      statusCode: 400,
      body: {
        contractVersion: PLANNING_API_CONTRACT_VERSION,
        kind: 'planning.merge-intent',
        deterministic: true,
        error: { code: 'invalid_compare_receipt', reason: 'missing_merge_intent_fields' },
      },
    };
  }

  const receiptLookup = resolvePlanningCompareReceipt(state, compareReceiptId, context, nowMs);
  if (!receiptLookup.ok) {
    return {
      statusCode: 409,
      body: {
        contractVersion: PLANNING_API_CONTRACT_VERSION,
        kind: 'planning.merge-intent',
        deterministic: true,
        error: receiptLookup.error,
      },
    };
  }

  if (!receiptLookup.receipt.mergeEligible) {
    return {
      statusCode: 409,
      body: {
        contractVersion: PLANNING_API_CONTRACT_VERSION,
        kind: 'planning.merge-intent',
        deterministic: true,
        error: { code: 'merge_gate_blocked', reason: receiptLookup.receipt.reason || 'gate_not_pass' },
        gateState: receiptLookup.receipt.gateState,
        downgrade: receiptLookup.receipt.downgrade || null,
      },
    };
  }

  const sourceIds = normalizeMergeIdList(payload.sourceIds);
  const sourceIdsHash = buildPlanningSourceIdsHash(sourceIds);
  if (sourceIdsHash !== receiptLookup.receipt.sourceIdsHash) {
    return {
      statusCode: 409,
      body: {
        contractVersion: PLANNING_API_CONTRACT_VERSION,
        kind: 'planning.merge-intent',
        deterministic: true,
        error: { code: 'invalid_confirmation_token', reason: 'source_ids_hash_mismatch' },
      },
    };
  }

  const compareHash = receiptLookup.receipt.compareHash;

  const rawTtlMs = Number.isFinite(payload.ttlMs) ? Number(payload.ttlMs) : PLANNING_MERGE_DEFAULT_TOKEN_TTL_MS;
  const ttlMs = Math.max(1_000, Math.min(rawTtlMs, PLANNING_MERGE_MAX_TOKEN_TTL_MS));

  const issuedAt = new Date(nowMs).toISOString();
  const expiresAt = new Date(nowMs + ttlMs).toISOString();
  const tokenId = `intent-${nowMs}-${crypto.randomBytes(4).toString('hex')}`;

  const token = {
    tokenId,
    actorId,
    sourceIdsHash,
    targetId,
    compareHash,
    compareReceiptId,
    issuedAt,
    expiresAt,
    versionVector: receiptLookup.receipt.versionVector || null,
    versionVectorHash: normalizePlanningVersionVectorHash(receiptLookup.receipt.versionVector || null),
    consumedAt: null,
  };

  state.mergeIntentTokens.set(tokenId, token);

  return {
    statusCode: 200,
    body: {
      contractVersion: PLANNING_API_CONTRACT_VERSION,
      kind: 'planning.merge-intent',
      deterministic: true,
      intentToken: token,
      ttlMs,
    },
  };
}

function executePlanningMerge(planningApiState, input = {}) {
  const context = input.context && typeof input.context === 'object' ? input.context : {};
  const payload = input.payload && typeof input.payload === 'object' ? input.payload : {};
  const nowMs = Number.isFinite(input.nowMs) ? Number(input.nowMs) : Date.now();
  const state = reapPlanningMergeState(planningApiState, nowMs);

  const actorId = normalizeIdentity(context.userId || payload.actorId || payload.userId);
  const repoId = normalizeIdentity(context.repoId || payload.repoId);
  const tokenId = String(payload.tokenId || '').trim();
  const compareReceiptId = String(payload.compareReceiptId || '').trim();
  const targetId = String(payload.targetId || '').trim();
  const compareHash = String(payload.compareHash || '').trim();
  const sourceIdsHash = String(payload.sourceIdsHash || '').trim();

  if (!actorId) {
    return {
      statusCode: 403,
      body: {
        contractVersion: PLANNING_API_CONTRACT_VERSION,
        kind: 'planning.merge',
        deterministic: true,
        error: { code: 'scope_visibility_denied', reason: 'missing_user_context' },
      },
    };
  }

  if (!tokenId || !compareReceiptId || !targetId || !sourceIdsHash || !compareHash) {
    return {
      statusCode: 400,
      body: {
        contractVersion: PLANNING_API_CONTRACT_VERSION,
        kind: 'planning.merge',
        deterministic: true,
        error: { code: 'invalid_confirmation_token', reason: 'missing_merge_confirmation_fields' },
      },
    };
  }

  const idempotencyKey = String(payload.idempotencyKey || '').trim();
  const existingIdempotencyRecord = idempotencyKey
    ? state.mergeIdempotencyRecords.get(idempotencyKey) || null
    : null;

  const idempotencyValidation = validatePlanningMergeIdempotency({
    idempotencyKey,
    actorId,
    targetId,
    sourceIdsHash,
    compareHash,
    operationType: 'merge',
  }, existingIdempotencyRecord);

  if (!idempotencyValidation.ok) {
    const statusCode = idempotencyValidation.error && idempotencyValidation.error.code === 'invalid_idempotency'
      ? 400
      : 409;
    return {
      statusCode,
      body: {
        contractVersion: PLANNING_API_CONTRACT_VERSION,
        kind: 'planning.merge',
        deterministic: true,
        error: idempotencyValidation.error,
      },
    };
  }

  if (idempotencyValidation.replay && existingIdempotencyRecord && existingIdempotencyRecord.response) {
    return {
      statusCode: 200,
      body: {
        ...cloneJsonValue(existingIdempotencyRecord.response),
        idempotency: {
          key: idempotencyValidation.idempotencyKey,
          replay: true,
          scopeKey: idempotencyValidation.scopeKey,
          conflict: false,
          outcome: 'replay',
        },
      },
    };
  }

  const receiptLookup = resolvePlanningCompareReceipt(state, compareReceiptId, context, nowMs);
  if (!receiptLookup.ok) {
    return {
      statusCode: 409,
      body: {
        contractVersion: PLANNING_API_CONTRACT_VERSION,
        kind: 'planning.merge',
        deterministic: true,
        error: receiptLookup.error,
      },
    };
  }
  if (!receiptLookup.receipt.mergeEligible) {
    return {
      statusCode: 409,
      body: {
        contractVersion: PLANNING_API_CONTRACT_VERSION,
        kind: 'planning.merge',
        deterministic: true,
        error: { code: 'merge_gate_blocked', reason: receiptLookup.receipt.reason || 'gate_not_pass' },
        gateState: receiptLookup.receipt.gateState,
        downgrade: receiptLookup.receipt.downgrade || null,
      },
    };
  }

  const token = state.mergeIntentTokens.get(tokenId);
  if (!token) {
    return {
      statusCode: 400,
      body: {
        contractVersion: PLANNING_API_CONTRACT_VERSION,
        kind: 'planning.merge',
        deterministic: true,
        error: { code: 'invalid_confirmation_token', reason: 'token_not_found' },
      },
    };
  }

  const tokenValidation = validatePlanningMergeConfirmationToken(token, {
    nowMs,
    actorId,
    targetId,
    compareHash,
  });

  if (!tokenValidation.ok) {
    return {
      statusCode: 409,
      body: {
        contractVersion: PLANNING_API_CONTRACT_VERSION,
        kind: 'planning.merge',
        deterministic: true,
        error: tokenValidation.error,
      },
    };
  }

  if (String(token.compareReceiptId || '') !== compareReceiptId) {
    return {
      statusCode: 409,
      body: {
        contractVersion: PLANNING_API_CONTRACT_VERSION,
        kind: 'planning.merge',
        deterministic: true,
        error: { code: 'invalid_confirmation_token', reason: 'compare_receipt_mismatch' },
      },
    };
  }

  if (token.compareHash !== compareHash) {
    return {
      statusCode: 409,
      body: {
        contractVersion: PLANNING_API_CONTRACT_VERSION,
        kind: 'planning.merge',
        deterministic: true,
        error: { code: 'invalid_confirmation_token', reason: 'compare_hash_mismatch' },
      },
    };
  }

  const sourceIds = normalizeMergeIdList(payload.sourceIds);
  const recomputedSourceIdsHash = buildPlanningSourceIdsHash(sourceIds);
  if (recomputedSourceIdsHash !== sourceIdsHash || token.sourceIdsHash !== sourceIdsHash) {
    return {
      statusCode: 409,
      body: {
        contractVersion: PLANNING_API_CONTRACT_VERSION,
        kind: 'planning.merge',
        deterministic: true,
        error: { code: 'invalid_confirmation_token', reason: 'source_ids_hash_mismatch' },
      },
    };
  }

  const expectedVersionHash = normalizePlanningVersionVectorHash(payload.versionVector || null);
  const tokenVersionHash = String(token.versionVectorHash || normalizePlanningVersionVectorHash(token.versionVector || null));
  if (expectedVersionHash !== tokenVersionHash) {
    return {
      statusCode: 409,
      body: {
        contractVersion: PLANNING_API_CONTRACT_VERSION,
        kind: 'planning.merge',
        deterministic: true,
        error: { code: 'invalid_confirmation_token', reason: 'snapshot_version_mismatch' },
      },
    };
  }

  const atomicEnvelope = payload.atomicEnvelope && typeof payload.atomicEnvelope === 'object'
    ? payload.atomicEnvelope
    : {
      targetUpdate: { targetId },
      sourceTransitions: sourceIds.map((sourceId) => ({ sourceId, toState: 'merged' })),
      lineageLinks: sourceIds.map((sourceId) => ({ from: sourceId, to: targetId })),
      auditEvent: {
        kind: 'planning_merge',
        actorId,
        compareHash,
        sourceIdsHash,
      },
      tokenConsumedWrite: { tokenId: token.tokenId },
    };

  const envelopeValidation = validatePlanningMergeAtomicEnvelope(atomicEnvelope);
  if (!envelopeValidation.ok) {
    return {
      statusCode: 400,
      body: {
        contractVersion: PLANNING_API_CONTRACT_VERSION,
        kind: 'planning.merge',
        deterministic: true,
        error: envelopeValidation.error,
      },
    };
  }

  const winnerSummary = String(payload.conflictSummary || '').trim() || 'no precedence conflicts';
  const mergeScope = repoId ? 'repo' : 'user';

  const mergeRecordResult = createPlanningRecordOperation(state, {
    context: { userId: actorId, repoId },
    request: {
      idempotencyKey: `merge-record:${token.tokenId}`,
      scope: mergeScope,
      title: `Merge intent ${targetId}`,
      summary: `Intent ${token.tokenId}; compare=${compareHash}; conflicts=${winnerSummary}`,
      state: 'queued',
      score: 1,
    },
    nowMs,
  });

  if (!mergeRecordResult || mergeRecordResult.ok === false) {
    return {
      statusCode: 500,
      body: {
        contractVersion: PLANNING_API_CONTRACT_VERSION,
        kind: 'planning.merge',
        deterministic: true,
        error: { code: 'merge_commit_failed', reason: 'record_write_failed' },
      },
    };
  }

  token.consumedAt = new Date(nowMs).toISOString();
  state.mergeIntentTokens.set(token.tokenId, token);

  const response = {
    contractVersion: PLANNING_API_CONTRACT_VERSION,
    kind: 'planning.merge',
    deterministic: true,
    mergeAccepted: true,
    mergeEvent: {
      tokenId: token.tokenId,
      actorId,
      targetId,
      sourceIdsHash,
      compareHash,
      consumedAt: token.consumedAt,
      versionVector: token.versionVector || null,
    },
    mergeRecord: mergeRecordResult.body && mergeRecordResult.body.record ? mergeRecordResult.body.record : null,
  };

  state.mergeIdempotencyRecords.set(idempotencyValidation.idempotencyKey, {
    idempotencyKey: idempotencyValidation.idempotencyKey,
    payloadHash: idempotencyValidation.payloadHash,
    response: cloneJsonValue(response),
    createdAtMs: nowMs,
    expiresAtMs: nowMs + PLANNING_MERGE_IDEMPOTENCY_TTL_MS,
  });

  return {
    statusCode: 200,
    body: {
      ...response,
      idempotency: {
        key: idempotencyValidation.idempotencyKey,
        replay: false,
        scopeKey: idempotencyValidation.scopeKey,
        conflict: false,
        outcome: 'applied',
      },
    },
  };
}

function rollbackMergeCommitAfterPersistenceFailure(planningApiState, operationBody = {}) {
  const mergeState = ensurePlanningMergeState(planningApiState);
  const body = operationBody && typeof operationBody === 'object' ? operationBody : {};

  const idempotency = body.idempotency && typeof body.idempotency === 'object'
    ? body.idempotency
    : null;
  const mergeEvent = body.mergeEvent && typeof body.mergeEvent === 'object'
    ? body.mergeEvent
    : null;

  const idempotencyKey = idempotency && typeof idempotency.key === 'string'
    ? idempotency.key.trim()
    : '';
  if (idempotencyKey) {
    mergeState.mergeIdempotencyRecords.delete(idempotencyKey);
  }

  const tokenId = mergeEvent && typeof mergeEvent.tokenId === 'string'
    ? mergeEvent.tokenId.trim()
    : '';
  if (tokenId) {
    const token = mergeState.mergeIntentTokens.get(tokenId);
    if (token && typeof token === 'object') {
      token.consumedAt = null;
      mergeState.mergeIntentTokens.set(tokenId, token);
    }
  }
}

function sendLifecyclePayloadError(res, action, failure) {
  sendJson(res, 400, {
    error: 'Invalid lifecycle payload',
    code: String(failure && failure.code ? failure.code : 'invalid_lifecycle_payload'),
    action,
    reason: String(failure && failure.reason ? failure.reason : 'validation_failed'),
  });
}

function resolveLifecycleCapabilityGate(action, providerState) {
  const normalizedAction = String(action || '').trim().toLowerCase();
  const providerSelection = providerState && typeof providerState === 'object'
    ? (providerState.selectedProvider || providerState.defaultProvider)
    : null;

  const finishCompatibilityHook = buildFinishCompatibilityHookContract();

  if (normalizedAction === 'finish') {
    const providerCapability = evaluateProviderLifecycleCapability({
      provider: providerSelection,
      action: 'stop',
    });

    return {
      allowed: true,
      capability: {
        ...providerCapability,
        action: 'finish',
        shared: true,
        supported: true,
        marker: 'supported',
        reason: 'finish_sequence_supported',
        finishCompatibilityHook,
      },
      finishCompatibilityHook,
    };
  }

  const capability = evaluateProviderLifecycleCapability({
    provider: providerSelection,
    action: normalizedAction,
  });

  if (capability.supported) {
    return {
      allowed: true,
      capability,
      finishCompatibilityHook,
    };
  }

  return {
    allowed: false,
    statusCode: 501,
    capability,
    finishCompatibilityHook,
    body: {
      ...buildLifecycleUnsupportedCapabilityMarker({
      provider: capability.provider,
      action,
      }),
      finishCompatibilityHook,
    },
  };
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.js') return 'application/javascript; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.txt' || ext === '.md') return 'text/plain; charset=utf-8';
  return 'application/octet-stream';
}

function serveStatic(publicDir, urlPath, res) {
  let rel = urlPath || '/';
  if (rel === '/') rel = '/index.html';
  rel = rel.split('\\').join('/');
  const cleaned = rel.replace(/^\/+/, '');
  const abs = safeResolveUnder(publicDir, cleaned);

  let stat;
  try {
    stat = fs.statSync(abs);
  } catch {
    sendText(res, 404, 'Not found');
    return;
  }
  if (!stat.isFile()) {
    sendText(res, 404, 'Not found');
    return;
  }

  res.writeHead(200, {
    'Content-Type': contentTypeFor(abs),
    'Cache-Control': 'no-store',
  });
  fs.createReadStream(abs).pipe(res);
}

function parseNumberQuery(searchParams, key, defaultValue) {
  const v = searchParams.get(key);
  if (v == null || v === '') return defaultValue;
  const n = Number(v);
  if (!Number.isFinite(n)) return defaultValue;
  return n;
}

function runVscodeSettingsPatcher({ engineRoot, vscodeHome, settingsPath, dryRun }) {
  const patcher = path.join(path.resolve(engineRoot), 'scripts', 'vscode-settings-patch.mjs');
  if (!fs.existsSync(patcher)) {
    throw new Error(`Missing settings patcher script: ${patcher}`);
  }

  const args = [patcher, '--vscode-home', String(vscodeHome || '')];
  if (dryRun) args.push('--dry-run');
  if (settingsPath) args.push('--settings', String(settingsPath));

  const result = childProcess.spawnSync(process.execPath, args, {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 2 * 1024 * 1024,
  });

  return {
    ok: result.status === 0,
    exitCode: result.status,
    signal: result.signal || null,
    patcher,
    args: args.slice(1),
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

let policyPreflightCache = {
  expiresAtMs: 0,
  value: null,
};

function evaluatePolicyPreflight(engineRoot) {
  const validatorPath = path.join(path.resolve(engineRoot), 'scripts', 'validate-policy-lockfiles.js');
  const checkedAt = new Date().toISOString();

  if (!fs.existsSync(validatorPath)) {
    return {
      ok: false,
      status: 'unavailable',
      reason: 'validator_missing',
      checkedAt,
      validatorPath,
    };
  }

  const result = childProcess.spawnSync(process.execPath, [validatorPath], {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 512 * 1024,
  });

  const stdout = String(result.stdout || '').trim();
  const stderr = String(result.stderr || '').trim();

  if (result.status === 0) {
    return {
      ok: true,
      status: 'passed',
      checkedAt,
      validatorPath,
      message: stdout || 'Policy lockfile validation passed',
    };
  }

  return {
    ok: false,
    status: 'failed',
    reason: 'validation_failed',
    checkedAt,
    validatorPath,
    exitCode: result.status,
    message: stderr || stdout || 'Policy lockfile validation failed',
  };
}

function getPolicyPreflight(engineRoot, { refresh = false } = {}) {
  const now = Date.now();
  if (!refresh && policyPreflightCache.value && now < policyPreflightCache.expiresAtMs) {
    return policyPreflightCache.value;
  }

  const value = evaluatePolicyPreflight(engineRoot);
  policyPreflightCache = {
    value,
    expiresAtMs: now + 10_000,
  };

  return value;
}

function readJsonFileSafe(filePath) {
  try {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function looksLikePlanText(text) {
  const t = String(text || '');
  return (
    t.includes('# Plan Pack') ||
    t.includes('Plan Pack —') ||
    t.includes('# Plan-Pack Progress Tracker') ||
    t.includes('## Work Unit Specs')
  );
}

function extractPlanFromText(text) {
  const t = String(text || '');
  if (!looksLikePlanText(t)) return null;
  // Store/display the full blob; avoid brittle slicing/parsing.
  return t;
}

function readTextFileIfExists(absPath, maxBytes) {
  return assets.readTextFileSafe(absPath, maxBytes);
}

function listPlanArtifacts(sessionDirAbs) {
  const sessionDir = path.resolve(sessionDirAbs);
  const results = [];

  const planPath = path.join(sessionDir, 'plan.md');
  const finalPath = path.join(sessionDir, 'final.md');
  const plansDir = path.join(sessionDir, 'plans');
  const indexPath = path.join(plansDir, 'index.json');
  const metaPath = path.join(sessionDir, 'meta.json');

  const meta = readJsonFileSafe(metaPath);
  const sessionStatus = meta && typeof meta.status === 'string' ? meta.status : null;

  if (fs.existsSync(planPath) && fs.statSync(planPath).isFile()) {
    const st = fs.statSync(planPath);
    results.push({
      id: 'latest',
      kind: 'latest',
      status: null,
      source: 'plan.md',
      bytes: st.size,
      updatedMs: st.mtimeMs,
      sessionStatus,
    });
  }

  // Prefer an explicit plans index if present.
  const index = readJsonFileSafe(indexPath);
  if (index && typeof index === 'object' && !Array.isArray(index) && Array.isArray(index.plans)) {
    for (const p of index.plans) {
      if (!p || typeof p !== 'object') continue;
      const id = p.id;
      const file = p.file;
      if (typeof id !== 'string' || !id) continue;
      if (typeof file !== 'string' || !file) continue;
      const abs = path.join(plansDir, file);
      if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue;
      const st = fs.statSync(abs);
      results.push({
        id,
        kind: 'revision',
        status: typeof p.status === 'string' ? p.status : null,
        verdict: typeof p.verdict === 'string' ? p.verdict : null,
        source: `plans/${file}`,
        bytes: st.size,
        updatedMs: st.mtimeMs,
        sessionStatus,
      });
    }
    return results;
  }

  // Fallback: list plans/*.md if present.
  try {
    if (fs.existsSync(plansDir) && fs.statSync(plansDir).isDirectory()) {
      const entries = fs.readdirSync(plansDir, { withFileTypes: true });
      for (const e of entries) {
        if (!e.isFile() || !e.name.toLowerCase().endsWith('.md')) continue;
        const abs = path.join(plansDir, e.name);
        const st = fs.statSync(abs);
        results.push({
          id: e.name.replace(/\.md$/i, ''),
          kind: 'revision',
          status: null,
          source: `plans/${e.name}`,
          bytes: st.size,
          updatedMs: st.mtimeMs,
          sessionStatus,
        });
      }
    }
  } catch {
    // ignore
  }

  // If no plan.md exists, offer a derived plan from final.md (display-only).
  if (!results.some((r) => r.id === 'latest')) {
    const finalText = readTextFileIfExists(finalPath, 2 * 1024 * 1024);
    const derived = finalText ? extractPlanFromText(finalText) : null;
    if (derived) {
      results.push({
        id: 'derived-from-final',
        kind: 'derived',
        status: sessionStatus && sessionStatus !== 'completed' ? 'dropped' : null,
        source: 'final.md',
        bytes: Buffer.byteLength(derived, 'utf8'),
        updatedMs: fs.existsSync(finalPath) ? fs.statSync(finalPath).mtimeMs : null,
        sessionStatus,
      });
    }
  }

  return results;
}

function readPlanArtifact(sessionDirAbs, planId) {
  const sessionDir = path.resolve(sessionDirAbs);
  const id = String(planId || '').trim();
  if (!id) return null;

  const planPath = path.join(sessionDir, 'plan.md');
  const finalPath = path.join(sessionDir, 'final.md');
  const plansDir = path.join(sessionDir, 'plans');

  if (id === 'latest') {
    return readTextFileIfExists(planPath, 2 * 1024 * 1024);
  }

  if (id === 'derived-from-final') {
    const finalText = readTextFileIfExists(finalPath, 2 * 1024 * 1024);
    return finalText ? extractPlanFromText(finalText) : null;
  }

  // revision id: map to plans/<id>.md
  const abs = path.join(plansDir, `${id}.md`);
  return readTextFileIfExists(abs, 2 * 1024 * 1024);
}

function backupFile(filePath) {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = path.join(dir, `${base}.bak.${stamp}`);
  fs.copyFileSync(filePath, backup);
  return backup;
}

function ensureApproval(toolApprovals, kind) {
  if (!Array.isArray(toolApprovals)) return false;
  const k = String(kind || '').trim();
  if (!k) return false;
  if (toolApprovals.some((x) => x && typeof x === 'object' && String(x.kind || '').trim() === k)) {
    return false;
  }
  toolApprovals.push({ kind: k });
  return true;
}

function patchCopilotPermissionsConfig({ copilotHomeAbs, vscodeHomeAbs, dryRun }) {
  const copilotHome = path.resolve(copilotHomeAbs);
  const vscodeHome = path.resolve(vscodeHomeAbs);
  const filePath = path.join(copilotHome, 'permissions-config.json');

  const existing = readJsonFileSafe(filePath);
  const root = existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {};
  if (!root.locations || typeof root.locations !== 'object' || Array.isArray(root.locations)) {
    root.locations = {};
  }

  const { locations: desired } = resolvePermissionLocations({
    baseRoots: [copilotHome, vscodeHome],
    includeDefaultSubdirs: true,
    scanExistingSubdirs: true,
  });
  let changed = false;

  for (const loc of desired) {
    if (!root.locations[loc] || typeof root.locations[loc] !== 'object' || Array.isArray(root.locations[loc])) {
      root.locations[loc] = {};
      changed = true;
    }
    const slot = root.locations[loc];
    if (!Array.isArray(slot.tool_approvals)) {
      slot.tool_approvals = [];
      changed = true;
    }

    changed = ensureApproval(slot.tool_approvals, 'read') || changed;
    changed = ensureApproval(slot.tool_approvals, 'write') || changed;
    changed = ensureApproval(slot.tool_approvals, 'memory') || changed;
  }

  if (!changed) {
    return { ok: true, action: 'noop', filePath, locations: desired };
  }

  if (dryRun) {
    return { ok: true, action: 'would_patch', filePath, locations: desired };
  }

  let backup = null;
  if (fs.existsSync(filePath)) {
    backup = backupFile(filePath);
  } else {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(root, null, 2) + '\n', 'utf8');

  return { ok: true, action: 'patched', filePath, backup, locations: desired };
}

function proxyToTracker(trackerUrl, trackerToken, targetPath, method, req, res, lifecycleAction = null) {
  if (!trackerToken) {
    sendJson(res, 502, { error: 'Tracker token not configured. Set --tracker-token or INSTRUCTION_ENGINE_GATEWAY_HTTP_TOKEN.' });
    return;
  }

  const parsed = new URL(targetPath, trackerUrl);
  const options = {
    hostname: parsed.hostname,
    port: parsed.port,
    path: parsed.pathname + parsed.search,
    method: method,
    headers: {
      'Authorization': `Bearer ${trackerToken}`,
      'Accept': 'application/json',
      ...(lifecycleAction ? createLifecycleCompatibilityRequestHeaders() : {}),
    },
    timeout: 10000,
  };

  const proxyReq = http.request(options, (proxyRes) => {
    if (lifecycleAction) {
      const compatibility = evaluateLifecycleMixedVersionCompatibility({
        action: lifecycleAction,
        direction: 'new_client_old_tracker',
        headers: proxyRes.headers,
      });
      if (!compatibility.compatible) {
        proxyRes.resume();
        sendJson(res, compatibility.statusCode, compatibility.body);
        return;
      }
    }

    const ct = proxyRes.headers['content-type'] || 'application/json';
    res.writeHead(proxyRes.statusCode || 502, { 'Content-Type': ct, 'Cache-Control': 'no-store' });
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    if (!res.headersSent) {
      sendJson(res, 502, { error: `Tracker unreachable: ${err.message}` });
    }
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    if (!res.headersSent) {
      sendJson(res, 504, { error: 'Tracker request timed out' });
    }
  });

  if (method === 'POST') {
    req.pipe(proxyReq);
  } else {
    proxyReq.end();
  }
}

function postJsonToTracker(trackerUrl, trackerToken, targetPath, payload, res, action = null) {
  if (!trackerToken) {
    sendJson(res, 502, { error: 'Tracker token not configured. Set --tracker-token or INSTRUCTION_ENGINE_GATEWAY_HTTP_TOKEN.' });
    return;
  }

  const parsed = new URL(targetPath, trackerUrl);
  const rawBody = JSON.stringify(payload == null ? {} : payload);

  const options = {
    hostname: parsed.hostname,
    port: parsed.port,
    path: parsed.pathname + parsed.search,
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${trackerToken}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(rawBody),
      ...createLifecycleCompatibilityRequestHeaders(),
    },
    timeout: 10000,
  };

  const proxyReq = http.request(options, (proxyRes) => {
    const compatibility = evaluateLifecycleMixedVersionCompatibility({
      action,
      direction: 'new_client_old_tracker',
      headers: proxyRes.headers,
    });
    if (!compatibility.compatible) {
      proxyRes.resume();
      sendJson(res, compatibility.statusCode, compatibility.body);
      return;
    }

    const ct = proxyRes.headers['content-type'] || 'application/json';
    res.writeHead(proxyRes.statusCode || 502, { 'Content-Type': ct, 'Cache-Control': 'no-store' });
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    if (!res.headersSent) {
      sendJson(res, 502, { error: `Tracker unreachable: ${err.message}` });
    }
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    if (!res.headersSent) {
      sendJson(res, 504, { error: 'Tracker request timed out' });
    }
  });

  proxyReq.write(rawBody);
  proxyReq.end();
}

function postJsonToTrackerWithFinishInvariant(trackerUrl, trackerToken, targetPath, payload, res, providerState, action = 'finish') {
  if (!trackerToken) {
    sendJson(res, 502, { error: 'Tracker token not configured. Set --tracker-token or INSTRUCTION_ENGINE_GATEWAY_HTTP_TOKEN.' });
    return;
  }

  const parsed = new URL(targetPath, trackerUrl);
  const rawBody = JSON.stringify(payload == null ? {} : payload);

  const options = {
    hostname: parsed.hostname,
    port: parsed.port,
    path: parsed.pathname + parsed.search,
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${trackerToken}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(rawBody),
      ...createLifecycleCompatibilityRequestHeaders(),
    },
    timeout: 10000,
  };

  const proxyReq = http.request(options, (proxyRes) => {
    const compatibility = evaluateLifecycleMixedVersionCompatibility({
      action,
      direction: 'new_client_old_tracker',
      headers: proxyRes.headers,
    });
    if (!compatibility.compatible) {
      proxyRes.resume();
      sendJson(res, compatibility.statusCode, compatibility.body);
      return;
    }

    const ct = String(proxyRes.headers['content-type'] || 'application/json');
    const statusCode = proxyRes.statusCode || 502;
    const chunks = [];

    proxyRes.on('data', (chunk) => chunks.push(chunk));
    proxyRes.on('end', () => {
      const responseBodyText = Buffer.concat(chunks).toString('utf8');

      const isJson = ct.toLowerCase().includes('application/json');
      if (!isJson) {
        res.writeHead(statusCode, { 'Content-Type': ct, 'Cache-Control': 'no-store' });
        res.end(responseBodyText);
        return;
      }

      let parsedBody;
      try {
        parsedBody = responseBodyText.trim() ? JSON.parse(responseBodyText) : {};
      } catch {
        res.writeHead(statusCode, { 'Content-Type': ct, 'Cache-Control': 'no-store' });
        res.end(responseBodyText);
        return;
      }

      if (statusCode >= 200 && statusCode < 300) {
        const invariant = validateFinishCanonicalSandboxIdInvariant({
          canonicalSandboxId: payload && typeof payload.sandboxId === 'string' ? payload.sandboxId : '',
          prAction: payload && typeof payload.prAction === 'string' ? payload.prAction : 'skip-pr',
          trackerBody: parsedBody,
          providerState,
        });
        if (!invariant.ok) {
          sendJson(res, invariant.statusCode, invariant.body);
          return;
        }
      }

      sendJson(res, statusCode, parsedBody);
    });
  });

  proxyReq.on('error', (err) => {
    if (!res.headersSent) {
      sendJson(res, 502, { error: `Tracker unreachable: ${err.message}` });
    }
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    if (!res.headersSent) {
      sendJson(res, 504, { error: 'Tracker request timed out' });
    }
  });

  proxyReq.write(rawBody);
  proxyReq.end();
}

function relayTrackerSSE(trackerUrl, trackerToken, req, res) {
  if (!trackerToken) {
    sendJson(res, 502, { error: 'Tracker token not configured' });
    return;
  }

  const parsed = new URL('/api/events', trackerUrl);
  const options = {
    hostname: parsed.hostname,
    port: parsed.port,
    path: parsed.pathname,
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${trackerToken}`,
      'Accept': 'text/event-stream',
    },
  };

  const proxyReq = http.request(options, (proxyRes) => {
    if (proxyRes.statusCode !== 200) {
      sendJson(res, 502, { error: `Tracker returned ${proxyRes.statusCode}` });
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    proxyRes.pipe(res);

    req.on('close', () => {
      proxyReq.destroy();
    });
  });

  proxyReq.on('error', (err) => {
    if (!res.headersSent) {
      sendJson(res, 502, { error: `Tracker SSE unreachable: ${err.message}` });
    }
  });

  proxyReq.end();
}

function handleApi({ req, res, u, copilotHome, vscodeHome, sandboxesHome, engineRoot, changeTracker, trackerUrl, trackerToken, planningPersistenceConfig, planningPersistenceState, planningApiState, planningAuthContext, providerState, planningDurabilityDependencyGate }) {
  // Auth scope: single-session only. Multi-session aggregate views are deferred.
  // All API endpoints serve one session at a time. No cross-session auth tokens.
  const pathname = u.pathname;
  const copilotHomeAbs = path.resolve(copilotHome);
  const vscodeHomeAbs = copilotHomeAbs;
  const assetsHomeAbs = copilotHomeAbs;
  const activePlanningDurabilityDependencyGate = planningDurabilityDependencyGate
    && typeof planningDurabilityDependencyGate === 'object'
    ? planningDurabilityDependencyGate
    : evaluatePlanningDurabilityDependencyGate({ env: process.env });

  if (req.method === 'GET' && pathname === '/api/policy/preflight') {
    const refresh = (u.searchParams.get('refresh') || '').trim() === '1';
    const policy = getPolicyPreflight(engineRoot, { refresh });
    sendJson(res, 200, policy);
    return;
  }

  const isMutatingRequest = req.method && !['GET', 'HEAD', 'OPTIONS'].includes(req.method.toUpperCase());
  if (isMutatingRequest) {
    const policy = getPolicyPreflight(engineRoot);
    if (!policy.ok) {
      sendJson(res, 503, {
        error: 'Policy gate blocked mutating request',
        code: 'policy_gate_blocked',
        policy,
      });
      return;
    }
  }

  if (isPlanningDurabilityRoute(pathname) && activePlanningDurabilityDependencyGate.ready !== true) {
    const gateFailure = buildPlanningDurabilityDependencyGateFailure(pathname, req.method, activePlanningDurabilityDependencyGate);
    sendJson(res, gateFailure.statusCode, gateFailure.body);
    return;
  }

  if (req.method === 'GET' && pathname === '/api/health') {
    const changes = changeTracker ? changeTracker.get() : null;
    const runtime = getRuntimeHealth({ engineRoot, sandboxesHome, providerState });
    const policy = getPolicyPreflight(engineRoot);
    const planningPersistenceRaw = getPlanningPersistenceHealth(planningPersistenceConfig, planningPersistenceState);
    const planningPersistence = buildPlanningPersistenceHealthEnvelope(planningPersistenceRaw);
    sendJson(res, 200, {
      ok: true,
      now: Date.now(),
      engineRoot,
      copilotHome,
      vscodeHome,
      changes,
      runtime,
      policy,
      planningPersistence,
      planningDurabilityDependencyGate: activePlanningDurabilityDependencyGate,
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/version') {
    const changes = changeTracker ? changeTracker.get() : { version: 0, lastChangedMs: null };
    sendJson(res, 200, changes);
    return;
  }

  if (req.method === 'POST' && pathname === '/api/planning/records') {
    readJsonBody(req)
      .then(async (body) => {
        const payload = body && typeof body === 'object' ? body : {};
        const context = buildPlanningRequestContext(req, u, payload, planningAuthContext);
        const recordInput = payload.record && typeof payload.record === 'object' ? payload.record : payload;

        const projectionSync = await hydratePlanningProjectionFromPersistence({
          pathname,
          method: req.method,
          planningPersistenceConfig,
          planningPersistenceState,
          planningApiState,
          context,
        });

        if (!projectionSync.ok) {
          sendJson(res, projectionSync.failure.statusCode, projectionSync.failure.body);
          return;
        }

        const operation = createPlanningRecordOperation(planningApiState, {
          context,
          request: {
            ...recordInput,
            idempotencyKey: resolveRequestIdempotencyKey(req, payload),
          },
          nowMs: Date.now(),
        });

        if (operation.ok && operation.body && operation.body.record) {
          const persistedWrite = await persistPlanningRecordToAuthority({
            pathname,
            method: req.method,
            planningPersistenceConfig,
            planningPersistenceState,
            context,
            record: operation.body.record,
          });

          if (!persistedWrite.ok) {
            await hydratePlanningProjectionFromPersistence({
              pathname,
              method: req.method,
              planningPersistenceConfig,
              planningPersistenceState,
              planningApiState,
              context,
            });
            sendJson(res, persistedWrite.failure.statusCode, persistedWrite.failure.body);
            return;
          }

          operation.body.record = persistedWrite.record;
        }

        sendJson(res, operation.statusCode, operation.body);
      })
      .catch((e) => sendJson(res, e.statusCode || 400, { error: String(e.message || e) }));
    return;
  }

  if (req.method === 'GET' && pathname === '/api/planning/records') {
    const context = buildPlanningRequestContext(req, u, null, planningAuthContext);
    const scopes = parsePlanningScopesFromRequest(u);
    hydratePlanningProjectionFromPersistence({
      pathname,
      method: req.method,
      planningPersistenceConfig,
      planningPersistenceState,
      planningApiState,
      context,
      scopes: scopes.length ? scopes : undefined,
    })
      .then((projectionSync) => {
        if (!projectionSync.ok) {
          sendJson(res, projectionSync.failure.statusCode, projectionSync.failure.body);
          return;
        }

        const operation = listPlanningRecordsOperation(planningApiState, {
          context,
          scopes: scopes.length ? scopes : undefined,
        });
        sendJson(res, operation.statusCode, operation.body);
      })
      .catch((e) => sendJson(res, e.statusCode || 503, { error: String(e.message || e) }));
    return;
  }

  if (req.method === 'GET' && pathname === '/api/planning/search') {
    const context = buildPlanningRequestContext(req, u, null, planningAuthContext);
    const scopes = parsePlanningScopesFromRequest(u);
    const query = firstStringValue(u.searchParams.get('q'));
    hydratePlanningProjectionFromPersistence({
      pathname,
      method: req.method,
      planningPersistenceConfig,
      planningPersistenceState,
      planningApiState,
      context,
      scopes: scopes.length ? scopes : undefined,
    })
      .then((projectionSync) => {
        if (!projectionSync.ok) {
          sendJson(res, projectionSync.failure.statusCode, projectionSync.failure.body);
          return;
        }

        const operation = searchPlanningRecordsOperation(planningApiState, {
          context,
          scopes: scopes.length ? scopes : undefined,
          query,
          limit: parseNumberQuery(u.searchParams, 'limit', 20),
        });
        sendJson(res, operation.statusCode, operation.body);
      })
      .catch((e) => sendJson(res, e.statusCode || 503, { error: String(e.message || e) }));
    return;
  }

  if (req.method === 'POST' && pathname === '/api/planning/compare') {
    readJsonBody(req)
      .then(async (body) => {
        const payload = body && typeof body === 'object' ? body : {};
        const context = buildPlanningRequestContext(req, u, payload, planningAuthContext);
        const scopes = Array.isArray(payload.scopes) ? payload.scopes : [];

        const projectionSync = await hydratePlanningProjectionFromPersistence({
          pathname,
          method: req.method,
          planningPersistenceConfig,
          planningPersistenceState,
          planningApiState,
          context,
          scopes,
        });

        if (!projectionSync.ok) {
          sendJson(res, projectionSync.failure.statusCode, projectionSync.failure.body);
          return;
        }

        const operation = comparePlanningRecordsOperation(planningApiState, {
          context,
          request: {
            ...payload,
            scopes,
            query: typeof payload.query === 'string' ? payload.query : '',
            implementedOutcomeSources: Array.isArray(payload.implementedOutcomeSources)
              ? payload.implementedOutcomeSources
              : [],
            idempotencyKey: resolveRequestIdempotencyKey(req, payload),
          },
          implementedOutcomesRootAbs: copilotHomeAbs,
          nowMs: Date.now(),
        });

        if (operation && operation.statusCode === 200 && operation.body && !operation.body.error) {
          const nowMs = Date.now();
          const compareReceipt = recordPlanningCompareReceipt(planningApiState, context, operation.body, nowMs);
          operation.body.compareReceipt = compareReceipt;
          operation.body.gateState = compareReceipt.gateState;
          operation.body.mergeEligible = compareReceipt.mergeEligible;
          operation.body.reason = compareReceipt.reason;
          operation.body.downgrade = compareReceipt.downgrade;
        }

        sendJson(res, operation.statusCode, operation.body);
      })
      .catch((e) => sendJson(res, e.statusCode || 400, { error: String(e.message || e) }));
    return;
  }

  if (req.method === 'POST' && pathname === '/api/planning/merge-intent') {
    readJsonBody(req)
      .then((body) => {
        const payload = body && typeof body === 'object' ? body : {};
        const context = buildPlanningRequestContext(req, u, payload, planningAuthContext);
        const operation = issuePlanningMergeIntent(planningApiState, {
          context,
          payload,
          nowMs: Date.now(),
        });
        sendJson(res, operation.statusCode, operation.body);
      })
      .catch((e) => sendJson(res, e.statusCode || 400, { error: String(e.message || e) }));
    return;
  }

  if (req.method === 'POST' && pathname === '/api/planning/merge') {
    readJsonBody(req)
      .then(async (body) => {
        const payload = body && typeof body === 'object' ? body : {};
        const context = buildPlanningRequestContext(req, u, payload, planningAuthContext);

        const projectionSync = await hydratePlanningProjectionFromPersistence({
          pathname,
          method: req.method,
          planningPersistenceConfig,
          planningPersistenceState,
          planningApiState,
          context,
        });

        if (!projectionSync.ok) {
          sendJson(res, projectionSync.failure.statusCode, projectionSync.failure.body);
          return;
        }

        const operation = executePlanningMerge(planningApiState, {
          context,
          payload,
          nowMs: Date.now(),
        });

        const mergeRecord = operation
          && operation.statusCode === 200
          && operation.body
          && operation.body.mergeRecord
          && !(operation.body.idempotency && operation.body.idempotency.replay)
          ? operation.body.mergeRecord
          : null;

        if (mergeRecord) {
          const persistedWrite = await persistPlanningRecordToAuthority({
            pathname,
            method: req.method,
            planningPersistenceConfig,
            planningPersistenceState,
            context,
            record: mergeRecord,
          });

          if (!persistedWrite.ok) {
            rollbackMergeCommitAfterPersistenceFailure(planningApiState, operation.body);
            await hydratePlanningProjectionFromPersistence({
              pathname,
              method: req.method,
              planningPersistenceConfig,
              planningPersistenceState,
              planningApiState,
              context,
            });
            sendJson(res, persistedWrite.failure.statusCode, persistedWrite.failure.body);
            return;
          }

          operation.body.mergeRecord = persistedWrite.record;
        }

        sendJson(res, operation.statusCode, operation.body);
      })
      .catch((e) => sendJson(res, e.statusCode || 400, { error: String(e.message || e) }));
    return;
  }

  if (req.method === 'GET' && pathname === '/api/sessions') {
    const activeWindowMinutes = parseNumberQuery(u.searchParams, 'activeWindowMinutes', 30);
    const source = (u.searchParams.get('source') || 'cli').toLowerCase();
    if (source === 'all') {
      const dedupe = (u.searchParams.get('dedupe') || 'on').toLowerCase();
      const cli = sessions.listSessions(copilotHome, { activeWindowMinutes, recentLimit: 250 }).map((s) => ({ ...s, source: 'cli' }));
      const vs = sessions.listSessions(vscodeHome, { activeWindowMinutes, recentLimit: 250 }).map((s) => ({ ...s, source: 'vscode' }));
      const sandbox = sessions.listSandboxSessions(sandboxesHome, { activeWindowMinutes, recentLimit: 250 });
      const all = [...cli, ...vs, ...sandbox];
      const result = (dedupe === 'off')
        ? all.map((s) => sessions.applySessionReconciliation({
          ...s,
          ...sessions.buildSessionIdentity(s),
        }))
        : sessions.dedupeAllSources(all);
      sendJson(res, 200, { sessions: result });
      return;
    }
    if (source === 'sandbox') {
      const data = sessions.listSandboxSessions(sandboxesHome, { activeWindowMinutes, recentLimit: 250 })
        .map((s) => sessions.applySessionReconciliation(s));
      sendJson(res, 200, { sessions: data });
      return;
    }
    const home = resolveSessionsHome(source, copilotHome, vscodeHome, sandboxesHome);
    const data = sessions.listSessions(home.home, { activeWindowMinutes, recentLimit: 250 })
      .map((s) => sessions.applySessionReconciliation({ ...s, source: home.source }));
    sendJson(res, 200, { sessions: data });
    return;
  }

  {
    const m = pathname.match(/^\/api\/sessions\/([^/]+)\/events$/);
    if (req.method === 'GET' && m) {
      const id = decodeURIComponent(m[1]);
      if (!isValidSessionId(id)) { sendJson(res, 400, { error: 'Invalid session id' }); return; }
      const limit = Math.max(1, Math.min(500, Math.floor(parseNumberQuery(u.searchParams, 'limit', 20))));
      const source = (u.searchParams.get('source') || 'cli').toLowerCase();
      const home = resolveSessionsHome(source, copilotHome, vscodeHome, sandboxesHome);
      const sessionDir = path.join(path.resolve(home.home), 'session-state', id);
      const events = sessions.readRecentEvents(sessionDir, limit);
      sendJson(res, 200, { id, source: home.source, events });
      return;
    }
  }

  {
    const m = pathname.match(/^\/api\/sessions\/([^/]+)\/agent-usage$/);
    if (req.method === 'GET' && m) {
      const id = decodeURIComponent(m[1]);
      if (!isValidSessionId(id)) { sendJson(res, 400, { error: 'Invalid session id' }); return; }
      const limit = Math.max(1, Math.min(500, Math.floor(parseNumberQuery(u.searchParams, 'limit', 500))));
      const source = (u.searchParams.get('source') || 'cli').toLowerCase();
      const home = resolveSessionsHome(source, copilotHome, vscodeHome, sandboxesHome);
      const sessionDir = path.join(path.resolve(home.home), 'session-state', id);
      const usage = sessions.getAgentUsage(sessionDir, limit);
      sendJson(res, 200, { id, source: home.source, usage });
      return;
    }
  }

  {
    const m = pathname.match(/^\/api\/sessions\/([^/]+)\/plan$/);
    if (req.method === 'GET' && m) {
      const id = decodeURIComponent(m[1]);
      if (!isValidSessionId(id)) { sendJson(res, 400, { error: 'Invalid session id' }); return; }
      const source = (u.searchParams.get('source') || 'cli').toLowerCase();
      const home = resolveSessionsHome(source, copilotHome, vscodeHome, sandboxesHome);
      const planPath = path.join(path.resolve(home.home), 'session-state', id, 'plan.md');
      const text = assets.readTextFileSafe(planPath, 512 * 1024);
      if (text == null) {
        sendText(res, 404, 'Not found');
        return;
      }
      sendText(res, 200, text, 'text/plain; charset=utf-8');
      return;
    }
  }

  {
    const m = pathname.match(/^\/api\/sessions\/([^/]+)\/plans$/);
    if (req.method === 'GET' && m) {
      const id = decodeURIComponent(m[1]);
      if (!isValidSessionId(id)) { sendJson(res, 400, { error: 'Invalid session id' }); return; }
      const source = (u.searchParams.get('source') || 'cli').toLowerCase();
      const home = resolveSessionsHome(source, copilotHome, vscodeHome, sandboxesHome);
      const sessionDir = path.join(path.resolve(home.home), 'session-state', id);
      try {
        if (!fs.existsSync(sessionDir) || !fs.statSync(sessionDir).isDirectory()) {
          sendJson(res, 404, { error: 'Session not found', id, source: home.source });
          return;
        }
        const plans = listPlanArtifacts(sessionDir);
        sendJson(res, 200, { id, source: home.source, plans });
      } catch (e) {
        sendJson(res, 400, { error: String(e.message || e), id, source: home.source });
      }
      return;
    }
  }

  {
    const m = pathname.match(/^\/api\/sessions\/([^/]+)\/plans\/([^/]+)$/);
    if (req.method === 'GET' && m) {
      const id = decodeURIComponent(m[1]);
      if (!isValidSessionId(id)) { sendJson(res, 400, { error: 'Invalid session id' }); return; }
      const planId = decodeURIComponent(m[2]);
      const source = (u.searchParams.get('source') || 'cli').toLowerCase();
      const home = resolveSessionsHome(source, copilotHome, vscodeHome, sandboxesHome);
      const sessionDir = path.join(path.resolve(home.home), 'session-state', id);
      const text = readPlanArtifact(sessionDir, planId);
      if (text == null) {
        sendText(res, 404, 'Not found');
        return;
      }
      sendText(res, 200, text, 'text/plain; charset=utf-8');
      return;
    }
  }

  {
    const m = pathname.match(/^\/api\/sessions\/([^/]+)\/final$/);
    if (req.method === 'GET' && m) {
      const id = decodeURIComponent(m[1]);
      if (!isValidSessionId(id)) { sendJson(res, 400, { error: 'Invalid session id' }); return; }
      const source = (u.searchParams.get('source') || 'cli').toLowerCase();
      const home = resolveSessionsHome(source, copilotHome, vscodeHome, sandboxesHome);
      const finalPath = path.join(path.resolve(home.home), 'session-state', id, 'final.md');
      const text = assets.readTextFileSafe(finalPath, 2 * 1024 * 1024);
      if (text == null) {
        sendText(res, 404, 'Not found');
        return;
      }
      sendText(res, 200, text, 'text/plain; charset=utf-8');
      return;
    }
  }

  {
    const m = pathname.match(/^\/api\/sessions\/([^/]+)\/structured-state$/);
    if (req.method === 'GET' && m) {
      const id = decodeURIComponent(m[1]);
      if (!isValidSessionId(id)) { sendJson(res, 400, { error: 'Invalid session id' }); return; }
      const source = (u.searchParams.get('source') || 'cli').toLowerCase();
      const planId = u.searchParams.get('planId') || 'latest';
      const home = resolveSessionsHome(source, copilotHome, vscodeHome, sandboxesHome);
      const sessionDir = path.join(path.resolve(home.home), 'session-state', id);
      
      try {
        if (!fs.existsSync(sessionDir) || !fs.statSync(sessionDir).isDirectory()) {
          sendJson(res, 404, { error: 'Session not found', id, source: home.source });
          return;
        }
        
        const planText = readPlanArtifact(sessionDir, planId);
        if (!planText) {
          sendJson(res, 404, { error: 'Plan artifact not found', id, source: home.source, planId });
          return;
        }
        
        const structured = planState.parseStructuredState(planText);
        sendJson(res, 200, {
          id,
          source: home.source,
          planId,
          ...structured,
        });
      } catch (e) {
        sendJson(res, 400, { error: String(e.message || e), id, source: home.source });
      }
      return;
    }
  }

  {
    const m = pathname.match(/^\/api\/sessions\/([^/]+)\/proposition$/);
    if (req.method === 'GET' && m) {
      const id = decodeURIComponent(m[1]);
      if (!isValidSessionId(id)) { sendJson(res, 400, { error: 'Invalid session id' }); return; }
      const source = (u.searchParams.get('source') || 'cli').toLowerCase();
      const home = resolveSessionsHome(source, copilotHome, vscodeHome, sandboxesHome);
      const sessionDir = path.join(path.resolve(home.home), 'session-state', id);
      const propositionPath = path.join(sessionDir, 'proposition.md');
      
      const text = assets.readTextFileSafe(propositionPath, 512 * 1024);
      if (text == null) {
        sendJson(res, 404, { error: 'Proposition not found', id, source: home.source });
        return;
      }
      
      sendJson(res, 200, {
        id,
        source: home.source,
        content: text,
      });
      return;
    }
  }

  {
    const m = pathname.match(/^\/api\/sessions\/([^/]+)\/verification-guide$/);
    if (req.method === 'GET' && m) {
      const id = decodeURIComponent(m[1]);
      if (!isValidSessionId(id)) { sendJson(res, 400, { error: 'Invalid session id' }); return; }
      const source = (u.searchParams.get('source') || 'cli').toLowerCase();
      const home = resolveSessionsHome(source, copilotHome, vscodeHome, sandboxesHome);
      const sessionDir = path.join(path.resolve(home.home), 'session-state', id);
      const guidePath = path.join(sessionDir, 'verification-guide.md');

      const text = assets.readTextFileSafe(guidePath, 512 * 1024);
      if (text == null) {
        sendJson(res, 404, { error: 'Verification guide not found', id, source: home.source });
        return;
      }

      sendJson(res, 200, {
        id,
        source: home.source,
        content: text,
      });
      return;
    }
  }

  {
    const m = pathname.match(/^\/api\/sessions\/([^/]+)\/archive$/);
    if (req.method === 'POST' && m) {
      const id = decodeURIComponent(m[1]);
      if (!isValidSessionId(id)) { sendJson(res, 400, { error: 'Invalid session id' }); return; }
      const source = (u.searchParams.get('source') || 'cli').toLowerCase();
      const home = resolveSessionsHome(source, copilotHome, vscodeHome, sandboxesHome);
      const homeAbs = path.resolve(home.home);
      const sessionDir = path.join(homeAbs, 'session-state', id);
      const archiveRoot = path.join(homeAbs, 'sessions-archive');
      try {
        if (!fs.existsSync(sessionDir) || !fs.statSync(sessionDir).isDirectory()) {
          sendJson(res, 404, { error: 'Session not found', id, source: home.source });
          return;
        }
        ensureDir(archiveRoot);
        const dest = uniqueArchiveDir(archiveRoot, id);
        fs.renameSync(sessionDir, dest);
        sendJson(res, 200, { ok: true, id, source: home.source, archivedTo: dest });
      } catch (e) {
        sendJson(res, 400, { error: String(e.message || e), id, source: home.source });
      }
      return;
    }
  }

  {
    const m = pathname.match(/^\/api\/sessions\/([^/]+)\/delete$/);
    if (req.method === 'POST' && m) {
      const id = decodeURIComponent(m[1]);
      if (!isValidSessionId(id)) { sendJson(res, 400, { error: 'Invalid session id' }); return; }
      const source = (u.searchParams.get('source') || 'cli').toLowerCase();
      const home = resolveSessionsHome(source, copilotHome, vscodeHome, sandboxesHome);
      const homeAbs = path.resolve(home.home);
      const sessionDir = path.join(homeAbs, 'session-state', id);

      readJsonBody(req)
        .then((body) => {
          const force = Boolean(body && (body.force || body.confirm));
          if (!force) throw Object.assign(new Error('Deletion requires {"force": true}'), { statusCode: 400 });
          if (!fs.existsSync(sessionDir) || !fs.statSync(sessionDir).isDirectory()) {
            throw Object.assign(new Error('Session not found'), { statusCode: 404 });
          }

          // Guardrail: never allow deleting outside the configured session-state root.
          const expectedRoot = path.join(homeAbs, 'session-state');
          const resolved = path.resolve(sessionDir);
          const prefix = expectedRoot.endsWith(path.sep) ? expectedRoot : expectedRoot + path.sep;
          if (!resolved.startsWith(prefix)) {
            throw Object.assign(new Error('Refusing to delete path outside session-state'), { statusCode: 400 });
          }

          fs.rmSync(sessionDir, { recursive: true, force: true });
          sendJson(res, 200, { ok: true, id, source: home.source, deleted: true });
        })
        .catch((e) => sendJson(res, e.statusCode || 400, { error: String(e.message || e), id, source: home.source }));
      return;
    }
  }

  if (req.method === 'GET' && pathname === '/api/assets/managed') {
    const managed = assets.getManagedAssetStatuses(engineRoot, assetsHomeAbs);
    sendJson(res, 200, { managed });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/assets/installed') {
    const agents = assets.listInstalledAgents(assetsHomeAbs);
    const skills = assets.listInstalledSkills(assetsHomeAbs);
    const prompts = assets.listInstalledPrompts(assetsHomeAbs);
    const instructions = assets.getInstalledInstructions(assetsHomeAbs);
    sendJson(res, 200, { agents, skills, prompts, instructions });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/assets/sync-all') {
    readJsonBody(req)
      .then((body) => {
        const result = assets.syncAll(engineRoot, assetsHomeAbs, {
          dryRun: Boolean(body.dryRun),
          force: Boolean(body.force),
          
        });
        sendJson(res, 200, { result });
      })
      .catch((e) => sendJson(res, e.statusCode || 400, { error: String(e.message || e) }));
    return;
  }

  if (req.method === 'POST' && pathname === '/api/assets/sync') {
    readJsonBody(req)
      .then((body) => {
        const assetId = body.assetId;
        if (typeof assetId !== 'string' || !assetId) throw Object.assign(new Error('assetId is required'), { statusCode: 400 });
        const result = assets.syncAsset(engineRoot, assetsHomeAbs, assetId, {
          dryRun: Boolean(body.dryRun),
          force: Boolean(body.force),
          
        });
        sendJson(res, 200, { result });
      })
      .catch((e) => sendJson(res, e.statusCode || 400, { error: String(e.message || e) }));
    return;
  }

  if (req.method === 'POST' && pathname === '/api/assets/remove') {
    readJsonBody(req)
      .then((body) => {
        const assetId = body.assetId;
        if (typeof assetId !== 'string' || !assetId) throw Object.assign(new Error('assetId is required'), { statusCode: 400 });
        const managed = assets.getManagedAssetStatuses(engineRoot, assetsHomeAbs);
        const asset = managed.find((a) => a.id === assetId);
        if (!asset) throw Object.assign(new Error(`Unknown assetId: ${assetId}`), { statusCode: 404 });
        const result = assets.removeAsset(assetsHomeAbs, asset, { force: Boolean(body.force) });
        sendJson(res, 200, { result });
      })
      .catch((e) => sendJson(res, e.statusCode || 400, { error: String(e.message || e) }));
    return;
  }

  if (req.method === 'GET' && pathname === '/api/assets/view') {
    const rel = u.searchParams.get('path');
    if (!rel) {
      sendJson(res, 400, { error: 'Missing ?path=' });
      return;
    }
    try {
      const abs = safeResolveUnder(assetsHomeAbs, rel);
      const text = assets.readTextFileSafe(abs, 512 * 1024);
      if (text == null) {
        sendText(res, 404, 'Not found');
        return;
      }
      sendText(res, 200, text, 'text/plain; charset=utf-8');
    } catch (e) {
      sendJson(res, 400, { error: String(e.message || e) });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/assets/delete') {
    readJsonBody(req)
      .then((body) => {
        const relPath = body.path;
        const force = Boolean(body.force);
        if (typeof relPath !== 'string' || !relPath.trim()) throw Object.assign(new Error('path is required'), { statusCode: 400 });

        // Guardrails: only delete within agents/ or skills/.
        const normalized = relPath.split('\\').join('/').replace(/^\/+/, '');
        if (!(normalized.startsWith('agents/') || normalized.startsWith('skills/'))) {
          throw Object.assign(new Error('Only agents/* or skills/* may be deleted'), { statusCode: 400 });
        }
        if (normalized === 'agents' || normalized === 'skills' || normalized === 'agents/' || normalized === 'skills/') {
          throw Object.assign(new Error('Refusing to delete top-level directory'), { statusCode: 400 });
        }
        if (normalized.startsWith('agents/') && !normalized.toLowerCase().endsWith('.agent.md')) {
          throw Object.assign(new Error('Refusing to delete non-agent file under agents/ (expected *.agent.md)'), { statusCode: 400 });
        }

        if (!force) {
          throw Object.assign(new Error('Deletion requires force=true'), { statusCode: 400 });
        }

        const abs = safeResolveUnder(assetsHomeAbs, normalized);
        if (!fs.existsSync(abs)) {
          throw Object.assign(new Error('Not found'), { statusCode: 404 });
        }

        const stat = fs.statSync(abs);
        if (stat.isDirectory()) {
          fs.rmSync(abs, { recursive: true, force: true });
        } else {
          fs.unlinkSync(abs);
        }

        sendJson(res, 200, { ok: true, deleted: normalized });
      })
      .catch((e) => sendJson(res, e.statusCode || 400, { error: String(e.message || e) }));
    return;
  }

  if (req.method === 'POST' && pathname === '/api/vscode/patch-settings') {
    readJsonBody(req)
      .then((body) => {
        const settingsPath = body && body.settingsPath ? String(body.settingsPath) : null;
        const dryRun = Boolean(body && body.dryRun);

        if (!vscodeHomeAbs || !String(vscodeHomeAbs).trim()) {
          throw Object.assign(new Error('vscodeHome is not configured'), { statusCode: 400 });
        }

        const result = runVscodeSettingsPatcher({ engineRoot, vscodeHome: vscodeHomeAbs, settingsPath, dryRun });
        sendJson(res, result.ok ? 200 : 400, { result });
      })
      .catch((e) => sendJson(res, e.statusCode || 400, { error: String(e.message || e) }));
    return;
  }

  if (req.method === 'POST' && pathname === '/api/copilot/authorize') {
    readJsonBody(req)
      .then((body) => {
        const dryRun = Boolean(body && body.dryRun);
        const result = patchCopilotPermissionsConfig({ copilotHomeAbs, vscodeHomeAbs, dryRun });
        sendJson(res, 200, { result });
      })
      .catch((e) => sendJson(res, e.statusCode || 400, { error: String(e.message || e) }));
    return;
  }

  if (req.method === 'GET' && pathname === '/api/lsp/config') {
    const lspConfigPath = path.join(copilotHomeAbs, 'lsp-config.json');
    const config = readJsonFileSafe(lspConfigPath);
    sendJson(res, 200, { config: config || {} });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/lsp/install') {
    const isWin = process.platform === 'win32';
    const scriptName = isWin ? 'install-lsp.ps1' : 'install-lsp.sh';
    const scriptPath = path.join(engineRoot, 'scripts', scriptName);
    
    if (!fs.existsSync(scriptPath)) {
      sendJson(res, 404, { error: `Install script not found: ${scriptPath}` });
      return;
    }

    let cmd, args;
    if (isWin) {
      cmd = 'powershell.exe';
      args = ['-ExecutionPolicy', 'Bypass', '-File', scriptPath];
    } else {
      cmd = 'bash';
      args = [scriptPath];
    }

    childProcess.execFile(cmd, args, { maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      sendJson(res, 200, {
        ok: !error,
        stdout,
        stderr,
        error: error ? error.message : null
      });
    });
    return;
  }

  // --- Gateway config endpoints ---
  if (req.method === 'GET' && pathname === '/api/gateway/config') {
    const configPath = path.join(copilotHomeAbs, 'messaging-gateway.config.json');
    const config = readJsonFileSafe(configPath);
    sendJson(res, 200, { exists: config !== null, configPath, config: config || null });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/gateway/config') {
    readJsonBody(req)
      .then((body) => {
        const discord = body && body.discord;
        if (!discord || typeof discord.guildId !== 'string' || typeof discord.channelId !== 'string' || !Array.isArray(discord.allowlistedUserIds)) {
          throw Object.assign(new Error('discord.guildId, discord.channelId, discord.allowlistedUserIds are required'), { statusCode: 400 });
        }
        const ws = body && body.workspaces;
        if (!ws || !Array.isArray(ws.allowedRoots) || ws.allowedRoots.length === 0 || typeof ws.activeRoot !== 'string') {
          throw Object.assign(new Error('workspaces.allowedRoots (non-empty) and workspaces.activeRoot are required'), { statusCode: 400 });
        }
        const normalizedActive = path.resolve(ws.activeRoot);
        const normalizedRoots = ws.allowedRoots.map((r) => path.resolve(String(r)));
        const isWinPlatform = process.platform === 'win32';
        const inAllowed = normalizedRoots.some((r) =>
          isWinPlatform ? r.toLowerCase() === normalizedActive.toLowerCase() : r === normalizedActive
        );
        if (!inAllowed) {
          throw Object.assign(new Error('workspaces.activeRoot must be one of workspaces.allowedRoots'), { statusCode: 400 });
        }
        const normalized = {
          mode: body.mode || 'auto',
          acp: { host: (body.acp && body.acp.host) || '127.0.0.1', port: Number((body.acp && body.acp.port) || 3000) },
          discord: {
            allowlistedUserIds: discord.allowlistedUserIds.map(String),
            guildId: String(discord.guildId),
            channelId: String(discord.channelId),
            ...(discord.permissionsChannelId ? { permissionsChannelId: String(discord.permissionsChannelId) } : {}),
          },
          workspaces: { allowedRoots: normalizedRoots, activeRoot: normalizedActive },
        };
        const configPath = path.join(copilotHomeAbs, 'messaging-gateway.config.json');
        const tmpPath = `${configPath}.tmp.${Date.now()}`;
        ensureDir(copilotHomeAbs);
        fs.writeFileSync(tmpPath, JSON.stringify(normalized, null, 2), 'utf8');
        fs.renameSync(tmpPath, configPath);
        sendJson(res, 200, { ok: true, configPath });
      })
      .catch((e) => sendJson(res, e.statusCode || 400, { error: String(e.message || e) }));
    return;
  }

  if (req.method === 'GET' && pathname === '/api/gateway/scan-repos') {
    const extraParam = u.searchParams.get('extra');
    const home = os.homedir();
    const isWin = process.platform === 'win32';
    const candidateRoots = [
      isWin ? path.join(home, 'Documents', 'GitHub') : null,
      isWin ? path.join(home, 'source', 'repos') : null,
      path.join(home, 'GitHub'),
      path.join(home, 'projects'),
      path.join(home, 'dev'),
      path.join(home, 'workspace'),
      path.join(home, 'code'),
      path.join(home, 'repos'),
    ].filter(Boolean);
    if (extraParam && extraParam.trim()) {
      candidateRoots.push(path.resolve(extraParam.trim()));
    }
    function isDir(p) {
      try { return fs.statSync(p).isDirectory(); } catch { return false; }
    }
    function hasGit(p) {
      return isDir(path.join(p, '.git'));
    }
    function listSubdirs(p) {
      try { return fs.readdirSync(p).map((n) => path.join(p, n)).filter(isDir); } catch { return []; }
    }
    const roots = [];
    for (const scanRoot of candidateRoots) {
      if (!isDir(scanRoot)) continue;
      const repos = [];
      const level1 = listSubdirs(scanRoot);
      for (const l1 of level1) {
        if (hasGit(l1)) {
          repos.push({ absPath: l1, name: path.basename(l1), isGit: true });
        } else {
          const level2 = listSubdirs(l1);
          for (const l2 of level2) {
            if (hasGit(l2)) {
              repos.push({ absPath: l2, name: path.join(path.basename(l1), path.basename(l2)), isGit: true });
            }
          }
        }
      }
      if (repos.length > 0) roots.push({ scanRoot, repos });
    }
    sendJson(res, 200, { roots });
    return;
  }

  // --- Tracker proxy endpoints ---
  if (req.method === 'GET' && pathname === '/api/tracker/sessions') {
    proxyToTracker(trackerUrl, trackerToken, '/api/sessions/live', 'GET', req, res);
    return;
  }

  if (req.method === 'GET' && pathname === '/api/tracker/permissions') {
    proxyToTracker(trackerUrl, trackerToken, '/api/permissions/pending', 'GET', req, res);
    return;
  }

  {
    const m = pathname.match(/^\/api\/tracker\/permissions\/([^/]+)\/(approve|deny)$/);
    if (req.method === 'POST' && m) {
      const callbackId = decodeURIComponent(m[1]);
      const action = m[2];
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(callbackId)) {
        sendJson(res, 400, { error: 'Invalid callbackId format' });
        return;
      }
      proxyToTracker(trackerUrl, trackerToken, `/api/permissions/${encodeURIComponent(callbackId)}/${action}`, 'POST', req, res);
      return;
    }
  }

  {
    const m = pathname.match(/^\/api\/tracker\/lifecycle\/([^/]+)$/);
    if (req.method === 'POST' && m) {
      const action = decodeURIComponent(m[1]);
      const targetPath = `/api/lifecycle/${encodeURIComponent(action)}`;

      const capabilityGate = resolveLifecycleCapabilityGate(action, providerState);
      if (!capabilityGate.allowed) {
        sendJson(res, capabilityGate.statusCode, capabilityGate.body);
        return;
      }

      if (action === 'open-terminal') {
        readJsonBody(req)
          .then((payload) => {
            const validation = validateOpenTerminalLifecyclePayload(payload);
            if (!validation.ok) {
              sendLifecyclePayloadError(res, action, validation.error);
              return;
            }
            postJsonToTracker(trackerUrl, trackerToken, targetPath, validation.value, res, action);
          })
          .catch((e) => {
            sendJson(res, e.statusCode || 400, {
              error: String(e.message || e),
              code: 'invalid_json',
              action,
            });
          });
        return;
      }

      if (action === 'finish') {
        readJsonBody(req)
          .then((payload) => {
            const validation = validateFinishLifecyclePayload(payload);
            if (!validation.ok) {
              sendLifecyclePayloadError(res, action, validation.error);
              return;
            }
            postJsonToTrackerWithFinishInvariant(
              trackerUrl,
              trackerToken,
              targetPath,
              validation.value,
              res,
              providerState,
              action
            );
          })
          .catch((e) => {
            sendJson(res, e.statusCode || 400, {
              error: String(e.message || e),
              code: 'invalid_json',
              action,
            });
          });
        return;
      }

      proxyToTracker(trackerUrl, trackerToken, targetPath, 'POST', req, res, action);
      return;
    }
  }

  if (req.method === 'GET' && pathname === '/api/tracker/events') {
    relayTrackerSSE(trackerUrl, trackerToken, req, res);
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
}

async function startServer(options = {}) {
  const args = {
    port: Number.isFinite(options.port) ? Number(options.port) : 3210,
    host: typeof options.host === 'string' && options.host.trim() ? options.host.trim() : '127.0.0.1',
    token: typeof options.token === 'string' && options.token.trim() ? options.token.trim() : null,
    copilotHome: typeof options.copilotHome === 'string' && options.copilotHome.trim() ? options.copilotHome.trim() : null,
    vscodeHome: typeof options.vscodeHome === 'string' && options.vscodeHome.trim() ? options.vscodeHome.trim() : null,
    sandboxesHome: typeof options.sandboxesHome === 'string' && options.sandboxesHome.trim() ? options.sandboxesHome.trim() : null,
    trackerUrl: typeof options.trackerUrl === 'string' && options.trackerUrl.trim() ? options.trackerUrl.trim() : null,
    trackerToken: typeof options.trackerToken === 'string' && options.trackerToken.trim() ? options.trackerToken.trim() : null,
  };

  const quiet = options.quiet === true;
  const engineRoot = path.resolve(__dirname, '..');
  const copilotHome = resolveCopilotHome(args);
  const vscodeHome = resolveVscodeHome(args);
  const sandboxesHome = resolveSandboxesHome(args);
  const trackerUrl = resolveTrackerUrl(args);
  const trackerToken = resolveTrackerToken(args);
  const planningPersistenceConfig = readPlanningPersistenceConfig(process.env);
  const planningValidation = validatePlanningPersistenceConfig(planningPersistenceConfig);
  const planningDurabilityDependencyGate = evaluatePlanningDurabilityDependencyGate({ env: process.env });
  const providerState = readPlanningProviderState({
    persistedState: options.providerState,
    env: process.env,
  });
  const canonicalProviderState = buildPlanningProviderStatePersistencePayload(providerState);
  const planningPersistenceState = {
    validation: planningValidation,
    status: planningValidation.usable ? 'ready' : planningValidation.configured ? 'invalid_config' : 'disabled',
    lastError: null,
    client: null,
    providerState: {
      ...canonicalProviderState,
      migration: providerState.migration,
    },
    migrations: {
      appliedCount: 0,
      appliedVersions: [],
      driftDetected: false,
      lastRunAt: null,
    },
  };
  const planningApiState = createPlanningApiState();

  if (planningValidation.required && !planningValidation.usable) {
    const detail = planningValidation.errors.length
      ? planningValidation.errors.join(',')
      : planningValidation.status;
    throw new Error(`Planning persistence is required but configuration is invalid: ${detail}`);
  }

  if (planningValidation.usable) {
    const planningPersistenceClient = options.planningPersistenceClient;
    if (!planningPersistenceClient || typeof planningPersistenceClient.query !== 'function') {
      planningPersistenceState.status = 'configured_no_client';
      planningPersistenceState.lastError = 'planning_persistence_client_unavailable';
      planningPersistenceState.client = null;

      if (planningValidation.required) {
        throw new Error('Planning persistence is required but no planning persistence client was provided');
      }
    } else {
      try {
        const migrationResult = await runPlanningMigrations(planningPersistenceClient, {
          schemaTable: planningPersistenceConfig.schemaTable,
        });
        planningPersistenceState.status = 'ready';
        planningPersistenceState.client = planningPersistenceClient;
        planningPersistenceState.migrations = {
          ...migrationResult,
          lastRunAt: new Date().toISOString(),
        };
      } catch (error) {
        planningPersistenceState.status = error && error.code === 'PLANNING_MIGRATION_CHECKSUM_DRIFT'
          ? 'drift_detected'
          : 'migration_error';
        planningPersistenceState.lastError = String(error && error.message ? error.message : error);
        planningPersistenceState.client = planningPersistenceClient;
        planningPersistenceState.migrations = {
          ...planningPersistenceState.migrations,
          driftDetected: error && error.code === 'PLANNING_MIGRATION_CHECKSUM_DRIFT',
          lastRunAt: new Date().toISOString(),
        };

        if (planningValidation.required) {
          throw error;
        }
      }
    }
  }

  const changeTracker = createChangeTracker(path.resolve(copilotHome), path.resolve(vscodeHome), path.resolve(sandboxesHome));
  const publicDir = path.join(__dirname, 'public');
  const host = args.host;
  const token = resolveToken(args, host);
  const planningAuthContext = {
    userId: derivePlanningActorId(token),
  };

  const server = http.createServer((req, res) => {
    if (!checkAuth(req, token, { allowLoopbackBypass: !isNonLoopback(host) })) {
      res.writeHead(401);
      res.end();
      return;
    }
    const u = new URL(req.url || '/', 'http://127.0.0.1');
    try {
      if (u.pathname.startsWith('/api/')) {
        handleApi({
          req,
          res,
          u,
          copilotHome,
          vscodeHome,
          sandboxesHome,
          engineRoot,
          changeTracker,
          trackerUrl,
          trackerToken,
          planningPersistenceConfig,
          planningPersistenceState,
          planningApiState,
          planningAuthContext,
          providerState: planningPersistenceState.providerState,
          planningDurabilityDependencyGate,
        });
        return;
      }
      serveStatic(publicDir, u.pathname, res);
    } catch (e) {
      sendJson(res, 500, { error: String(e.message || e) });
    }
  });

  return new Promise((resolve, reject) => {
    let settled = false;
    server.once('error', (error) => {
      if (settled) return;
      settled = true;
      changeTracker.close();
      reject(error);
    });

    server.listen(args.port, host, () => {
      if (settled) return;
      settled = true;
      const addr = server.address();
      const actualPort = addr && typeof addr === 'object' ? addr.port : args.port;
      if (!quiet) {
        console.log(`CLI UI server: http://${host}:${actualPort}/`);
        console.log(`copilotHome:    ${copilotHome}`);
        console.log(`vscodeHome:     ${vscodeHome}`);
        console.log(`sandboxesHome:  ${sandboxesHome}`);
        console.log(`engineRoot:     ${engineRoot}`);
        console.log(`trackerUrl:     ${trackerUrl}`);
        if (trackerToken) console.log(`trackerAuth:    configured`);
        if (token) {
          console.log(`auth token:  ${token}`);
        }
        if (isNonLoopback(host)) {
          console.error('[WARN] Binding to non-loopback address without HTTPS. Auth token is transmitted in cleartext.');
          console.error('[WARN] Use a reverse proxy with TLS termination for production use.');
        }
      }

      resolve({
        server,
        host,
        port: actualPort,
        token,
        copilotHome,
        vscodeHome,
        sandboxesHome,
        trackerUrl,
        close: () => new Promise((closeResolve) => {
          changeTracker.close();
          server.close(() => closeResolve());
        }),
      });
    });
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node copilot-ui/server.js [--port 3210] [--host 127.0.0.1] [--token <token>] [--copilot-home <path>] [--tracker-url <url>] [--tracker-token <token>]');
    process.exit(0);
  }

  await startServer(args);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(String(e && e.message ? e.message : e));
    process.exit(1);
  });
}

module.exports = {
  startServer,
  parseArgs,
  containsUnsafeShellSyntax,
  validateOpenTerminalLifecyclePayload,
  validateFinishLifecyclePayload,
  validateFinishCanonicalSandboxIdInvariant,
  canReadPlanningRecord,
  canWritePlanningRecord,
  filterPlanningRecordsForCompare,
  validatePlanningMergeConfirmationToken,
  validatePlanningMergeIdempotency,
  validatePlanningMergeAtomicEnvelope,
  deriveBackfillSourceIdempotencyKey,
  reconcileBackfillItemStatusTransition,
  deriveBackfillRecoveryMarker,
  buildPlanningScopeIsolationPredicate,
  validatePlanningReadWriteContext,
  evaluatePlanningOptimisticConcurrencyGuard,
  SEMANTIC_SCORING_CONTRACT_VERSION,
  scorePlanningCandidate,
  sortPlanningCandidates,
  determineSemanticDegradedMode,
  classifyEmbeddingLifecycle,
  evaluateSemanticGate,
  evaluatePlanningDurabilityDependencyGate,
  resolveLifecycleCapabilityGate,
  LIFECYCLE_MIXED_VERSION_COMPATIBILITY_CONTRACT_VERSION,
  LIFECYCLE_MIXED_VERSION_COMPATIBILITY_CAPABILITY,
  evaluateLifecycleMixedVersionCompatibility,
  buildLifecycleMixedVersionUnsupportedMarker,
  recordPlanningCompareReceipt,
  issuePlanningMergeIntent,
  executePlanningMerge,
  rollbackMergeCommitAfterPersistenceFailure,
};

