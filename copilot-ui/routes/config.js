'use strict';

const { spawn } = require('child_process');
const yaml = require('js-yaml');
const copilotConfigDefault = require('../lib/copilotConfig');
const codexConfigDefault = require('../lib/codexConfig');
const moonBridgeBootstrapDefault = require('../lib/moonBridgeBootstrap');
const { sendJson: defaultSendJson, readJsonBody: defaultReadJsonBody } = require('./_helpers');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { composeInstructions, buildProfileContent, loadPresetContent } = require('../lib/compose-instructions.cjs');

const DEFAULT_CODEX_PROVIDER_PREFLIGHT_TIMEOUT_MS = 1500;
const DEEPSEEK_BRIDGE_READINESS_TIMEOUT_MS = 15000;
const DEEPSEEK_BRIDGE_PROBE_INTERVAL_MS = 500;

function resolveBundledMoonBridgeSource() {
  // In a Tauri-packaged app, bundled resources are extracted to a platform-specific
  // directory. This path is resolved relative to the app resource directory.
  // The caller can override via process.env.
  const envPath = process.env.INSTRUCTION_ENGINE_MOON_BRIDGE_BUNDLED_PATH;
  if (envPath && require('fs').existsSync(envPath)) {
    return envPath;
  }

  // Default Tauri resource path for bundled binaries
  const path = require('path');
  const fs = require('fs');

  // Check common Tauri resource paths
  const candidates = [];
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'moon-bridge', 'moon-bridge.exe'));
  }
  // Check relative to the app directory
  const appDir = path.dirname(process.execPath);
  candidates.push(path.join(appDir, 'resources', 'moon-bridge', 'moon-bridge.exe'));

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  // Development fallback: check relative to workspace
  try {
    const localDev = path.join(__dirname, '..', 'resources', 'moon-bridge', 'moon-bridge.exe');
    if (fs.existsSync(localDev)) {
      return localDev;
    }
  } catch {
    // ignore
  }

  return '';
}

let deepseekBridgeProcess = null;
let deepseekBridgeStopping = false;

function bridgeModelsUrl(bridgeUrl) {
  const base = String(bridgeUrl || codexConfigDefault.DEEPSEEK_BASE_URL).replace(/\/v1\/?$/, '');
  return `${base}/v1/models`;
}

