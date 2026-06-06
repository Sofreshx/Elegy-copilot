'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const KEYRING_SERVICE_NAME = 'instruction-engine.elegy-copilot.opencode-go';
const STORE_FILENAME = '.elegy-opencode-go-workspaces.json';
const NATIVE_AUTH_FILENAME = 'auth.json';
const NATIVE_OPENCODE_GO_PROVIDER = 'opencode-go';
const OPENCODE_GO_API_KEY_ENV = 'OPENCODE_GO_API_KEY';
const VALIDATION_MODEL = 'kimi-k2.6';
const VALIDATION_URL = 'https://opencode.ai/zen/go/v1/chat/completions';
const VALIDATION_TIMEOUT_MS = 8000;

const KEY_SOURCES = Object.freeze({
  KEYCHAIN: 'keychain',
  ENV: 'env',
  NATIVE_AUTH: 'opencode-auth',
  MISSING: 'missing',
});

function resolveOpenCodeHome(opencodeHome) {
  return path.resolve(opencodeHome || path.join(os.homedir(), '.config', 'opencode'));
}

function resolveStorePath(opencodeHome) {
  return path.join(resolveOpenCodeHome(opencodeHome), STORE_FILENAME);
}

function resolveNativeAuthPath(env = process.env) {
  if (env && typeof env === 'object' && env.XDG_DATA_HOME) {
    return path.resolve(String(env.XDG_DATA_HOME), 'opencode', NATIVE_AUTH_FILENAME);
  }
  return path.join(os.homedir(), '.local', 'share', 'opencode', NATIVE_AUTH_FILENAME);
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function readJsonFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw.trim()) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeJsonAtomic(filePath, value) {
  ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tempPath, JSON.stringify(value, null, 2) + '\n', 'utf8');
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    try {
      fs.rmSync(tempPath, { force: true });
    } catch {
      // ignore temp cleanup failures
    }
    throw error;
  }
}

function generateLocalId() {
  return `wks_${crypto.randomBytes(8).toString('hex')}`;
}

