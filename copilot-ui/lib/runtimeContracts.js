'use strict';

const RUNTIME_CONTRACT_VERSION = '1.0.0';

const RUNTIME_MODES = Object.freeze({
  REPO: 'repo',
  PACKAGED: 'packaged',
});

const CAPABILITY_STATES = Object.freeze({
  AVAILABLE: 'available',
  UNAVAILABLE: 'unavailable',
  UNKNOWN: 'unknown',
});

const RUNTIME_PROVIDER_CONTRACT_VERSION = '1';
const RUNTIME_PROVIDERS = Object.freeze({
  NON_DOCKER: 'non-docker',
  DOCKER: 'docker',
});

const RUNTIME_PROVIDER_SELECTION_SOURCES = Object.freeze({
  DEFAULT: 'default',
  EXPLICIT: 'explicit',
});

const SESSION_RECONCILIATION_CONTRACT_VERSION = '1';
const SESSION_RECONCILIATION_SOURCES = Object.freeze({
  RUNTIME: 'runtime',
  ARTIFACT: 'artifact',
});

const SESSION_STATE_AUTHORITIES = Object.freeze({
  RUNTIME: 'acp',
  RUNTIME_ONLY: 'acp-only',
  ARTIFACT: 'fs',
});

const SESSION_RECONCILIATION_SOURCE_PRECEDENCE = Object.freeze({
  [SESSION_RECONCILIATION_SOURCES.RUNTIME]: 2,
  [SESSION_RECONCILIATION_SOURCES.ARTIFACT]: 1,
});

const SESSION_RECONCILIATION_SOURCE_OF_TRUTH = Object.freeze({
  [SESSION_STATE_AUTHORITIES.RUNTIME]: SESSION_RECONCILIATION_SOURCES.RUNTIME,
  [SESSION_STATE_AUTHORITIES.RUNTIME_ONLY]: SESSION_RECONCILIATION_SOURCES.RUNTIME,
  [SESSION_STATE_AUTHORITIES.ARTIFACT]: SESSION_RECONCILIATION_SOURCES.ARTIFACT,
});

const DEFAULT_RUNTIME_MODE = RUNTIME_MODES.REPO;
const DEFAULT_CAPABILITY_STATE = CAPABILITY_STATES.UNKNOWN;
const DEFAULT_RUNTIME_PROVIDER = RUNTIME_PROVIDERS.NON_DOCKER;

const RUNTIME_COMPATIBILITY_CAPABILITIES = Object.freeze([
  'docker',
  'sandbox',
  'wsl2',
]);

function normalizeRuntimeMode(input) {
  if (typeof input !== 'string') return DEFAULT_RUNTIME_MODE;
  const value = input.trim().toLowerCase();
  if (value === RUNTIME_MODES.REPO) return RUNTIME_MODES.REPO;
  if (value === RUNTIME_MODES.PACKAGED) return RUNTIME_MODES.PACKAGED;
  return DEFAULT_RUNTIME_MODE;
}

function normalizeRuntimeProvider(input) {
  if (typeof input !== 'string') return null;
  const value = input.trim().toLowerCase();
  if (!value) return null;
  if (value === RUNTIME_PROVIDERS.NON_DOCKER || value === 'nondocker') {
    return RUNTIME_PROVIDERS.NON_DOCKER;
  }
  if (value === RUNTIME_PROVIDERS.DOCKER) {
    return RUNTIME_PROVIDERS.DOCKER;
  }
  return null;
}

function normalizeSessionReconciliationSource(input) {
  if (typeof input !== 'string') return null;
  const value = input.trim().toLowerCase();
  if (!value) return null;
  if (value === SESSION_RECONCILIATION_SOURCES.RUNTIME) {
    return SESSION_RECONCILIATION_SOURCES.RUNTIME;
  }
  if (value === SESSION_RECONCILIATION_SOURCES.ARTIFACT || value === 'filesystem') {
    return SESSION_RECONCILIATION_SOURCES.ARTIFACT;
  }
  return null;
}

function getSessionReconciliationSourcePrecedence(input) {
  const normalized = normalizeSessionReconciliationSource(input);
  return normalized ? SESSION_RECONCILIATION_SOURCE_PRECEDENCE[normalized] || 0 : 0;
}

function hasStatePresence(explicitPresence, stateValue) {
  if (explicitPresence === true) return true;
  if (explicitPresence === false) return false;
  return stateValue !== null && stateValue !== undefined;
}

function resolveSessionReconciliationAuthority(input) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};

  const hasRuntimeState = hasStatePresence(source.hasRuntimeState, source.runtimeState);
  const hasArtifactState = hasStatePresence(source.hasArtifactState, source.artifactState);

  let authority = SESSION_STATE_AUTHORITIES.ARTIFACT;
  if (hasRuntimeState && hasArtifactState) {
    authority = SESSION_STATE_AUTHORITIES.RUNTIME;
  } else if (hasRuntimeState) {
    authority = SESSION_STATE_AUTHORITIES.RUNTIME_ONLY;
  }

  const sourcePrecedence = [];
  if (hasRuntimeState) {
    sourcePrecedence.push(SESSION_RECONCILIATION_SOURCES.RUNTIME);
  }
  if (hasArtifactState) {
    sourcePrecedence.push(SESSION_RECONCILIATION_SOURCES.ARTIFACT);
  }
  if (!sourcePrecedence.length) {
    sourcePrecedence.push(SESSION_RECONCILIATION_SOURCES.ARTIFACT);
  }

  sourcePrecedence.sort((a, b) => {
    const precedenceDiff = getSessionReconciliationSourcePrecedence(b) - getSessionReconciliationSourcePrecedence(a);
    if (precedenceDiff !== 0) {
      return precedenceDiff;
    }
    return a.localeCompare(b);
  });

  return {
    contractVersion: SESSION_RECONCILIATION_CONTRACT_VERSION,
    deterministic: true,
    authority,
    sourceOfTruth: SESSION_RECONCILIATION_SOURCE_OF_TRUTH[authority],
    sourcePrecedence,
    hasRuntimeState,
    hasArtifactState,
  };
}

