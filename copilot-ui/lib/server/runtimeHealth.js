'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const {
  CAPABILITY_STATES,
  RUNTIME_PROVIDER_SELECTION_SOURCES,
  normalizeCapabilityState,
  buildCompatibilityRuntimeContract,
} = require('../runtimeContracts');
const {
  buildPlanningProviderStatePersistencePayload,
  readPlanningProviderState,
} = require('../planningPersistence');
const { buildFinishCompatibilityHookContract } = require('../planningApiContracts');

function resolveForcedCapabilityState(capabilityName, env = process.env) {
  const key = `INSTRUCTION_ENGINE_FORCE_${String(capabilityName || '').trim().toUpperCase()}_STATE`;
  const raw = env[key];
  if (!raw || !raw.trim()) return null;
  return normalizeCapabilityState(raw);
}

function probeCapability(command, args, timeoutMs = 1500, options = {}) {
  const childProcessModule = options.childProcessModule || childProcess;
  try {
    const result = childProcessModule.spawnSync(command, args, {
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

function detectDockerCapability(options = {}) {
  const env = options.env && typeof options.env === 'object' ? options.env : process.env;
  const forced = resolveForcedCapabilityState('docker', env);
  if (forced) return forced;
  return probeCapability(
    'docker',
    ['version', '--format', '{{.Server.Version}}'],
    Number.isFinite(options.timeoutMs) ? Number(options.timeoutMs) : 1500,
    options
  );
}

function detectWsl2Capability(options = {}) {
  const env = options.env && typeof options.env === 'object' ? options.env : process.env;
  const processObject = options.processObject || process;
  const forced = resolveForcedCapabilityState('wsl2', env);
  if (forced) return forced;
  if (processObject.platform !== 'win32') return CAPABILITY_STATES.UNKNOWN;
  return probeCapability(
    'wsl.exe',
    ['--status'],
    Number.isFinite(options.timeoutMs) ? Number(options.timeoutMs) : 1500,
    options
  );
}

function detectSandboxCapability(dockerCapability, sandboxesHome, options = {}) {
  const env = options.env && typeof options.env === 'object' ? options.env : process.env;
  const fsModule = options.fsModule || fs;
  const pathModule = options.pathModule || path;
  const forced = resolveForcedCapabilityState('sandbox', env);
  if (forced) return forced;

  if (dockerCapability !== CAPABILITY_STATES.AVAILABLE) {
    return CAPABILITY_STATES.UNAVAILABLE;
  }

  if (typeof sandboxesHome !== 'string' || !sandboxesHome.trim()) {
    return CAPABILITY_STATES.UNAVAILABLE;
  }

  try {
    const sandboxesHomeAbs = pathModule.resolve(sandboxesHome);
    fsModule.mkdirSync(sandboxesHomeAbs, { recursive: true });
    fsModule.accessSync(sandboxesHomeAbs, fs.constants.R_OK | fs.constants.W_OK);
    return CAPABILITY_STATES.AVAILABLE;
  } catch {
    return CAPABILITY_STATES.UNAVAILABLE;
  }
}

function createRuntimeHealthResolver(options = {}) {
  const env = options.env && typeof options.env === 'object' ? options.env : process.env;
  const cacheTtlMs = Number.isFinite(options.cacheTtlMs) ? Number(options.cacheTtlMs) : 15_000;
  let runtimeHealthCache = {
    expiresAtMs: 0,
    value: null,
  };

  return function getRuntimeHealth({ engineRoot, sandboxesHome, providerState }) {
    const now = Date.now();
    if (runtimeHealthCache.value && now < runtimeHealthCache.expiresAtMs) {
      return runtimeHealthCache.value;
    }

    const docker = detectDockerCapability({
      env,
      childProcessModule: options.childProcessModule,
      timeoutMs: options.timeoutMs,
    });
    const wsl2 = detectWsl2Capability({
      env,
      processObject: options.processObject,
      childProcessModule: options.childProcessModule,
      timeoutMs: options.timeoutMs,
    });
    const sandbox = detectSandboxCapability(docker, sandboxesHome, {
      env,
      fsModule: options.fsModule,
      pathModule: options.pathModule,
    });
    const resolvedProviderState = readPlanningProviderState({
      persistedState: providerState,
      env,
    });
    const canonicalProviderState = buildPlanningProviderStatePersistencePayload(resolvedProviderState);

    const runtime = buildCompatibilityRuntimeContract({
      mode: env.INSTRUCTION_ENGINE_RUNTIME_MODE,
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
      expiresAtMs: now + cacheTtlMs,
    };

    return runtime;
  };
}

module.exports = {
  resolveForcedCapabilityState,
  probeCapability,
  detectDockerCapability,
  detectWsl2Capability,
  detectSandboxCapability,
  createRuntimeHealthResolver,
};