function register(deps = {}) {
  const resolvedDeps = {
    sendJson: deps.sendJson || defaultSendJson,
    readJsonBody: deps.readJsonBody || defaultReadJsonBody,
    copilotConfig: deps.copilotConfig || copilotConfigDefault,
    codexConfig: deps.codexConfig || codexConfigDefault,
    moonBridgeBootstrap: deps.moonBridgeBootstrap || moonBridgeBootstrapDefault,
  };

  return [
    {
      method: 'GET',
      path: '/api/config/remote-sessions',
      handler: (ctx) => handleGetRemoteSessions(ctx, resolvedDeps),
    },
    {
      method: 'PUT',
      path: '/api/config/remote-sessions',
      handler: (ctx) => handleSetRemoteSessions(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: '/api/config/collaboration-profile',
      handler: (ctx) => handleGetCollaborationProfile(ctx, resolvedDeps),
    },
    {
      method: 'PUT',
      path: '/api/config/collaboration-profile',
      handler: (ctx) => handleSaveCollaborationProfile(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: '/api/config/codex-provider',
      handler: (ctx) => handleGetCodexProvider(ctx, resolvedDeps),
    },
    {
      method: 'PUT',
      path: '/api/config/codex-provider',
      handler: (ctx) => handleSetCodexProvider(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: '/api/config/codex-provider/reset',
      handler: (ctx) => handleResetCodexProvider(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: '/api/config/codex-provider/factory-reset',
      handler: (ctx) => handleFactoryResetCodexProvider(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: '/api/config/codex-provider/deepseek',
      handler: (ctx) => handleGetDeepseek(ctx, resolvedDeps),
    },
    {
      method: 'PUT',
      path: '/api/config/codex-provider/deepseek',
      handler: (ctx) => handleSaveDeepseek(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: '/api/config/codex-provider/deepseek/start',
      handler: (ctx) => handleStartDeepseekBridge(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: '/api/config/codex-provider/deepseek/stop',
      handler: (ctx) => handleStopDeepseekBridge(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: '/api/config/codex-provider/deepseek/status',
      handler: (ctx) => handleCheckDeepseekBridge(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: '/api/config/codex-provider/deepseek/bootstrap',
      handler: (ctx) => handleGetBootstrapStatus(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: '/api/config/codex-provider/deepseek/bootstrap',
      handler: (ctx) => handleBootstrapMoonBridge(ctx, resolvedDeps),
    },
  ];
}

// --- Collaboration Profile Handlers ---

const REPO_ROOT = path.resolve(__dirname, '..', '..');

const HARNESS_TARGETS = [
  {
    id: 'copilot',
    instructionFile: 'copilot-instructions.md',
    homeDir: path.join(os.homedir(), '.elegy'),
    baseline: 'catalog-assets/instructions/agent-session-defaults.md',
    appendix: 'engine-assets/copilot-instructions-appendix.md',
    managedBlock: false,
  },
  {
    id: 'codex',
    instructionFile: 'AGENTS.md',
    homeDir: path.join(os.homedir(), '.codex'),
    baseline: 'catalog-assets/instructions/agent-session-defaults.md',
    appendix: 'codex-assets/home/AGENTS-appendix.md',
    managedBlock: false,
  },
  {
    id: 'opencode',
    instructionFile: 'AGENTS.md',
    homeDir: path.join(os.homedir(), '.config', 'opencode'),
    baseline: 'catalog-assets/instructions/agent-session-defaults.md',
    appendix: 'opencode-assets/home/AGENTS-appendix.md',
    managedBlock: false,
  },
  {
    id: 'claude-code',
    instructionFile: 'CLAUDE.md',
    homeDir: path.join(os.homedir(), '.claude'),
    baseline: 'catalog-assets/instructions/agent-session-defaults.md',
    appendix: 'claude-assets/home/CLAUDE-appendix.md',
    managedBlock: false,
  },
  {
    id: 'antigravity',
    instructionFile: 'GEMINI.md',
    homeDir: path.join(os.homedir(), '.gemini'),
    baseline: 'catalog-assets/instructions/agent-session-defaults.md',
    appendix: 'antigravity-assets/home/GEMINI-appendix.md',
    managedBlock: true,
  },
];

const PRESETS = [
  {
    id: 'constructive-coworker',
    label: 'Constructive Coworker',
    description: 'Attention-friendly communication: outcome-first, one thread at a time, explicit next actions.',
    content: fs.readFileSync(
      path.join(REPO_ROOT, 'catalog-assets', 'presets', 'constructive-coworker.md'),
      'utf8',
    ).trim(),
    isDefault: true,
  },
];

const MANAGED_BLOCK_START = '<!-- elegy-copilot:begin antigravity -->';
const MANAGED_BLOCK_END = '<!-- elegy-copilot:end antigravity -->';

function shaText(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function applyManagedBlock(target, composedContent) {
  const instructionsPath = path.join(target.homeDir, target.instructionFile);

  if (!fs.existsSync(instructionsPath)) {
    return { status: 'not-installed', path: instructionsPath };
  }

  const existingText = fs.readFileSync(instructionsPath, 'utf8').replace(/\r\n/g, '\n');
  const managedContent = [
    MANAGED_BLOCK_START,
    composedContent.trim(),
    MANAGED_BLOCK_END,
    '',
  ].join('\n');

  // Find existing managed block
  const startIndex = existingText.indexOf(MANAGED_BLOCK_START);
  const endIndex = existingText.indexOf(MANAGED_BLOCK_END);

  let nextText;
  if (startIndex >= 0 && endIndex >= startIndex) {
    const blockEnd = endIndex + MANAGED_BLOCK_END.length;
    const before = existingText.slice(0, startIndex).replace(/\s*$/, '');
    const after = existingText.slice(blockEnd).replace(/^\s*/, '');
    nextText = [before, managedContent.trimEnd(), after]
      .filter(Boolean)
      .join('\n\n')
      .replace(/\n{3,}/g, '\n\n')
      .trimEnd() + '\n';
  } else {
    nextText = `${existingText.trimEnd()}\n\n${managedContent}`;
  }

  const previousHash = shaText(existingText);
  const nextHash = shaText(nextText);

  if (previousHash === nextHash) {
    return { status: 'unchanged', path: instructionsPath };
  }

  fs.writeFileSync(instructionsPath, nextText, 'utf8');
  return { status: 'applied', path: instructionsPath };
}

function applyStandardTarget(target, composedContent) {
  const instructionsPath = path.join(target.homeDir, target.instructionFile);

  if (!fs.existsSync(instructionsPath)) {
    return { status: 'not-installed', path: instructionsPath };
  }

  const existingText = fs.readFileSync(instructionsPath, 'utf8');
  const nextText = composedContent;
  const previousHash = shaText(existingText);
  const nextHash = shaText(nextText);

  if (previousHash === nextHash) {
    return { status: 'unchanged', path: instructionsPath };
  }

  fs.writeFileSync(instructionsPath, nextText, 'utf8');
  return { status: 'applied', path: instructionsPath };
}

function applyProfileToTarget(target, profileContent) {
  try {
    const baselinePath = path.resolve(REPO_ROOT, target.baseline);
    const appendixPath = path.resolve(REPO_ROOT, target.appendix);

    const composedContent = composeInstructions(baselinePath, appendixPath, profileContent);

    if (target.managedBlock) {
      return applyManagedBlock(target, composedContent);
    }
    return applyStandardTarget(target, composedContent);
  } catch (err) {
    return { status: 'error', path: path.join(target.homeDir, target.instructionFile), error: err.message };
  }
}

function applyCollaborationProfile(profile) {
  const profileContent = profile.enabled ? buildProfileContent(profile) : '';

  const results = [];
  let allApplied = true;

  for (const target of HARNESS_TARGETS) {
    const result = applyProfileToTarget(target, profileContent);
    if (result.status === 'error') {
      allApplied = false;
    }
    results.push({
      id: target.id,
      path: result.path,
      status: result.status,
      error: result.error,
    });
  }

  return { allApplied, results };
}

async function handleGetCollaborationProfile(ctx, deps) {
  try {
    const profile = deps.copilotConfig.getCollaborationProfile();

    const presets = PRESETS.map((p) => ({ ...p }));

    const targets = HARNESS_TARGETS.map((t) => ({
      id: t.id,
      path: path.join(t.homeDir, t.instructionFile),
      installed: fs.existsSync(path.join(t.homeDir, t.instructionFile)),
    }));

    deps.sendJson(ctx.res, 200, { profile, presets, targets });
  } catch (err) {
    deps.sendJson(ctx.res, 500, { error: err.message });
  }
}

async function handleSaveCollaborationProfile(ctx, deps) {
  try {
    const body = await deps.readJsonBody(ctx.req);

    // Extract only known fields
    const update = {};
    if (body.enabled !== undefined) {
      if (typeof body.enabled !== 'boolean') {
        deps.sendJson(ctx.res, 400, { saved: false, error: 'enabled must be a boolean' });
        return;
      }
      update.enabled = body.enabled;
    }
    if (typeof body.presetId === 'string') update.presetId = body.presetId.trim();
    if (typeof body.customInstructions === 'string') update.customInstructions = body.customInstructions.trim();

    const saveResult = deps.copilotConfig.setCollaborationProfile(null, update);
    if (!saveResult.saved) {
      deps.sendJson(ctx.res, 400, { saved: false, error: saveResult.error });
      return;
    }

    // Read back the effective profile
    const profile = deps.copilotConfig.getCollaborationProfile();

    // Apply to all installed harnesses
    const { allApplied, results } = applyCollaborationProfile(profile);

    deps.sendJson(ctx.res, 200, {
      saved: true,
      profile,
      allApplied,
      results,
    });
  } catch (err) {
    if (err.statusCode) {
      deps.sendJson(ctx.res, err.statusCode, { error: err.message });
    } else {
      deps.sendJson(ctx.res, 500, { error: err.message });
    }
  }
}

function isUserFacingCodexConfigError(statusCode) {
  return (statusCode >= 400 && statusCode < 500) || statusCode === 503;
}

function wait(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function probeDeepseekBridgeReachability(baseUrl, options = {}) {
  const normalizedBaseUrl = typeof baseUrl === 'string' ? baseUrl.trim() : '';
  if (!normalizedBaseUrl) {
    throw Object.assign(new Error('Moon Bridge base URL is not configured.'), { statusCode: 500 });
  }

  let parsedUrl;
  try {
    const modelsUrl = bridgeModelsUrl(normalizedBaseUrl);
    parsedUrl = new URL(modelsUrl);
  } catch {
    throw Object.assign(new Error(`Moon Bridge base URL is invalid: ${normalizedBaseUrl}`), { statusCode: 500 });
  }

  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw Object.assign(new Error('Fetch is unavailable for DeepSeek bridge preflight.'), { statusCode: 500 });
  }

  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
    ? options.timeoutMs
    : DEFAULT_CODEX_PROVIDER_PREFLIGHT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetchImpl(parsedUrl.toString(), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      redirect: 'manual',
      signal: controller.signal,
    });

    if (!response.ok) {
      throw Object.assign(new Error(`Moon Bridge returned ${response.status} at /v1/models.`), { statusCode: 503 });
    }

    const payload = await response.json();
    const models = Array.isArray(payload.data) ? payload.data : (Array.isArray(payload.models) ? payload.models : []);
    const modelIds = models.map((m) => (m && typeof m === 'object' ? String(m.id || '') : '')).filter(Boolean);
    const requiredModels = ['deepseek-v4-pro', 'deepseek-v4-flash'];
    const missingModels = requiredModels.filter((id) => !modelIds.includes(id));

    if (missingModels.length > 0) {
      throw Object.assign(
        new Error(`Moon Bridge /v1/models is missing required models: ${missingModels.join(', ')}.`),
        { statusCode: 503 },
      );
    }

    return { reachable: true, modelsVisible: true, modelIds };
  } catch (error) {
    if (error.statusCode === 503) {
      throw error;
    }
    const isTimeout = error && typeof error === 'object' && error.name === 'AbortError';
    const message = isTimeout
      ? `Moon Bridge did not respond at ${parsedUrl.toString()} within ${timeoutMs}ms. Start the bridge and try again.`
      : `Moon Bridge is unavailable at ${parsedUrl.toString()}. Start the bridge and try again.`;
    throw Object.assign(new Error(message), { statusCode: 503, cause: error });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function assertCodexProviderActivationPreflight(ctx, deps) {
  const status = deps.codexConfig.getStatus(ctx.codexHome);
  const ds = status.deepseek || {};

  if (!ds.bridgePath || !require('fs').existsSync(ds.bridgePath)) {
    throw Object.assign(
      new Error('Moon Bridge executable path is not configured or not found. Set the bridge path in DeepSeek settings.'),
      { statusCode: 503 },
    );
  }

  if (!ds.keyConfigured) {
    throw Object.assign(
      new Error('DeepSeek API key is not configured. Save a key in the Moon Bridge config before activating.'),
      { statusCode: 503 },
    );
  }

  if (!ds.bridgeBinaryAvailable) {
    throw Object.assign(
      new Error('Moon Bridge binary is not available at the configured path. Install Moon Bridge or check the path.'),
      { statusCode: 503 },
    );
  }

  if (!deepseekBridgeProcess || deepseekBridgeProcess.exitCode != null || deepseekBridgeProcess.signalCode != null) {
    throw Object.assign(
      new Error('Moon Bridge is not running. Start the bridge before activating DeepSeek.'),
      { statusCode: 503 },
    );
  }

  await probeDeepseekBridgeReachability(ds.bridgeUrl || codexConfigDefault.DEEPSEEK_BASE_URL, {
    fetchImpl: deps.env && typeof deps.env === 'object' ? globalThis.fetch : undefined,
    timeoutMs: DEFAULT_CODEX_PROVIDER_PREFLIGHT_TIMEOUT_MS,
  });
}

function handleGetRemoteSessions(ctx, deps) {
  const { elegyHome } = ctx;
  try {
    const enabled = deps.copilotConfig.getRemoteSessions(elegyHome);
    deps.sendJson(ctx.res, 200, { enabled });
  } catch (err) {
    deps.sendJson(ctx.res, 500, { error: 'Failed to read config', details: err.message });
  }
}

function handleGetCodexProvider(ctx, deps) {
  try {
    const status = deps.codexConfig.getStatus(ctx.codexHome);
    deps.sendJson(ctx.res, 200, status);
  } catch (err) {
    deps.sendJson(ctx.res, 500, { error: 'Failed to read Codex provider config', details: err.message });
  }
}

async function handleSetRemoteSessions(ctx, deps) {
  try {
    const body = await deps.readJsonBody(ctx.req);
    if (typeof body.enabled !== 'boolean') {
      deps.sendJson(ctx.res, 400, { error: '`enabled` must be a boolean' });
      return;
    }

    deps.copilotConfig.setRemoteSessions(ctx.elegyHome, body.enabled);

    if (ctx.sdkBridge && typeof ctx.sdkBridge.restartBaseClient === 'function') {
      try {
        await ctx.sdkBridge.restartBaseClient();
      } catch (restartErr) {
        deps.sendJson(ctx.res, 200, {
          enabled: body.enabled,
          warning: `Config saved but base client restart failed: ${restartErr.message}`,
        });
        return;
      }
    }

    deps.sendJson(ctx.res, 200, { enabled: body.enabled });
  } catch (err) {
    if (err.statusCode === 413) {
      deps.sendJson(ctx.res, 413, { error: 'Request body too large' });
      return;
    }
    deps.sendJson(ctx.res, 500, { error: 'Failed to update config', details: err.message });
  }
}

async function handleSetCodexProvider(ctx, deps) {
  try {
    const body = await deps.readJsonBody(ctx.req);
    const mode = typeof body.mode === 'string' ? body.mode : '';
    ctx.bodyMode = mode;
    if (mode === 'deepseek-bridge') {
      await assertCodexProviderActivationPreflight(ctx, deps);
    }
    const result = deps.codexConfig.setMode(ctx.codexHome, mode);
    deps.sendJson(ctx.res, 200, result);
  } catch (err) {
    const statusCode = err.statusCode || 500;
    const shouldExpose = isUserFacingCodexConfigError(statusCode);
    deps.sendJson(ctx.res, err.statusCode || 500, {
      error: shouldExpose ? err.message : 'Failed to update Codex provider config',
      details: shouldExpose ? undefined : err.message,
    });
  }
}

async function handleResetCodexProvider(ctx, deps) {
  try {
    const body = await deps.readJsonBody(ctx.req);
    const hard = body.hard === true;
    const result = hard
      ? deps.codexConfig.hardReset(ctx.codexHome)
      : deps.codexConfig.setMode(ctx.codexHome, 'native');
    deps.sendJson(ctx.res, 200, result);
  } catch (err) {
    const statusCode = err.statusCode || 500;
    const shouldExpose = isUserFacingCodexConfigError(statusCode);
    deps.sendJson(ctx.res, err.statusCode || 500, {
      error: shouldExpose
        ? err.message
        : 'Failed to reset Codex provider config',
      details: shouldExpose ? undefined : err.message,
    });
  }
}

function handleFactoryResetCodexProvider(ctx, deps) {
  try {
    const result = deps.codexConfig.factoryReset(ctx.codexHome);
    deps.sendJson(ctx.res, 200, result);
  } catch (err) {
    const statusCode = err.statusCode || 500;
    const shouldExpose = isUserFacingCodexConfigError(statusCode);
    deps.sendJson(ctx.res, err.statusCode || 500, {
      error: shouldExpose ? err.message : 'Failed to factory-reset Codex provider config',
      details: shouldExpose ? undefined : err.message,
    });
  }
}

function handleGetDeepseek(ctx, deps) {
  try {
    const status = deps.codexConfig.getStatus(ctx.codexHome);
    const deepseek = (status && status.deepseek) || {};
    const bridgeRunning = deepseekBridgeProcess != null
      && deepseekBridgeProcess.exitCode == null
      && deepseekBridgeProcess.signalCode == null;

    deps.sendJson(ctx.res, 200, {
      ...deepseek,
      bridgeRunning,
    });
  } catch (err) {
    deps.sendJson(ctx.res, 500, { error: 'Failed to read DeepSeek config', details: err.message });
  }
}

async function handleSaveDeepseek(ctx, deps) {
  try {
    const body = await deps.readJsonBody(ctx.req);
    const settings = {};

    if (typeof body.bridgePath === 'string') {
      settings.bridgePath = body.bridgePath;
    }
    if (typeof body.bridgeConfigPath === 'string') {
      settings.bridgeConfigPath = body.bridgeConfigPath;
    }
    if (typeof body.bridgeUrl === 'string') {
      settings.bridgeUrl = body.bridgeUrl;
    }

    if (body.keyConfigured === true) {
      const fs = require('fs');
      const path = require('path');
      const configPath = typeof body.bridgeConfigPath === 'string' && body.bridgeConfigPath.trim()
        ? body.bridgeConfigPath.trim()
        : settings.bridgeConfigPath;
      const apiKey = typeof body.apiKey === 'string' && body.apiKey.trim() ? body.apiKey.trim() : null;

      if (apiKey && configPath) {
        const dir = path.dirname(configPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }

        // Generate full Moon Bridge config.yml
        const config = {
          server: {
            addr: '127.0.0.1:38440',
          },
          mode: 'Transform',
          providers: [
            {
              provider: 'deepseek',
              api_key: apiKey,
            },
          ],
          models: [
            {
              model: 'deepseek-v4-pro',
              provider: 'deepseek',
              context_window: 262144,
            },
            {
              model: 'deepseek-v4-flash',
              provider: 'deepseek',
              context_window: 262144,
            },
          ],
          routes: [
            { model: 'deepseek-v4-pro', provider: 'deepseek' },
            { model: 'deepseek-v4-flash', provider: 'deepseek' },
          ],
        };

        const nextText = yaml.dump(config, { lineWidth: 120, noRefs: true, quotingType: '"', forceQuotes: false });
        fs.writeFileSync(configPath, nextText, 'utf8');
        settings.keyConfigured = true;
      }
    } else if (body.keyConfigured === false) {
      settings.keyConfigured = false;
    }

    const result = deps.codexConfig.saveDeepseekSettings(ctx.codexHome, settings);
    const bridgeRunning = deepseekBridgeProcess != null
      && deepseekBridgeProcess.exitCode == null
      && deepseekBridgeProcess.signalCode == null;

    deps.sendJson(ctx.res, 200, {
      ...result,
      bridgeRunning,
    });
  } catch (err) {
    deps.sendJson(ctx.res, 500, { error: 'Failed to save DeepSeek settings', details: err.message });
  }
}

async function waitForDeepseekBridgeReady(bridgeUrl, options = {}) {
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
    ? options.timeoutMs
    : DEEPSEEK_BRIDGE_READINESS_TIMEOUT_MS;
  const intervalMs = Number.isFinite(options.intervalMs) && options.intervalMs > 0
    ? options.intervalMs
    : DEEPSEEK_BRIDGE_PROBE_INTERVAL_MS;

  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      return await probeDeepseekBridgeReachability(bridgeUrl, {
        fetchImpl: globalThis.fetch,
        timeoutMs: Math.min(2000, timeoutMs),
      });
    } catch (err) {
      lastError = err.message || String(err);
      await wait(intervalMs);
    }
  }

  throw Object.assign(
    new Error(lastError
      ? `Moon Bridge did not become ready: ${lastError}`
      : `Moon Bridge did not respond within ${timeoutMs}ms.`),
    { statusCode: 503 },
  );
}

async function handleStartDeepseekBridge(ctx, deps) {
  try {
    if (deepseekBridgeProcess && deepseekBridgeProcess.exitCode == null && deepseekBridgeProcess.signalCode == null) {
      deps.sendJson(ctx.res, 200, { bridgeRunning: true, message: 'Moon Bridge is already running.' });
      return;
    }

    const status = deps.codexConfig.getStatus(ctx.codexHome);
    const ds = status.deepseek || {};
    let bridgePath = ds.bridgePath;

    if (!bridgePath || !require('fs').existsSync(bridgePath)) {
      deps.sendJson(ctx.res, 400, {
        error: 'Moon Bridge executable not found. Run "Install Moon Bridge" first from the Codex Provider settings to set up the bridge binary.',
        bridgePath: bridgePath || null,
      });
      return;
    }

    const fs = require('fs');
    const path = require('path');
    const stat = fs.statSync(bridgePath);
    if (stat.isDirectory()) {
      const candidates = ['moon-bridge.exe', 'moon-bridge'];
      const found = candidates.map((name) => path.join(bridgePath, name)).find((p) => {
        try { return fs.statSync(p).isFile(); } catch { return false; }
      });
      if (found) {
        bridgePath = found;
      } else {
        deps.sendJson(ctx.res, 400, {
          error: 'Moon Bridge path is a directory, not an executable. The binary must be built first. Run "Install Moon Bridge" from Codex Provider settings, or run "go build" inside the Moon Bridge source directory.',
          searchedPaths: candidates.map((name) => path.join(bridgePath, name)),
        });
        return;
      }
    }

    const bridgeUrl = ds.bridgeUrl || codexConfigDefault.DEEPSEEK_BASE_URL;
    const bridgeConfigPath = ds.bridgeConfigPath || null;
    const args = [];
    if (bridgeConfigPath) {
      args.push('-config', bridgeConfigPath);
    }

    deepseekBridgeStopping = false;
    deepseekBridgeProcess = spawn(bridgePath, args, {
      cwd: require('path').dirname(bridgePath),
      stdio: 'ignore',
      windowsHide: true,
    });

    deepseekBridgeProcess.once('error', () => {
      // Reference left intact; kill guard handles null in the catch path
    });

    try {
      const probeResult = await waitForDeepseekBridgeReady(bridgeUrl);
      const result = deps.codexConfig.saveDeepseekSettings(ctx.codexHome, {
        bridgeReachable: probeResult.reachable,
        modelsVisible: probeResult.modelsVisible,
      });
      deps.sendJson(ctx.res, 200, {
        ...result,
        bridgeRunning: true,
        message: 'Moon Bridge started and ready.',
      });
    } catch (probeErr) {
      deepseekBridgeStopping = true;
      if (deepseekBridgeProcess) {
        try { deepseekBridgeProcess.kill(); } catch { /* ignore */ }
      }
      deepseekBridgeProcess = null;
      deepseekBridgeStopping = false;
      deps.sendJson(ctx.res, 503, {
        error: `Moon Bridge started but did not pass readiness probe: ${probeErr.message}`,
      });
    }
  } catch (err) {
    deps.sendJson(ctx.res, 500, { error: 'Failed to start Moon Bridge', details: err.message });
  }
}

async function handleStopDeepseekBridge(ctx, deps) {
  try {
    if (!deepseekBridgeProcess || deepseekBridgeProcess.exitCode != null || deepseekBridgeProcess.signalCode != null) {
      deepseekBridgeProcess = null;
      deepseekBridgeStopping = false;
      deps.sendJson(ctx.res, 200, { bridgeRunning: false, message: 'Moon Bridge is not running.' });
      return;
    }

    deepseekBridgeStopping = true;

    await new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        deepseekBridgeProcess.removeListener('exit', onExit);
        resolve();
      };

      const forceKillTimer = setTimeout(() => {
        try {
          deepseekBridgeProcess.kill('SIGKILL');
        } catch {
          // Ignore kill failures
        }
        finish();
      }, 2000);

      const onExit = () => {
        clearTimeout(forceKillTimer);
        finish();
      };

      deepseekBridgeProcess.once('exit', onExit);

      try {
        deepseekBridgeProcess.kill();
      } catch {
        finish();
      }
    });

    deepseekBridgeProcess = null;
    deepseekBridgeStopping = false;

    deps.sendJson(ctx.res, 200, { bridgeRunning: false, message: 'Moon Bridge stopped.' });
  } catch (err) {
    deps.sendJson(ctx.res, 500, { error: 'Failed to stop Moon Bridge', details: err.message });
  }
}

async function handleCheckDeepseekBridge(ctx, deps) {
  try {
    const status = deps.codexConfig.getStatus(ctx.codexHome);
    const ds = status.deepseek || {};
    const bridgeUrl = ds.bridgeUrl || codexConfigDefault.DEEPSEEK_BASE_URL;

    let bridgeReachable = false;
    let modelsVisible = false;
    let modelIds = [];

    try {
      const probeResult = await probeDeepseekBridgeReachability(bridgeUrl, {
        fetchImpl: globalThis.fetch,
        timeoutMs: DEFAULT_CODEX_PROVIDER_PREFLIGHT_TIMEOUT_MS,
      });
      bridgeReachable = Boolean(probeResult && probeResult.reachable);
      if (probeResult && probeResult.modelsVisible === true) {
        modelsVisible = true;
      }
      if (probeResult && Array.isArray(probeResult.modelIds)) {
        modelIds = probeResult.modelIds;
      }
    } catch {
      bridgeReachable = false;
      modelsVisible = false;
      modelIds = [];
    }

    const bridgeRunning = deepseekBridgeProcess != null
      && deepseekBridgeProcess.exitCode == null
      && deepseekBridgeProcess.signalCode == null;

    deps.sendJson(ctx.res, 200, {
      ...ds,
      bridgeReachable,
      modelsVisible,
      modelIds,
      bridgeRunning,
      probeError: null,
    });
  } catch (err) {
    deps.sendJson(ctx.res, 500, { error: 'Failed to check Moon Bridge status', details: err.message });
  }
}

async function handleGetBootstrapStatus(ctx, deps) {
  try {
    const codexHome = ctx.codexHome;
    const existing = deps.codexConfig.getBootstrapState(codexHome);
    const elegyHome = ctx.elegyHome || require('path').join(require('os').homedir(), '.elegy');

    const bundledSource = resolveBundledMoonBridgeSource();
    const status = deps.moonBridgeBootstrap.getBootstrapStatus({
      elegyHome,
      existingBootstrapState: existing || undefined,
      bundledSource: bundledSource || undefined,
    });

    deps.sendJson(ctx.res, 200, status);
  } catch (err) {
    deps.sendJson(ctx.res, 500, { error: 'Failed to get Moon Bridge bootstrap status', details: err.message });
  }
}

async function handleBootstrapMoonBridge(ctx, deps) {
  try {
    const codexHome = ctx.codexHome;
    const elegyHome = ctx.elegyHome || require('path').join(require('os').homedir(), '.elegy');
    const body = await deps.readJsonBody(ctx.req).catch(() => ({}));
    const forceRebuild = body.forceRebuild === true;

    const bundledSource = resolveBundledMoonBridgeSource();
    const preStatus = deps.moonBridgeBootstrap.getBootstrapStatus({
      elegyHome,
      bundledSource: bundledSource || undefined,
    });

    // Fast path: bundled binary is available — run synchronously (just a file copy)
    if (preStatus.bundledSourceAvailable) {
      const result = deps.moonBridgeBootstrap.bootstrapMoonBridge({
        elegyHome,
        forceRebuild,
        bundledSource,
      });
      deps.codexConfig.saveBootstrapState(codexHome, result.status);

      if (result.success) {
        deps.sendJson(ctx.res, 200, {
          success: true,
          message: 'Moon Bridge installed and built successfully.',
          status: result.status,
        });
      } else {
        deps.sendJson(ctx.res, 200, {
          success: false,
          error: result.error || 'Moon Bridge bootstrap failed.',
          status: result.status,
        });
      }
      return;
    }

    // Slow path: needs git clone + go build. Check prerequisites first.
    if (!preStatus.gitAvailable) {
      deps.sendJson(ctx.res, 400, {
        success: false,
        error: 'Git is not available on this system. Moon Bridge requires git to clone the source repository. Install git from https://git-scm.com/ or use a pre-built binary.',
        status: preStatus,
      });
      return;
    }

    if (!preStatus.goAvailable) {
      deps.sendJson(ctx.res, 400, {
        success: false,
        error: 'Go 1.25+ is not available on this system. Moon Bridge requires Go to build from source. Install Go from https://go.dev/ or use a pre-built binary.',
        status: preStatus,
      });
      return;
    }

    // Run bootstrap in a forked child process to avoid blocking the event loop
    const { fork } = require('child_process');
    const workerPath = require.resolve('../lib/moonBridgeBootstrapWorker');

    deps.sendJson(ctx.res, 202, {
      success: true,
      message: 'Moon Bridge installation started. This may take a few minutes for git clone and go build...',
      status: preStatus,
      async: true,
    });

    // The child process runs in background; the response has already been sent.
    // We save the result to state so subsequent calls can pick it up.
    const child = fork(workerPath, [], { stdio: 'ignore' });

    child.on('message', (msg) => {
      if (msg && msg.ok) {
        deps.codexConfig.saveBootstrapState(codexHome, msg.result.status);
      } else {
        deps.codexConfig.saveBootstrapState(codexHome, {
          ...preStatus,
          lastError: (msg && msg.error) || 'Child process bootstrap failed',
          lastBootstrapAt: new Date().toISOString(),
        });
      }
    });

    child.on('error', () => {
      deps.codexConfig.saveBootstrapState(codexHome, {
        ...preStatus,
        lastError: 'Child process error during bootstrap',
        lastBootstrapAt: new Date().toISOString(),
      });
    });

    child.send({ elegyHome, forceRebuild });
  } catch (err) {
    deps.sendJson(ctx.res, 500, { error: 'Failed to bootstrap Moon Bridge', details: err.message });
  }
}

module.exports = { register };

// Test-only accessor for the module-scoped bridge process variable.
// Tests can set this to a mock child process object to satisfy preflight checks.
Object.defineProperty(module.exports, '_testBridgeProcess', {
  get: () => deepseekBridgeProcess,
  set: (v) => { deepseekBridgeProcess = v; },
  enumerable: false,
  configurable: true,
});
