'use strict';

const { spawn } = require('child_process');
const yaml = require('js-yaml');
const copilotConfigDefault = require('../lib/copilotConfig');
const codexConfigDefault = require('../lib/codexConfig');
const moonBridgeBootstrapDefault = require('../lib/moonBridgeBootstrap');
const { sendJson: defaultSendJson, readJsonBody: defaultReadJsonBody } = require('./_helpers');

const DEFAULT_CODEX_PROVIDER_PREFLIGHT_TIMEOUT_MS = 1500;
const DEEPSEEK_BRIDGE_READINESS_TIMEOUT_MS = 15000;
const DEEPSEEK_BRIDGE_PROBE_INTERVAL_MS = 500;

let deepseekBridgeProcess = null;
let deepseekBridgeStopping = false;

function bridgeModelsUrl(bridgeUrl) {
  const base = String(bridgeUrl || DEEPSEEK_BASE_URL).replace(/\/v1\/?$/, '');
  return `${base}/v1/models`;
}

function register(deps = {}) {
  const preflightFetch = deps.fetch || globalThis.fetch;
  const preflightTimeoutMs = Number.isFinite(deps.codexProviderPreflightTimeoutMs)
    ? deps.codexProviderPreflightTimeoutMs
    : DEFAULT_CODEX_PROVIDER_PREFLIGHT_TIMEOUT_MS;
  const resolvedDeps = {
    sendJson: deps.sendJson || defaultSendJson,
    readJsonBody: deps.readJsonBody || defaultReadJsonBody,
    copilotConfig: deps.copilotConfig || copilotConfigDefault,
    codexConfig: deps.codexConfig || codexConfigDefault,
    moonBridgeBootstrap: deps.moonBridgeBootstrap || moonBridgeBootstrapDefault,
    env: deps.env || process.env,
    probeCodexGatewayReachability: deps.probeCodexGatewayReachability
      || ((baseUrl) => probeCodexGatewayReachability(baseUrl, {
        fetchImpl: preflightFetch,
        timeoutMs: preflightTimeoutMs,
      })),
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

function isUserFacingCodexConfigError(statusCode) {
  return (statusCode >= 400 && statusCode < 500) || statusCode === 503;
}

function getCodexProviderGatewayConfig(codexHome, deps) {
  const status = deps.codexConfig.getStatus(codexHome);
  const gateway = status && typeof status.gateway === 'object' ? status.gateway : null;
  return {
    baseUrl: gateway && typeof gateway.baseUrl === 'string' ? gateway.baseUrl.trim() : '',
    envKey: gateway && typeof gateway.envKey === 'string' ? gateway.envKey.trim() : '',
  };
}

async function probeCodexGatewayReachability(baseUrl, options = {}) {
  const normalizedBaseUrl = typeof baseUrl === 'string' ? baseUrl.trim() : '';
  if (!normalizedBaseUrl) {
    throw Object.assign(new Error('Elegy gateway base URL is not configured.'), { statusCode: 500 });
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(normalizedBaseUrl);
  } catch {
    throw Object.assign(new Error(`Elegy gateway base URL is invalid: ${normalizedBaseUrl}`), { statusCode: 500 });
  }

  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw Object.assign(new Error('Fetch is unavailable for Codex provider preflight.'), { statusCode: 500 });
  }

  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
    ? options.timeoutMs
    : DEFAULT_CODEX_PROVIDER_PREFLIGHT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    await fetchImpl(parsedUrl.toString(), {
      method: 'GET',
      headers: {
        Accept: 'application/json, text/plain;q=0.9, */*;q=0.8',
      },
      redirect: 'manual',
      signal: controller.signal,
    });
  } catch (error) {
    const isTimeout = error && typeof error === 'object' && error.name === 'AbortError';
    const message = isTimeout
      ? `Elegy gateway did not respond at ${parsedUrl.toString()} within ${timeoutMs}ms. Start the local gateway and try again.`
      : `Elegy gateway is unavailable at ${parsedUrl.toString()}. Start the local gateway and try again.`;
    throw Object.assign(new Error(message), { statusCode: 503, cause: error });
  } finally {
    clearTimeout(timeoutId);
  }
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
  const mode = ctx.bodyMode || 'elegy-routed';

  if (mode === 'deepseek-bridge') {
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

    return;
  }

  const gateway = getCodexProviderGatewayConfig(ctx.codexHome, deps);
  if (!gateway.envKey) {
    throw Object.assign(new Error('Elegy gateway API key env var is not configured.'), { statusCode: 500 });
  }

  const envValue = deps.env && typeof deps.env === 'object' ? deps.env[gateway.envKey] : undefined;
  if (!String(envValue || '').trim()) {
    throw Object.assign(new Error(`Set ${gateway.envKey} before enabling Elegy Routed.`), { statusCode: 503 });
  }

  await deps.probeCodexGatewayReachability(gateway.baseUrl);
}