function normalizeWorkspaceId(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeLabel(value, fallback) {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  return fallback;
}

function isValidWorkspaceId(value) {
  return typeof value === 'string' && /^wrk_[A-Za-z0-9_-]+$/.test(value);
}

function buildConsoleUrl(workspaceId) {
  if (!isValidWorkspaceId(workspaceId)) return null;
  return `https://opencode.ai/workspace/${workspaceId}/go`;
}

function nowIso() {
  return new Date().toISOString();
}

function loadKeyringLoader(loaderImpl) {
  if (typeof loaderImpl === 'function') {
    return Promise.resolve().then(() => loaderImpl());
  }
  if (loaderImpl && typeof loaderImpl.then === 'function') {
    return Promise.resolve(loaderImpl).then((mod) => mod);
  }
  // Use indirect specifier so bundlers that try to statically resolve
  // `@napi-rs/keyring/keytar` do not fail when the package is not present.
  const moduleSpec = ['@napi-rs', 'keyring', 'keytar'].join('/');
  return import(moduleSpec)
    .then((module) => ({
      deletePassword: module.deletePassword,
      getPassword: module.getPassword,
      setPassword: module.setPassword,
    }))
    .catch(() => null);
}

function redactApiKey(apiKey) {
  if (typeof apiKey !== 'string' || !apiKey) return null;
  if (apiKey.length <= 8) return '****';
  return `${apiKey.slice(0, 4)}…${apiKey.slice(-4)}`;
}

function normalizeStoredProfile(input, now = nowIso()) {
  if (!input || typeof input !== 'object') return null;
  const id = typeof input.id === 'string' && input.id.trim() ? input.id.trim() : null;
  if (!id) return null;
  const workspaceId = normalizeWorkspaceId(input.workspaceId);
  return {
    id,
    label: normalizeLabel(input.label, id),
    workspaceId,
    workspaceIdKnown: isValidWorkspaceId(workspaceId),
    consoleUrl: typeof input.consoleUrl === 'string' && input.consoleUrl.trim()
      ? input.consoleUrl.trim()
      : buildConsoleUrl(workspaceId),
    keyRef: typeof input.keyRef === 'string' && input.keyRef.trim()
      ? input.keyRef.trim()
      : `keychain:${id}`,
    active: input.active === true,
    createdAt: typeof input.createdAt === 'string' ? input.createdAt : now,
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : now,
    lastValidatedAt: typeof input.lastValidatedAt === 'string' ? input.lastValidatedAt : null,
    lastValidationStatus: typeof input.lastValidationStatus === 'string'
      ? input.lastValidationStatus
      : null,
    lastValidationMessage: typeof input.lastValidationMessage === 'string'
      ? input.lastValidationMessage
      : null,
  };
}

function readStore(opencodeHome) {
  const storePath = resolveStorePath(opencodeHome);
  const raw = readJsonFile(storePath);
  if (!raw || typeof raw !== 'object') {
    return { activeId: null, profiles: [] };
  }
  const profiles = Array.isArray(raw.profiles)
    ? raw.profiles.map((p) => normalizeStoredProfile(p)).filter(Boolean)
    : [];
  const activeId = typeof raw.activeId === 'string' && profiles.some((p) => p.id === raw.activeId)
    ? raw.activeId
    : null;
  return { activeId, profiles };
}

function writeStore(opencodeHome, state) {
  const activeId = state.activeId && state.profiles.some((p) => p.id === state.activeId)
    ? state.activeId
    : null;
  const profiles = state.profiles.map((profile) => ({
    ...profile,
    active: profile.id === activeId,
  }));
  writeJsonAtomic(resolveStorePath(opencodeHome), { activeId, profiles });
}

function detectEnvApiKey(env = process.env) {
  const value = env && typeof env === 'object' ? env[OPENCODE_GO_API_KEY_ENV] : null;
  if (typeof value === 'string' && value.trim().length > 0) {
    return { present: true, source: KEY_SOURCES.ENV };
  }
  return { present: false, source: KEY_SOURCES.MISSING };
}

function detectNativeAuth(opencodeHome, env = process.env, nativeAuthPath = null) {
  const authPath = nativeAuthPath || resolveNativeAuthPath(env);
  const raw = readJsonFile(authPath);
  if (!raw || typeof raw !== 'object') {
    return { present: false, source: KEY_SOURCES.MISSING, authPath, key: null, workspaceId: null };
  }
  const entry = raw[NATIVE_OPENCODE_GO_PROVIDER];
  if (!entry || typeof entry !== 'object') {
    return { present: false, source: KEY_SOURCES.MISSING, authPath, key: null, workspaceId: null };
  }
  const key = typeof entry.key === 'string' && entry.key.trim().length > 0 ? entry.key.trim() : null;
  const workspaceId = normalizeWorkspaceId(entry.workspaceId || entry.workspace_id);
  return {
    present: Boolean(key),
    source: key ? KEY_SOURCES.NATIVE_AUTH : KEY_SOURCES.MISSING,
    authPath,
    key,
    workspaceId,
  };
}

function buildRedactedProfile(profile, source) {
  return {
    id: profile.id,
    label: profile.label,
    workspaceId: profile.workspaceId,
    workspaceIdKnown: profile.workspaceIdKnown,
    consoleUrl: profile.consoleUrl,
    keyRef: profile.keyRef,
    keyPresent: source === 'keychain' || source === 'env' || source === 'opencode-auth',
    keySource: source,
    active: profile.active,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
    lastValidatedAt: profile.lastValidatedAt,
    lastValidationStatus: profile.lastValidationStatus,
    lastValidationMessage: profile.lastValidationMessage,
    origin: 'registered',
  };
}

function buildImportedProfile({ id, label, workspaceId, source }) {
  const now = nowIso();
  const profile = {
    id,
    label,
    workspaceId,
    workspaceIdKnown: isValidWorkspaceId(workspaceId),
    consoleUrl: buildConsoleUrl(workspaceId),
    keyRef: source === KEY_SOURCES.ENV
      ? `env:${OPENCODE_GO_API_KEY_ENV}`
      : `native-auth:${NATIVE_OPENCODE_GO_PROVIDER}`,
    active: false,
    createdAt: now,
    updatedAt: now,
    lastValidatedAt: null,
    lastValidationStatus: null,
    lastValidationMessage: null,
  };
  return {
    ...profile,
    keyPresent: source === KEY_SOURCES.ENV || source === KEY_SOURCES.NATIVE_AUTH,
    keySource: source,
    origin: 'detected',
  };
}

function effectiveActiveId(state, detectedIds) {
  if (state.activeId && state.profiles.some((p) => p.id === state.activeId)) {
    return state.activeId;
  }
  if (detectedIds.length === 1) return detectedIds[0];
  return null;
}

function createOpenCodeGoWorkspaces(deps = {}) {
  const keyringLoader = deps.keyringLoader || null;
  const fsImpl = deps.fs || fs;
  const pathImpl = deps.path || path;
  const env = deps.env || process.env;
  const fetchImpl = typeof deps.fetchImpl === 'function'
    ? deps.fetchImpl
    : (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null);
  const nowProvider = typeof deps.now === 'function' ? deps.now : nowIso;

  async function resolveKeyring() {
    return await loadKeyringLoader(keyringLoader);
  }

  async function readKeychainValue(account) {
    const keyring = await resolveKeyring();
    if (!keyring) return null;
    try {
      const value = await keyring.getPassword(KEYRING_SERVICE_NAME, account);
      return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
    } catch {
      return null;
    }
  }

  async function writeKeychainValue(account, value) {
    const keyring = await resolveKeyring();
    if (!keyring) {
      throw new Error('OS keychain is unavailable in this runtime; cannot store OpenCode Go API key.');
    }
    await keyring.setPassword(KEYRING_SERVICE_NAME, account, value);
  }

  async function deleteKeychainValue(account) {
    const keyring = await resolveKeyring();
    if (!keyring) return false;
    try {
      return Boolean(await keyring.deletePassword(KEYRING_SERVICE_NAME, account));
    } catch {
      return false;
    }
  }

  function buildDetectedProfiles(opencodeHome) {
    const envState = detectEnvApiKey(env);
    const nativeState = detectNativeAuth(opencodeHome, env, deps.nativeAuthPath);
    const detected = [];

    if (envState.present) {
      detected.push(buildImportedProfile({
        id: 'detected:env:opencode-go',
        label: 'Environment OpenCode Go',
        workspaceId: null,
        source: KEY_SOURCES.ENV,
      }));
    }
    if (nativeState.present) {
      detected.push(buildImportedProfile({
        id: 'detected:native:opencode-go',
        label: 'OpenCode native Go',
        workspaceId: nativeState.workspaceId,
        source: KEY_SOURCES.NATIVE_AUTH,
      }));
    }
    return detected;
  }

  async function listWorkspaces(opencodeHome) {
    const state = readStore(opencodeHome);
    const detected = buildDetectedProfiles(opencodeHome);
    const detectedIds = new Set(detected.map((p) => p.id));

    const registered = await Promise.all(state.profiles.map(async (profile) => {
      const stored = await readKeychainValue(profile.keyRef);
      return buildRedactedProfile(
        profile,
        stored ? KEY_SOURCES.KEYCHAIN : KEY_SOURCES.MISSING,
      );
    }));

    const activeId = effectiveActiveId(state, [...detectedIds]);

    const orderedRegistered = registered.slice().sort((a, b) => {
      if (a.active && !b.active) return -1;
      if (!a.active && b.active) return 1;
      return a.label.localeCompare(b.label);
    });
    const orderedDetected = detected.slice().sort((a, b) => a.label.localeCompare(b.label));

    return {
      activeId,
      detectedActiveId: activeId,
      serviceName: KEYRING_SERVICE_NAME,
      storePath: resolveStorePath(opencodeHome),
      registered: orderedRegistered,
      detected: orderedDetected,
    };
  }

  async function registerWorkspace(opencodeHome, payload = {}) {
    const state = readStore(opencodeHome);
    const label = normalizeLabel(payload.label, null);
    const workspaceId = normalizeWorkspaceId(payload.workspaceId);
    const requestedId = typeof payload.id === 'string' && payload.id.trim() ? payload.id.trim() : null;
    const apiKey = typeof payload.apiKey === 'string' && payload.apiKey.trim()
      ? payload.apiKey.trim()
      : null;
    const activate = payload.activate !== false;
    const now = nowProvider();

    if (!label) throw new Error('label is required.');
    if (workspaceId && !isValidWorkspaceId(workspaceId)) {
      throw new Error('workspaceId must match the wrk_... format.');
    }
    if (!apiKey) {
      throw new Error('apiKey is required to register a workspace.');
    }

    const id = requestedId
      || (workspaceId && isValidWorkspaceId(workspaceId) ? workspaceId : generateLocalId());
    const existing = state.profiles.find((p) => p.id === id);

    const baseProfile = existing
      ? { ...existing, updatedAt: now }
      : { ...normalizeStoredProfile({ id, label, workspaceId, createdAt: now }, now) };

    const profile = {
      ...baseProfile,
      id,
      label,
      workspaceId,
      workspaceIdKnown: isValidWorkspaceId(workspaceId),
      consoleUrl: buildConsoleUrl(workspaceId),
      keyRef: `keychain:${id}`,
      createdAt: baseProfile.createdAt || now,
      updatedAt: now,
    };

    await writeKeychainValue(profile.keyRef, apiKey);
    const nextProfiles = state.profiles.filter((p) => p.id !== id).concat(profile);
    const nextActiveId = activate ? id : state.activeId;
    writeStore(opencodeHome, { activeId: nextActiveId, profiles: nextProfiles });
    return await listWorkspaces(opencodeHome);
  }

  async function updateWorkspace(opencodeHome, id, payload = {}) {
    const state = readStore(opencodeHome);
    const profile = state.profiles.find((p) => p.id === id);
    if (!profile) throw new Error(`Unknown workspace profile: ${id}`);

    const label = payload.label !== undefined
      ? normalizeLabel(payload.label, profile.label)
      : profile.label;
    const workspaceId = payload.workspaceId !== undefined
      ? normalizeWorkspaceId(payload.workspaceId)
      : profile.workspaceId;
    if (workspaceId && !isValidWorkspaceId(workspaceId)) {
      throw new Error('workspaceId must match the wrk_... format.');
    }
    const apiKey = typeof payload.apiKey === 'string' && payload.apiKey.trim()
      ? payload.apiKey.trim()
      : null;

    const now = nowProvider();
    const next = {
      ...profile,
      label,
      workspaceId,
      workspaceIdKnown: isValidWorkspaceId(workspaceId),
      consoleUrl: buildConsoleUrl(workspaceId),
      updatedAt: now,
    };
    const nextProfiles = state.profiles.map((p) => (p.id === id ? next : p));
    if (apiKey) {
      await writeKeychainValue(next.keyRef, apiKey);
    }
    writeStore(opencodeHome, { activeId: state.activeId, profiles: nextProfiles });
    return await listWorkspaces(opencodeHome);
  }

  async function activateWorkspace(opencodeHome, id) {
    const state = readStore(opencodeHome);
    const detected = buildDetectedProfiles(opencodeHome);
    const detectedMatch = detected.find((p) => p.id === id);
    const registeredMatch = state.profiles.find((p) => p.id === id);
    if (!detectedMatch && !registeredMatch) {
      throw new Error(`Unknown workspace id: ${id}`);
    }
    if (registeredMatch && !(await readKeychainValue(registeredMatch.keyRef))) {
      throw new Error(`Cannot activate ${id}: no API key in keychain.`);
    }
    writeStore(opencodeHome, { activeId: id, profiles: state.profiles });
    return await listWorkspaces(opencodeHome);
  }

  async function deactivateWorkspace(opencodeHome) {
    const state = readStore(opencodeHome);
    writeStore(opencodeHome, { activeId: null, profiles: state.profiles });
    return await listWorkspaces(opencodeHome);
  }

  async function deleteWorkspace(opencodeHome, id) {
    const state = readStore(opencodeHome);
    const profile = state.profiles.find((p) => p.id === id);
    if (!profile) throw new Error(`Unknown workspace profile: ${id}`);
    await deleteKeychainValue(profile.keyRef);
    const nextProfiles = state.profiles.filter((p) => p.id !== id);
    const nextActiveId = state.activeId === id ? null : state.activeId;
    writeStore(opencodeHome, { activeId: nextActiveId, profiles: nextProfiles });
    return await listWorkspaces(opencodeHome);
  }

  async function validateWorkspace(opencodeHome, id, options = {}) {
    const state = readStore(opencodeHome);
    const detected = buildDetectedProfiles(opencodeHome);
    const detectedMatch = detected.find((p) => p.id === id);
    const registeredMatch = state.profiles.find((p) => p.id === id);
    if (!detectedMatch && !registeredMatch) {
      throw new Error(`Unknown workspace id: ${id}`);
    }
    if (!fetchImpl) {
      throw new Error('fetch is unavailable in this runtime; cannot validate OpenCode Go key.');
    }

    let apiKey = null;
    if (registeredMatch) {
      apiKey = await readKeychainValue(registeredMatch.keyRef);
    } else if (detectedMatch) {
      const envState = detectEnvApiKey(env);
      const nativeState = detectNativeAuth(opencodeHome, env, deps.nativeAuthPath);
      if (detectedMatch.id === 'detected:env:opencode-go') {
        apiKey = env[OPENCODE_GO_API_KEY_ENV];
      } else if (detectedMatch.id === 'detected:native:opencode-go') {
        apiKey = nativeState.key;
      }
      void envState;
    }
    if (!apiKey) {
      const result = {
        status: 'missing-key',
        message: 'No OpenCode Go API key available to validate.',
      };
      recordValidation(opencodeHome, id, result, options);
      return { id, ...result, lastValidatedAt: nowProvider() };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), VALIDATION_TIMEOUT_MS);
    let result;
    try {
      const response = await fetchImpl(VALIDATION_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          model: VALIDATION_MODEL,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
        }),
        signal: controller.signal,
      });
      if (response.status === 401 || response.status === 403) {
        result = { status: 'unauthorized', message: `OpenCode Go rejected the key (HTTP ${response.status}).` };
      } else if (response.status >= 200 && response.status < 300) {
        result = { status: 'ok', message: `Validated against OpenCode Go (HTTP ${response.status}).` };
      } else {
        result = { status: 'error', message: `OpenCode Go responded with HTTP ${response.status}.` };
      }
    } catch (error) {
      result = { status: 'error', message: error instanceof Error ? error.message : String(error) };
    } finally {
      clearTimeout(timer);
    }
    recordValidation(opencodeHome, id, result, options);
    return { id, ...result, lastValidatedAt: nowProvider() };
  }

  function recordValidation(opencodeHome, id, result, options = {}) {
    if (options.skipStoreUpdate) return;
    const state = readStore(opencodeHome);
    const detected = buildDetectedProfiles(opencodeHome);
    const detectedMatch = detected.find((p) => p.id === id);
    if (detectedMatch) return;
    const now = nowProvider();
    const nextProfiles = state.profiles.map((profile) => (
      profile.id === id
        ? {
          ...profile,
          lastValidatedAt: now,
          lastValidationStatus: result.status,
          lastValidationMessage: result.message,
          updatedAt: now,
        }
        : profile
    ));
    writeStore(opencodeHome, { activeId: state.activeId, profiles: nextProfiles });
  }

  async function resolveActiveApiKey(opencodeHome, sources = {}) {
    const state = readStore(opencodeHome);
    if (state.activeId) {
      const profile = state.profiles.find((p) => p.id === state.activeId);
      if (profile) {
        const key = await readKeychainValue(profile.keyRef);
        if (key) {
          return {
            value: key,
            source: KEY_SOURCES.KEYCHAIN,
            profile: buildRedactedProfile(profile, KEY_SOURCES.KEYCHAIN),
          };
        }
      }
    }
    if (sources.allowDetected !== false) {
      const nativeState = detectNativeAuth(opencodeHome, env, deps.nativeAuthPath);
      if (nativeState.key) {
        return { value: nativeState.key, source: KEY_SOURCES.NATIVE_AUTH, profile: null };
      }
      const envState = detectEnvApiKey(env);
      if (envState.present) {
        const value = env[OPENCODE_GO_API_KEY_ENV];
        if (typeof value === 'string' && value.trim()) {
          return { value: value.trim(), source: KEY_SOURCES.ENV, profile: null };
        }
      }
    }
    return { value: undefined, source: KEY_SOURCES.MISSING, profile: null };
  }

  function createDraftProfile(payload = {}) {
    const label = normalizeLabel(payload.label, 'New OpenCode Go workspace');
    const workspaceId = normalizeWorkspaceId(payload.workspaceId);
    const id = workspaceId && isValidWorkspaceId(workspaceId) ? workspaceId : generateLocalId();
    const now = nowProvider();
    return {
      id,
      label,
      workspaceId,
      workspaceIdKnown: isValidWorkspaceId(workspaceId),
      consoleUrl: buildConsoleUrl(workspaceId),
      keyRef: `keychain:${id}`,
      active: false,
      createdAt: now,
      updatedAt: now,
      lastValidatedAt: null,
      lastValidationStatus: null,
      lastValidationMessage: null,
      origin: 'draft',
    };
  }

  return {
    KEYRING_SERVICE_NAME,
    KEY_SOURCES,
    OPENCODE_GO_API_KEY_ENV,
    resolveOpenCodeHome,
    resolveStorePath,
    resolveNativeAuthPath,
    isValidWorkspaceId,
    buildConsoleUrl,
    redactApiKey,
    normalizeStoredProfile,
    readStore,
    writeStore,
    detectEnvApiKey,
    detectNativeAuth,
    listWorkspaces,
    registerWorkspace,
    updateWorkspace,
    activateWorkspace,
    deactivateWorkspace,
    deleteWorkspace,
    validateWorkspace,
    resolveActiveApiKey,
    createDraftProfile,
    _internal: {
      fs: fsImpl,
      path: pathImpl,
      env,
      fetchImpl,
      resolveKeyring,
      readKeychainValue,
      writeKeychainValue,
      deleteKeychainValue,
      buildDetectedProfiles,
    },
  };
}

module.exports = {
  createOpenCodeGoWorkspaces,
  KEYRING_SERVICE_NAME,
  KEY_SOURCES,
  OPENCODE_GO_API_KEY_ENV,
  NATIVE_OPENCODE_GO_PROVIDER,
  VALIDATION_MODEL,
  VALIDATION_URL,
  VALIDATION_TIMEOUT_MS,
  resolveOpenCodeHome,
  resolveStorePath,
  resolveNativeAuthPath,
  isValidWorkspaceId,
  buildConsoleUrl,
  redactApiKey,
  normalizeStoredProfile,
};
