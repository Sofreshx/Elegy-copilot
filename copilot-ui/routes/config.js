'use strict';

const copilotConfigDefault = require('../lib/copilotConfig');
const codexConfigDefault = require('../lib/codexConfig');
const opencodeConfigDefault = require('../lib/opencodeConfig');
const { sendJson: defaultSendJson, readJsonBody: defaultReadJsonBody } = require('./_helpers');

const DEFAULT_CODEX_PROVIDER_PREFLIGHT_TIMEOUT_MS = 1500;

/**
 * Copilot config API routes.
 * GET  /api/config/remote-sessions  — read remoteSessions preference
 * PUT  /api/config/remote-sessions  — set remoteSessions preference
 */
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
    opencodeConfig: deps.opencodeConfig || opencodeConfigDefault,
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
      path: '/api/config/opencode-agents',
      handler: (ctx) => handleGetOpenCodeAgents(ctx, resolvedDeps),
    },
    {
      method: 'PUT',
      path: '/api/config/opencode-agents',
      handler: (ctx) => handleSetOpenCodeAgents(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: '/api/config/opencode-agents/reset',
      handler: (ctx) => handleResetOpenCodeAgents(ctx, resolvedDeps),
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

async function assertCodexProviderActivationPreflight(ctx, deps) {
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

    // Restart SDK bridge base client if available, so the running CLI process
    // picks up the new remote mode.
    if (ctx.sdkBridge && typeof ctx.sdkBridge.restartBaseClient === 'function') {
      try {
        await ctx.sdkBridge.restartBaseClient();
      } catch (restartErr) {
        // Non-fatal: preference was saved, but client restart failed.
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
    if (mode === 'elegy-routed') {
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

function handleGetOpenCodeAgents(ctx, deps) {
  try {
    const status = deps.opencodeConfig.getStatus(ctx.opencodeHome);
    deps.sendJson(ctx.res, 200, status);
  } catch (err) {
    deps.sendJson(ctx.res, 500, {
      error: 'Failed to read OpenCode agent config',
      details: err.message,
    });
  }
}

async function handleSetOpenCodeAgents(ctx, deps) {
  try {
    const body = await deps.readJsonBody(ctx.req);
    const exploreModel = typeof body.exploreModel === 'string' ? body.exploreModel : null;
    const scoutModel = typeof body.scoutModel === 'string' ? body.scoutModel : null;

    if (!exploreModel && !scoutModel) {
      deps.sendJson(ctx.res, 400, {
        error: 'At least one of exploreModel or scoutModel must be provided',
      });
      return;
    }

    const result = deps.opencodeConfig.setAgentModels(ctx.opencodeHome, exploreModel, scoutModel);
    deps.sendJson(ctx.res, 200, result);
  } catch (err) {
    const statusCode = err.statusCode || 500;
    deps.sendJson(ctx.res, statusCode, {
      error: statusCode >= 400 && statusCode < 500
        ? err.message
        : 'Failed to update OpenCode agent config',
      details: statusCode >= 500 ? err.message : undefined,
    });
  }
}

async function handleResetOpenCodeAgents(ctx, deps) {
  try {
    const result = deps.opencodeConfig.resetConfig(ctx.opencodeHome);
    deps.sendJson(ctx.res, 200, result);
  } catch (err) {
    deps.sendJson(ctx.res, 500, {
      error: 'Failed to reset OpenCode agent config',
      details: err.message,
    });
  }
}

module.exports = { register };