function handleGetRemoteSessions(ctx, deps) {
  const { copilotHome } = ctx;
  try {
    const enabled = deps.copilotConfig.getRemoteSessions(copilotHome);
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

    deps.copilotConfig.setRemoteSessions(ctx.copilotHome, body.enabled);

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
    if (mode === 'elegy-routed' || mode === 'deepseek-bridge') {
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
      const configPath = typeof body.bridgeConfigPath === 'string' && body.bridgeConfigPath.trim()
        ? body.bridgeConfigPath.trim()
        : settings.bridgeConfigPath;
      const apiKey = typeof body.apiKey === 'string' && body.apiKey.trim() ? body.apiKey.trim() : null;

      if (apiKey && configPath) {
        const dir = require('path').dirname(configPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }

        let configText = '';
        if (fs.existsSync(configPath)) {
          configText = fs.readFileSync(configPath, 'utf8');
        }

        let doc = {};
        try {
          doc = yaml.load(configText) || {};
        } catch {
          doc = {};
        }
        if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
          doc = {};
        }
        if (!doc.deepseek || typeof doc.deepseek !== 'object') {
          doc.deepseek = {};
        }
        doc.deepseek.api_key = apiKey;

        const nextText = yaml.dump(doc, { lineWidth: 120, noRefs: true, quotingType: '"', forceQuotes: false });
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
      deps.sendJson(ctx.res, 400, { error: 'Moon Bridge executable path is not configured or not found.' });
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
          error: 'Moon Bridge path is a directory, not an executable. Build the binary first (go build) or provide the full path to the executable.',
        });
        return;
      }
    }

    const bridgeUrl = ds.bridgeUrl || codexConfigDefault.DEEPSEEK_BASE_URL;
    const bridgeConfigPath = ds.bridgeConfigPath || null;
    const args = [];
    if (bridgeConfigPath) {
      args.push('--config', bridgeConfigPath);
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
    const copilotHome = ctx.copilotHome || require('path').join(require('os').homedir(), '.copilot');

    const status = deps.moonBridgeBootstrap.getBootstrapStatus({
      copilotHome,
      existingBootstrapState: existing || undefined,
    });

    deps.sendJson(ctx.res, 200, status);
  } catch (err) {
    deps.sendJson(ctx.res, 500, { error: 'Failed to get Moon Bridge bootstrap status', details: err.message });
  }
}

async function handleBootstrapMoonBridge(ctx, deps) {
  try {
    const codexHome = ctx.codexHome;
    const copilotHome = ctx.copilotHome || require('path').join(require('os').homedir(), '.copilot');
    const body = await deps.readJsonBody(ctx.req).catch(() => ({}));
    const forceRebuild = body.forceRebuild === true;

    const result = deps.moonBridgeBootstrap.bootstrapMoonBridge({
      copilotHome,
      forceRebuild,
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
  } catch (err) {
    deps.sendJson(ctx.res, 500, { error: 'Failed to bootstrap Moon Bridge', details: err.message });
  }
}

module.exports = { register };
