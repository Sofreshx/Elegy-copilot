'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const KEYRING_SERVICE_NAME = 'elegy-copilot.elegy-copilot.opencode-go';
const STORE_FILENAME = '.elegy-opencode-go-workspaces.json';
const LOCAL_KEYS_FILENAME = '.elegy-opencode-go-workspace-keys.json';
const NATIVE_AUTH_FILENAME = 'auth.json';
const NATIVE_OPENCODE_GO_PROVIDER = 'opencode-go';
const OPENCODE_GO_API_KEY_ENV = 'OPENCODE_GO_API_KEY';
const VALIDATION_MODEL = 'kimi-k2.6';
const VALIDATION_URL = 'https://opencode.ai/zen/go/v1/chat/completions';
const VALIDATION_TIMEOUT_MS = 8000;

const KEY_SOURCES = Object.freeze({
  KEYCHAIN: 'keychain',
  LOCAL_FILE: 'local-file',
  ENV: 'env',
  NATIVE_AUTH: 'opencode-auth',
  MISSING: 'missing',
});

const SELECTION_MODES = Object.freeze({
  AUTO: 'auto',
  EXPLICIT: 'explicit',
  NONE: 'none',
});

function resolveOpenCodeHome(opencodeHome) {
  return path.resolve(opencodeHome || path.join(os.homedir(), '.config', 'opencode'));
}

function resolveStorePath(opencodeHome) {
  return path.join(resolveOpenCodeHome(opencodeHome), STORE_FILENAME);
}

function resolveLocalKeysPath(opencodeHome) {
  return path.join(resolveOpenCodeHome(opencodeHome), LOCAL_KEYS_FILENAME);
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
    try {
      fs.chmodSync(tempPath, 0o600);
    } catch {
      // Windows and some filesystems may not honor POSIX file modes.
    }
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

function isDetectedId(id) {
  return typeof id === 'string' && (id === 'detected:env:opencode-go' || id === 'detected:native:opencode-go');
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
    lastValidatedStatus: typeof input.lastValidatedStatus === 'string'
      ? input.lastValidatedStatus
      : (typeof input.lastValidationStatus === 'string'
        ? input.lastValidationStatus
        : null),
    lastValidatedMessage: typeof input.lastValidatedMessage === 'string'
      ? input.lastValidatedMessage
      : (typeof input.lastValidationMessage === 'string'
        ? input.lastValidationMessage
        : null),
  };
}

function readStore(opencodeHome) {
  const storePath = resolveStorePath(opencodeHome);
  const raw = readJsonFile(storePath);
  if (!raw || typeof raw !== 'object') {
    return { activeId: null, profiles: [], poolEnabled: false, poolWorkspaceIds: [], selectionMode: SELECTION_MODES.AUTO };
  }
  const profiles = Array.isArray(raw.profiles)
    ? raw.profiles.map((p) => normalizeStoredProfile(p)).filter(Boolean)
    : [];
  const activeId = typeof raw.activeId === 'string' && (
    profiles.some((p) => p.id === raw.activeId) || isDetectedId(raw.activeId)
  ) ? raw.activeId : null;
  const selectionMode = [SELECTION_MODES.AUTO, SELECTION_MODES.EXPLICIT, SELECTION_MODES.NONE].includes(raw.selectionMode)
    ? raw.selectionMode
    : (raw.activeId ? SELECTION_MODES.EXPLICIT : SELECTION_MODES.AUTO);
  return {
    activeId,
    profiles,
    poolEnabled: raw.poolEnabled === true,
    poolWorkspaceIds: Array.isArray(raw.poolWorkspaceIds) ? raw.poolWorkspaceIds : [],
    selectionMode,
  };
}

function readLocalKeyStore(opencodeHome) {
  const raw = readJsonFile(resolveLocalKeysPath(opencodeHome));
  if (!raw || typeof raw !== 'object' || !raw.keys || typeof raw.keys !== 'object') {
    return { version: 1, keys: {} };
  }
  const keys = {};
  for (const [account, value] of Object.entries(raw.keys)) {
    if (typeof account === 'string' && typeof value === 'string' && value.trim()) {
      keys[account] = value.trim();
    }
  }
  return { version: 1, keys };
}

