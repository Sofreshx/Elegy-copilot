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

const DEFAULT_RUNTIME_MODE = RUNTIME_MODES.REPO;
const DEFAULT_CAPABILITY_STATE = CAPABILITY_STATES.UNKNOWN;

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
  };
}

module.exports = {
  RUNTIME_CONTRACT_VERSION,
  RUNTIME_MODES,
  CAPABILITY_STATES,
  RUNTIME_COMPATIBILITY_CAPABILITIES,
  DEFAULT_RUNTIME_MODE,
  DEFAULT_CAPABILITY_STATE,
  normalizeRuntimeMode,
  normalizeCapabilityState,
  normalizeCapabilities,
  detectRuntimeMode,
  buildCompatibilityCapabilities,
  buildRuntimeContract,
  buildCompatibilityRuntimeContract,
};