function buildRuntimeProviderMetadata(input) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const defaultProvider = normalizeRuntimeProvider(source.defaultProvider) || DEFAULT_RUNTIME_PROVIDER;
  const explicitSelection = normalizeRuntimeProvider(source.selectedProvider);

  return {
    contractVersion: RUNTIME_PROVIDER_CONTRACT_VERSION,
    selectedProvider: explicitSelection || defaultProvider,
    defaultProvider,
    selectionSource: explicitSelection
      ? RUNTIME_PROVIDER_SELECTION_SOURCES.EXPLICIT
      : RUNTIME_PROVIDER_SELECTION_SOURCES.DEFAULT,
  };
}

function normalizeCapabilityState(input) {
  if (typeof input !== 'string') return DEFAULT_CAPABILITY_STATE;
  const value = input.trim().toLowerCase();
  if (value === CAPABILITY_STATES.AVAILABLE) return CAPABILITY_STATES.AVAILABLE;
  if (value === CAPABILITY_STATES.UNAVAILABLE) return CAPABILITY_STATES.UNAVAILABLE;
  if (value === CAPABILITY_STATES.UNKNOWN) return CAPABILITY_STATES.UNKNOWN;
  return DEFAULT_CAPABILITY_STATE;
}

function normalizeCapabilities(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {};
  }

  const normalized = {};
  const keys = Object.keys(input).sort((a, b) => a.localeCompare(b));

  for (const key of keys) {
    const normalizedKey = String(key).trim();
    if (!normalizedKey) continue;
    normalized[normalizedKey] = normalizeCapabilityState(input[key]);
  }

  return normalized;
}

function detectRuntimeMode(input) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};

  if (typeof source.explicitMode === 'string' && source.explicitMode.trim()) {
    return normalizeRuntimeMode(source.explicitMode);
  }

  if (source.isPackaged === true) {
    return RUNTIME_MODES.PACKAGED;
  }

  const engineRoot = typeof source.engineRoot === 'string' ? source.engineRoot.toLowerCase() : '';
  if (engineRoot.includes('app.asar')) {
    return RUNTIME_MODES.PACKAGED;
  }

  return DEFAULT_RUNTIME_MODE;
}

function buildCompatibilityCapabilities(input) {
  const normalized = normalizeCapabilities(input);
  const merged = {};

  for (const capability of RUNTIME_COMPATIBILITY_CAPABILITIES) {
    merged[capability] = Object.prototype.hasOwnProperty.call(normalized, capability)
      ? normalized[capability]
      : DEFAULT_CAPABILITY_STATE;
  }

  for (const [key, value] of Object.entries(normalized)) {
    if (Object.prototype.hasOwnProperty.call(merged, key)) continue;
    merged[key] = value;
  }

  return normalizeCapabilities(merged);
}

function buildRuntimeContract(input) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};

  return {
    contractVersion: RUNTIME_CONTRACT_VERSION,
    mode: normalizeRuntimeMode(source.mode),
    capabilities: normalizeCapabilities(source.capabilities),
    provider: buildRuntimeProviderMetadata({
      selectedProvider: source.selectedProvider,
      defaultProvider: source.defaultProvider,
    }),
  };
}

function buildCompatibilityRuntimeContract(input) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};

  return {
    contractVersion: RUNTIME_CONTRACT_VERSION,
    mode: detectRuntimeMode({
      explicitMode: source.mode,
      isPackaged: source.isPackaged,
      engineRoot: source.engineRoot,
    }),
    capabilities: buildCompatibilityCapabilities(source.capabilities),
    provider: buildRuntimeProviderMetadata({
      selectedProvider: source.selectedProvider,
      defaultProvider: source.defaultProvider,
    }),
  };
}

module.exports = {
  RUNTIME_CONTRACT_VERSION,
  RUNTIME_MODES,
  CAPABILITY_STATES,
  RUNTIME_PROVIDER_CONTRACT_VERSION,
  RUNTIME_PROVIDERS,
  RUNTIME_PROVIDER_SELECTION_SOURCES,
  SESSION_RECONCILIATION_CONTRACT_VERSION,
  SESSION_RECONCILIATION_SOURCES,
  SESSION_RECONCILIATION_SOURCE_PRECEDENCE,
  SESSION_RECONCILIATION_SOURCE_OF_TRUTH,
  SESSION_STATE_AUTHORITIES,
  RUNTIME_COMPATIBILITY_CAPABILITIES,
  DEFAULT_RUNTIME_MODE,
  DEFAULT_CAPABILITY_STATE,
  DEFAULT_RUNTIME_PROVIDER,
  normalizeRuntimeMode,
  normalizeRuntimeProvider,
  normalizeSessionReconciliationSource,
  getSessionReconciliationSourcePrecedence,
  normalizeCapabilityState,
  normalizeCapabilities,
  detectRuntimeMode,
  buildRuntimeProviderMetadata,
  resolveSessionReconciliationAuthority,
  buildCompatibilityCapabilities,
  buildRuntimeContract,
  buildCompatibilityRuntimeContract,
};