function writeLocalKeyStore(opencodeHome, keyStore) {
  writeJsonAtomic(resolveLocalKeysPath(opencodeHome), {
    version: 1,
    keys: keyStore && typeof keyStore.keys === 'object' ? keyStore.keys : {},
  });
}

function writeStore(opencodeHome, state) {
  const activeId = state.activeId && (
    state.profiles.some((p) => p.id === state.activeId) || isDetectedId(state.activeId)
  ) ? state.activeId : null;
  const profiles = state.profiles.map((profile) => ({
    ...profile,
    active: profile.id === activeId,
  }));
  const selectionMode = [SELECTION_MODES.AUTO, SELECTION_MODES.EXPLICIT, SELECTION_MODES.NONE].includes(state.selectionMode)
    ? state.selectionMode
    : SELECTION_MODES.AUTO;
  writeJsonAtomic(resolveStorePath(opencodeHome), {
    activeId,
    profiles,
    poolEnabled: state.poolEnabled === true,
    poolWorkspaceIds: Array.isArray(state.poolWorkspaceIds) ? state.poolWorkspaceIds : [],
    selectionMode,
  });
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

function readNativeAuthFile(env = process.env, nativeAuthPath = null) {
  const authPath = nativeAuthPath || resolveNativeAuthPath(env);
  const raw = readJsonFile(authPath);
  return {
    authPath,
    data: raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {},
  };
}

function writeNativeOpenCodeGoAuth(env = process.env, nativeAuthPath = null, apiKey, workspaceId = null) {
  const { authPath, data } = readNativeAuthFile(env, nativeAuthPath);
  const existing = data[NATIVE_OPENCODE_GO_PROVIDER];
  const nextEntry = existing && typeof existing === 'object' && !Array.isArray(existing)
    ? { ...existing }
    : {};
  nextEntry.type = typeof nextEntry.type === 'string' ? nextEntry.type : 'api';
  nextEntry.key = apiKey;
  if (isValidWorkspaceId(workspaceId)) {
    nextEntry.workspaceId = workspaceId;
  }
  data[NATIVE_OPENCODE_GO_PROVIDER] = nextEntry;
  writeJsonAtomic(authPath, data);
  return { authPath };
}

function extractWorkspaceIdFromText(value) {
  if (typeof value !== 'string' || !value) return null;
  const match = value.match(/(?:\/workspace\/|workspace[/=: ]+|workspaceId["':=\s]+|workspace_id["':=\s]+)(wrk_[A-Za-z0-9_-]+)/i)
    || value.match(/\b(wrk_[A-Za-z0-9_-]+)\b/);
  return match && isValidWorkspaceId(match[1]) ? match[1] : null;
}

function extractWorkspaceIdFromUnknown(value, seen = new Set()) {
  if (typeof value === 'string') return extractWorkspaceIdFromText(value);
  if (!value || typeof value !== 'object' || seen.has(value)) return null;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractWorkspaceIdFromUnknown(item, seen);
      if (found) return found;
    }
    return null;
  }
  for (const [key, item] of Object.entries(value)) {
    if (/workspace/i.test(key)) {
      const direct = extractWorkspaceIdFromUnknown(item, seen);
      if (direct) return direct;
    }
  }
  for (const item of Object.values(value)) {
    const found = extractWorkspaceIdFromUnknown(item, seen);
    if (found) return found;
  }
  return null;
}

function buildRedactedProfile(profile, source, nativeState = null, storedValue = null, active = false) {
  const appliedToNativeAuth = Boolean(
    storedValue
      && nativeState
      && nativeState.key
      && nativeState.key === storedValue,
  );
  return {
    id: profile.id,
    label: profile.label,
    workspaceId: profile.workspaceId,
    workspaceIdKnown: profile.workspaceIdKnown,
    consoleUrl: profile.consoleUrl,
    keyRef: profile.keyRef,
    keyPresent: source === KEY_SOURCES.KEYCHAIN
      || source === KEY_SOURCES.LOCAL_FILE
      || source === KEY_SOURCES.ENV
      || source === KEY_SOURCES.NATIVE_AUTH,
    keySource: source,
    active: Boolean(active),
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
    lastValidatedAt: profile.lastValidatedAt,
    lastValidatedStatus: profile.lastValidatedStatus,
    lastValidatedMessage: profile.lastValidatedMessage,
    canApplyNative: source === KEY_SOURCES.KEYCHAIN || source === KEY_SOURCES.LOCAL_FILE,
    appliedToNativeAuth,
    origin: 'registered',
  };
}

function buildImportedProfile({ id, label, workspaceId, source, appliedToNativeAuth = false, active = false }) {
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
    active: Boolean(active),
    createdAt: now,
    updatedAt: now,
    lastValidatedAt: null,
    lastValidatedStatus: null,
    lastValidatedMessage: null,
  };
  return {
    ...profile,
    keyPresent: source === KEY_SOURCES.ENV || source === KEY_SOURCES.NATIVE_AUTH,
    keySource: source,
    canApplyNative: source === KEY_SOURCES.NATIVE_AUTH,
    appliedToNativeAuth,
    origin: 'detected',
  };
}

function effectiveActiveId(state, detectedIds, selectionMode = SELECTION_MODES.AUTO, options = {}) {
  if (selectionMode === SELECTION_MODES.NONE) return null;
  if (selectionMode === SELECTION_MODES.EXPLICIT) {
    if (state.activeId && (state.profiles.some((p) => p.id === state.activeId) || (isDetectedId(state.activeId) && detectedIds.includes(state.activeId)))) {
      return state.activeId;
    }
    return null;
  }
  const nativeState = options.nativeState || null;
  const profileKeys = Array.isArray(options.profileKeys) ? options.profileKeys : [];
  if (nativeState && nativeState.key) {
    const nativeMatch = profileKeys.find((entry) => entry && entry.value === nativeState.key);
    if (nativeMatch && nativeMatch.id) {
      return nativeMatch.id;
    }
    if (detectedIds.includes('detected:native:opencode-go')) {
      return 'detected:native:opencode-go';
    }
  }
  if (detectedIds.includes('detected:env:opencode-go')) return 'detected:env:opencode-go';
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

  function readLocalKeyValue(opencodeHome, account) {
    const keyStore = readLocalKeyStore(opencodeHome);
    const value = keyStore.keys[account];
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  function writeLocalKeyValue(opencodeHome, account, value) {
    const keyStore = readLocalKeyStore(opencodeHome);
    keyStore.keys[account] = value;
    writeLocalKeyStore(opencodeHome, keyStore);
  }

  function deleteLocalKeyValue(opencodeHome, account) {
    const keyStore = readLocalKeyStore(opencodeHome);
    if (!Object.prototype.hasOwnProperty.call(keyStore.keys, account)) return false;
    delete keyStore.keys[account];
    writeLocalKeyStore(opencodeHome, keyStore);
    return true;
  }

  async function readStoredApiKey(opencodeHome, account) {
    const keychainValue = await readKeychainValue(account);
    if (keychainValue) {
      return { value: keychainValue, source: KEY_SOURCES.KEYCHAIN };
    }
    const localValue = readLocalKeyValue(opencodeHome, account);
    if (localValue) {
      return { value: localValue, source: KEY_SOURCES.LOCAL_FILE };
    }
    return { value: null, source: KEY_SOURCES.MISSING };
  }

  async function writeKeychainValue(account, value) {
    const keyring = await resolveKeyring();
    if (!keyring) {
      throw new Error('OS keychain is unavailable in this runtime; cannot store OpenCode Go API key.');
    }
    await keyring.setPassword(KEYRING_SERVICE_NAME, account, value);
  }

  async function writeStoredApiKey(opencodeHome, account, value) {
    try {
      await writeKeychainValue(account, value);
      return KEY_SOURCES.KEYCHAIN;
    } catch {
      writeLocalKeyValue(opencodeHome, account, value);
      return KEY_SOURCES.LOCAL_FILE;
    }
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

  async function deleteStoredApiKey(opencodeHome, account) {
    const keychainDeleted = await deleteKeychainValue(account);
    const localDeleted = deleteLocalKeyValue(opencodeHome, account);
    return keychainDeleted || localDeleted;
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
        appliedToNativeAuth: true,
      }));
    }
    return detected;
  }

  async function listWorkspaces(opencodeHome) {
    const state = readStore(opencodeHome);
    const nativeState = detectNativeAuth(opencodeHome, env, deps.nativeAuthPath);
    const detected = buildDetectedProfiles(opencodeHome);
    const detectedIds = new Set(detected.map((p) => p.id));

    const registeredCandidates = await Promise.all(state.profiles.map(async (profile) => {
      const stored = await readStoredApiKey(opencodeHome, profile.keyRef);
      return { profile, stored };
    }));

    const activeId = effectiveActiveId(state, [...detectedIds], state.selectionMode, {
      nativeState,
      profileKeys: registeredCandidates.map(({ profile, stored }) => ({
        id: profile.id,
        value: stored.value,
      })),
    });
    const registered = registeredCandidates.map(({ profile, stored }) => buildRedactedProfile(
      profile,
      stored.source,
      nativeState,
      stored.value,
      profile.id === activeId,
    ));
    const detectedWithActive = detected.map((profile) => ({
      ...profile,
      active: profile.id === activeId,
    }));
    const activeRegistered = registered.find((p) => p.id === activeId);
    const activeDetected = detectedWithActive.find((p) => p.id === activeId);
    const appliedToNativeAuth = Boolean(
      (activeRegistered && activeRegistered.appliedToNativeAuth)
        || (activeDetected && activeDetected.id === 'detected:native:opencode-go' && nativeState.present),
    );

    const orderedRegistered = registered.slice().sort((a, b) => {
      if (a.active && !b.active) return -1;
      if (!a.active && b.active) return 1;
      return a.label.localeCompare(b.label);
    });
    const orderedDetected = detectedWithActive.slice().sort((a, b) => a.label.localeCompare(b.label));

    return {
      activeId,
      detectedActiveId: activeId,
      serviceName: KEYRING_SERVICE_NAME,
      storePath: resolveStorePath(opencodeHome),
      nativeAuthPath: nativeState.authPath,
      appliedToNativeAuth,
      registered: orderedRegistered,
      detected: orderedDetected,
      selectionMode: state.selectionMode,
    };
  }

  async function registerWorkspace(opencodeHome, payload = {}) {
    const state = readStore(opencodeHome);
    const label = normalizeLabel(payload.label, null);
    const workspaceId = normalizeWorkspaceId(payload.workspaceId);
    const requestedId = typeof payload.id === 'string' && payload.id.trim() ? payload.id.trim() : null;
    const sourceId = typeof payload.sourceId === 'string' && payload.sourceId.trim() ? payload.sourceId.trim() : null;
    const apiKey = typeof payload.apiKey === 'string' && payload.apiKey.trim()
      ? payload.apiKey.trim()
      : null;
    let resolvedApiKey = apiKey;
    const activate = payload.activate !== false;
    const now = nowProvider();

    if (!label) throw new Error('label is required.');
    if (workspaceId && !isValidWorkspaceId(workspaceId)) {
      throw new Error('workspaceId must match the wrk_... format.');
    }
    if (!resolvedApiKey && sourceId === 'detected:native:opencode-go') {
      const nativeState = detectNativeAuth(opencodeHome, env, deps.nativeAuthPath);
      resolvedApiKey = nativeState.key;
    } else if (!resolvedApiKey && sourceId === 'detected:env:opencode-go') {
      const envValue = env[OPENCODE_GO_API_KEY_ENV];
      resolvedApiKey = typeof envValue === 'string' && envValue.trim() ? envValue.trim() : null;
    }
    if (!resolvedApiKey) {
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

    await writeStoredApiKey(opencodeHome, profile.keyRef, resolvedApiKey);
    const nextProfiles = state.profiles.filter((p) => p.id !== id).concat(profile);
    const nextActiveId = activate ? id : state.activeId;
    if (activate) {
      writeNativeOpenCodeGoAuth(env, deps.nativeAuthPath, resolvedApiKey, workspaceId);
    }
    writeStore(opencodeHome, {
      activeId: nextActiveId,
      profiles: nextProfiles,
      poolEnabled: state.poolEnabled,
      poolWorkspaceIds: state.poolWorkspaceIds,
      selectionMode: activate ? SELECTION_MODES.EXPLICIT : state.selectionMode,
    });
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
      await writeStoredApiKey(opencodeHome, next.keyRef, apiKey);
    }
    writeStore(opencodeHome, { activeId: state.activeId, profiles: nextProfiles, poolEnabled: state.poolEnabled, poolWorkspaceIds: state.poolWorkspaceIds, selectionMode: state.selectionMode });
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
    if (registeredMatch) {
      const stored = await readStoredApiKey(opencodeHome, registeredMatch.keyRef);
      if (!stored.value) {
        throw new Error(`Cannot activate ${id}: no API key is stored.`);
      }
      writeNativeOpenCodeGoAuth(env, deps.nativeAuthPath, stored.value, registeredMatch.workspaceId);
    }
    writeStore(opencodeHome, { activeId: id, profiles: state.profiles, poolEnabled: state.poolEnabled, poolWorkspaceIds: state.poolWorkspaceIds, selectionMode: SELECTION_MODES.EXPLICIT });
    return await listWorkspaces(opencodeHome);
  }

  async function deactivateWorkspace(opencodeHome) {
    const state = readStore(opencodeHome);
    writeStore(opencodeHome, { activeId: null, profiles: state.profiles, poolEnabled: state.poolEnabled, poolWorkspaceIds: state.poolWorkspaceIds, selectionMode: SELECTION_MODES.NONE });
    return await listWorkspaces(opencodeHome);
  }

  async function setAutoMode(opencodeHome) {
    const state = readStore(opencodeHome);
    writeStore(opencodeHome, { activeId: null, profiles: state.profiles, poolEnabled: state.poolEnabled, poolWorkspaceIds: state.poolWorkspaceIds, selectionMode: SELECTION_MODES.AUTO });
    return await listWorkspaces(opencodeHome);
  }

  async function deleteWorkspace(opencodeHome, id) {
    const state = readStore(opencodeHome);
    const profile = state.profiles.find((p) => p.id === id);
    if (!profile) throw new Error(`Unknown workspace profile: ${id}`);
    await deleteStoredApiKey(opencodeHome, profile.keyRef);
    const nextProfiles = state.profiles.filter((p) => p.id !== id);
    const nextActiveId = state.activeId === id ? null : state.activeId;
    const isActive = state.activeId === id;
    writeStore(opencodeHome, {
      activeId: nextActiveId,
      profiles: nextProfiles,
      poolEnabled: state.poolEnabled,
      poolWorkspaceIds: state.poolWorkspaceIds,
      selectionMode: isActive ? SELECTION_MODES.NONE : state.selectionMode,
    });
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
      apiKey = (await readStoredApiKey(opencodeHome, registeredMatch.keyRef)).value;
    } else if (detectedMatch) {
      const envState = detectEnvApiKey(env);
      const nativeState = detectNativeAuth(opencodeHome, env, deps.nativeAuthPath);
      if (detectedMatch.id === 'detected:env:opencode-go') {
        apiKey = env[OPENCODE_GO_API_KEY_ENV];
      } else if (detectedMatch.id === 'detected:native:opencode-go') {
        apiKey = nativeState.key;
      }
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
      let responseText = '';
      if (response && typeof response.text === 'function') {
        try {
          responseText = await response.text();
        } catch {
          responseText = '';
        }
      }
      let responseJson = null;
      if (responseText) {
        try {
          responseJson = JSON.parse(responseText);
        } catch {
          responseJson = null;
        }
      } else if (response && typeof response.json === 'function') {
        try {
          responseJson = await response.json();
        } catch {
          responseJson = null;
        }
      }
      const discoveredWorkspaceId = extractWorkspaceIdFromText(responseText)
        || extractWorkspaceIdFromUnknown(responseJson);
      if (response.status === 401 || response.status === 403) {
        result = { status: 'unauthorized', message: `OpenCode Go rejected the key (HTTP ${response.status}).`, workspaceId: discoveredWorkspaceId };
      } else if (response.status >= 200 && response.status < 300) {
        result = { status: 'ok', message: `Validated against OpenCode Go (HTTP ${response.status}).`, workspaceId: discoveredWorkspaceId };
      } else {
        result = { status: 'error', message: `OpenCode Go responded with HTTP ${response.status}.`, workspaceId: discoveredWorkspaceId };
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
          workspaceId: isValidWorkspaceId(result.workspaceId) ? result.workspaceId : profile.workspaceId,
          workspaceIdKnown: isValidWorkspaceId(result.workspaceId) ? true : profile.workspaceIdKnown,
          consoleUrl: isValidWorkspaceId(result.workspaceId) ? buildConsoleUrl(result.workspaceId) : profile.consoleUrl,
          lastValidatedAt: now,
          lastValidatedStatus: result.status,
          lastValidatedMessage: result.message,
          updatedAt: now,
        }
        : profile
    ));
    writeStore(opencodeHome, { activeId: state.activeId, profiles: nextProfiles, poolEnabled: state.poolEnabled, poolWorkspaceIds: state.poolWorkspaceIds, selectionMode: state.selectionMode });
  }

  async function resolveActiveApiKey(opencodeHome, sources = {}) {
    const state = readStore(opencodeHome);
    const mode = state.selectionMode || SELECTION_MODES.AUTO;

    if (mode === SELECTION_MODES.NONE) {
      return { value: undefined, source: KEY_SOURCES.MISSING, profile: null };
    }

    if (mode === SELECTION_MODES.EXPLICIT && state.activeId) {
      const profile = state.profiles.find((p) => p.id === state.activeId);
      if (profile) {
        const stored = await readStoredApiKey(opencodeHome, profile.keyRef);
        if (stored.value) {
          return {
            value: stored.value,
            source: stored.source,
            profile: buildRedactedProfile(profile, stored.source, null, stored.value, true),
          };
        }
        return { value: undefined, source: KEY_SOURCES.MISSING, profile: null };
      }
    }

    if (mode === SELECTION_MODES.EXPLICIT && state.activeId) {
      const detectedIds = ['detected:env:opencode-go', 'detected:native:opencode-go'];
      if (detectedIds.includes(state.activeId)) {
        if (state.activeId === 'detected:native:opencode-go') {
          const nativeState = detectNativeAuth(opencodeHome, env, deps.nativeAuthPath);
          if (nativeState.key) {
            return { value: nativeState.key, source: KEY_SOURCES.NATIVE_AUTH, profile: null };
          }
        }
        if (state.activeId === 'detected:env:opencode-go') {
          const envValue = env[OPENCODE_GO_API_KEY_ENV];
          if (typeof envValue === 'string' && envValue.trim()) {
            return { value: envValue.trim(), source: KEY_SOURCES.ENV, profile: null };
          }
        }
        return { value: undefined, source: KEY_SOURCES.MISSING, profile: null };
      }
    }

    if (mode === SELECTION_MODES.EXPLICIT) {
      return { value: undefined, source: KEY_SOURCES.MISSING, profile: null };
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
      lastValidatedStatus: null,
      lastValidatedMessage: null,
      origin: 'draft',
    };
  }

  // --- Workspace Pool ---

  function getPool(opencodeHome) {
    const state = readStore(opencodeHome);
    return {
      enabled: state.poolEnabled === true,
      workspaceIds: Array.isArray(state.poolWorkspaceIds) ? state.poolWorkspaceIds : [],
    };
  }

  function setPool(opencodeHome, payload = {}) {
    const state = readStore(opencodeHome);
    const enabled = payload.enabled !== undefined ? Boolean(payload.enabled) : (state.poolEnabled === true);
    const workspaceIds = Array.isArray(payload.workspaceIds)
      ? payload.workspaceIds.filter((id) => typeof id === 'string' && state.profiles.some((p) => p.id === id))
      : (state.poolWorkspaceIds || []);

    writeStore(opencodeHome, {
      ...state,
      poolEnabled: enabled,
      poolWorkspaceIds: workspaceIds,
    });

    return getPool(opencodeHome);
  }

  async function validatePool(opencodeHome) {
    const pool = getPool(opencodeHome);
    const results = [];
    for (const id of pool.workspaceIds) {
      try {
        const result = await validateWorkspace(opencodeHome, id, { skipStoreUpdate: false });
        results.push({ id, status: result.status, message: result.message });
      } catch (err) {
        results.push({ id, status: 'error', message: err.message || String(err) });
      }
    }
    return { pool: pool.workspaceIds, results };
  }

  return {
    KEYRING_SERVICE_NAME,
    KEY_SOURCES,
    SELECTION_MODES,
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
    setAutoMode,
    deleteWorkspace,
    validateWorkspace,
    resolveActiveApiKey,
    createDraftProfile,
    getPool,
    setPool,
    validatePool,
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
      readNativeAuthFile,
      writeNativeOpenCodeGoAuth,
      extractWorkspaceIdFromText,
    },
  };
}

module.exports = {
  createOpenCodeGoWorkspaces,
  KEYRING_SERVICE_NAME,
  KEY_SOURCES,
  SELECTION_MODES,
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
  extractWorkspaceIdFromText,
};
