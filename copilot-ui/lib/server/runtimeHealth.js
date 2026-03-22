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

const GITHUB_MCP_SERVER_ID = 'github';
const GITHUB_MCP_TOKEN_ENV_VAR = 'GITHUB_MCP_PAT';
const GITHUB_MCP_URL = 'https://api.githubcopilot.com/mcp/';

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

function readJsonFileSafe(absPath, fsModule = fs) {
  try {
    const stat = fsModule.statSync(absPath);
    if (!stat.isFile()) {
      return { exists: false, value: null, error: null };
    }
    return {
      exists: true,
      value: JSON.parse(fsModule.readFileSync(absPath, 'utf8')),
      error: null,
    };
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return { exists: false, value: null, error: null };
    }
    return {
      exists: true,
      value: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function readGithubTokenEnvVar(serverConfig) {
  const authorization = String(serverConfig?.headers?.Authorization || '').trim();
  const match = authorization.match(/\$\{env:([A-Z0-9_]+)\}/i);
  return match ? match[1] : GITHUB_MCP_TOKEN_ENV_VAR;
}

function buildCliGithubAccessContract() {
  return {
    host: 'cli',
    status: 'documented-default',
    serverId: 'github-mcp-server',
    readOnlyDefault: true,
    detail: 'Copilot CLI documents a built-in github-mcp-server read-only tool surface, but this runtime view does not actively probe the host session before reporting it.',
  };
}

function buildWorkspaceGithubAccessContract(engineRoot, options = {}) {
  const fsModule = options.fsModule || fs;
  const pathModule = options.pathModule || path;
  const env = options.env && typeof options.env === 'object' ? options.env : process.env;
  const mcpPath = pathModule.join(pathModule.resolve(engineRoot), '.vscode', 'mcp.json');
  const loaded = readJsonFileSafe(mcpPath, fsModule);

  if (loaded.error) {
    return {
      host: 'vscode-workspace',
      status: 'probe-failed',
      configPath: mcpPath,
      schema: 'mcpServers',
      serverId: GITHUB_MCP_SERVER_ID,
      readOnlyDefault: true,
      lastError: loaded.error,
      detail: 'The workspace MCP config could not be parsed.',
    };
  }

  const document = loaded.value && typeof loaded.value === 'object' && !Array.isArray(loaded.value)
    ? loaded.value
    : null;
  const mcpServers = document && document.mcpServers && typeof document.mcpServers === 'object' && !Array.isArray(document.mcpServers)
    ? document.mcpServers
    : null;
  const githubServer = mcpServers && typeof mcpServers[GITHUB_MCP_SERVER_ID] === 'object' && !Array.isArray(mcpServers[GITHUB_MCP_SERVER_ID])
    ? mcpServers[GITHUB_MCP_SERVER_ID]
    : null;

  if (!githubServer) {
    return {
      host: 'vscode-workspace',
      status: 'unconfigured',
      configPath: mcpPath,
      schema: 'mcpServers',
      serverId: GITHUB_MCP_SERVER_ID,
      readOnlyDefault: true,
      exists: loaded.exists,
      detail: loaded.exists
        ? 'No GitHub MCP workspace entry is configured yet.'
        : 'Workspace MCP config has not been created yet.',
    };
  }

  const tokenEnvVar = readGithubTokenEnvVar(githubServer);
  const tokenValue = typeof env[tokenEnvVar] === 'string' ? env[tokenEnvVar].trim() : '';
  const authPresent = Boolean(tokenValue);
  const configuredUrl = typeof githubServer.url === 'string' ? githubServer.url.trim() : '';

  return {
    host: 'vscode-workspace',
    status: authPresent ? 'configured' : 'auth-missing',
    configPath: mcpPath,
    schema: 'mcpServers',
    serverId: GITHUB_MCP_SERVER_ID,
    readOnlyDefault: true,
    exists: true,
    authPresent,
    tokenEnvVar,
    configuredUrl,
    expectedUrl: GITHUB_MCP_URL,
    matchesExpectedUrl: configuredUrl === GITHUB_MCP_URL,
    detail: authPresent
      ? 'Workspace GitHub MCP config is present and waiting for a VS Code session to use it.'
      : 'Workspace GitHub MCP config exists, but the token env var is missing from the current process.',
  };
}

function buildGithubAccessContract(engineRoot, options = {}) {
  return {
    cli: buildCliGithubAccessContract(),
    workspace: buildWorkspaceGithubAccessContract(engineRoot, options),
    guidance: {
      docPath: 'docs/system/mcp-workflow.md',
      configPath: '.vscode/mcp.json',
      tokenEnvVar: GITHUB_MCP_TOKEN_ENV_VAR,
      envBootstrapScripts: [
        'scripts/mcp-env.ps1',
        'scripts/mcp-env.sh',
      ],
    },
  };
}

function createRuntimeHealthResolver(options = {}) {
  const env = options.env && typeof options.env === 'object' ? options.env : process.env;
  const cacheTtlMs = Number.isFinite(options.cacheTtlMs) ? Number(options.cacheTtlMs) : 15_000;
  let runtimeHealthCache = {
    expiresAtMs: 0,
    key: null,
    value: null,
  };

  return function getRuntimeHealth({ engineRoot, sandboxesHome, providerState }) {
    const now = Date.now();
    const cacheKey = JSON.stringify({
      engineRoot: String(engineRoot || ''),
      sandboxesHome: String(sandboxesHome || ''),
      mode: String(env.INSTRUCTION_ENGINE_RUNTIME_MODE || ''),
      selectedProvider: providerState && typeof providerState === 'object'
        ? String(providerState.selectedProvider || providerState.defaultProvider || '')
        : '',
    });
    if (runtimeHealthCache.value && runtimeHealthCache.key === cacheKey && now < runtimeHealthCache.expiresAtMs) {
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
    runtime.githubAccess = buildGithubAccessContract(engineRoot, {
      env,
      fsModule: options.fsModule,
      pathModule: options.pathModule,
    });

    runtimeHealthCache = {
      key: cacheKey,
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
