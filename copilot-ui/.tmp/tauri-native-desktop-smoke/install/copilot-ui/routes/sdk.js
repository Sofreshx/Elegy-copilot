'use strict';

const childProcess = require('node:child_process');
const fs = require('fs');
const path = require('path');
const { sendJson: defaultSendJson, readJsonBody: defaultReadJsonBody } = require('./_helpers');
const SANDBOX_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,63}$/;
const COPILOT_CONFIG_HELP_ARGS = ['help', 'config'];

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isValidSessionId(value) {
  if (!isNonEmptyString(value)) return false;
  const id = value.trim();
  if (id.length > 256) return false;
  if (id.includes('..') || id.includes('/') || id.includes('\\')) return false;
  return true;
}

function isPathInside(parentPath, candidatePath) {
  const relativePath = path.relative(parentPath, candidatePath);
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function resolveSandboxSessionCwd(sandboxesHome, sandboxId) {
  const sandboxRoot = typeof sandboxesHome === 'string' && sandboxesHome.trim()
    ? path.resolve(sandboxesHome.trim())
    : '';
  if (!sandboxRoot) {
    throw Object.assign(new Error('Sandbox root is unavailable on the server.'), { statusCode: 503 });
  }

  const sandboxCwd = path.resolve(path.join(sandboxRoot, sandboxId));
  if (!isPathInside(sandboxRoot, sandboxCwd)) {
    throw Object.assign(new Error('Sandbox path escapes configured sandbox root.'), { statusCode: 400 });
  }

  let stat;
  try {
    stat = fs.statSync(sandboxCwd);
  } catch {
    throw Object.assign(new Error(`Sandbox ${sandboxId} is not available. Run create/start first.`), { statusCode: 409 });
  }

  if (!stat.isDirectory()) {
    throw Object.assign(new Error(`Sandbox ${sandboxId} is not available. Run create/start first.`), { statusCode: 409 });
  }

  return sandboxCwd;
}

function toBridgeErrorPayload(error, fallbackStatusCode = 500) {
  if (!error || typeof error !== 'object') {
    return {
      statusCode: fallbackStatusCode,
      body: { error: String(error || 'Unknown error') },
    };
  }

  if (typeof error.statusCode === 'number') {
    return {
      statusCode: error.statusCode,
      body: { error: String(error.message || error) },
    };
  }

  if (error.code === 'SDK_SESSION_NOT_FOUND') {
    return {
      statusCode: 404,
      body: { error: String(error.message || 'SDK session not found') },
    };
  }

  if (error.code === 'SDK_INVALID_PAYLOAD') {
    return {
      statusCode: 400,
      body: { error: String(error.message || 'Invalid SDK payload') },
    };
  }

  return {
    statusCode: fallbackStatusCode,
    body: { error: String(error.message || error) },
  };
}

function sanitizeEnvString(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 512);
}

function sanitizeCliManagerState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const source = value;
  const sanitized = {};
  const stringFields = [
    'channel',
    'sdkChannel',
    'cliChannel',
    'requestedChannel',
    'acquisition',
    'status',
    'reason',
    'message',
    'source',
    'cliPath',
    'cliVersion',
    'sdkVersion',
  ];

  for (const field of stringFields) {
    const sanitizedValue = sanitizeEnvString(source[field]);
    if (sanitizedValue) {
      sanitized[field] = sanitizedValue;
    }
  }

  if (typeof source.approved === 'boolean') {
    sanitized.approved = source.approved;
  }

  const lastCheckedAtMs = Number(source.lastCheckedAtMs);
  if (Number.isFinite(lastCheckedAtMs) && lastCheckedAtMs >= 0) {
    sanitized.lastCheckedAtMs = lastCheckedAtMs;
  }

  return Object.keys(sanitized).length > 0 ? sanitized : null;
}

function readCliManagerStateFromEnv(sourceEnv) {
  const rawCliManager = String(sourceEnv?.INSTRUCTION_ENGINE_COPILOT_CLI_STATE_JSON || '').trim();
  if (!rawCliManager) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawCliManager);
    return sanitizeCliManagerState(parsed);
  } catch {
    return null;
  }
}

function resolveSdkBridgeDisabledState() {
  const cliManager = readCliManagerStateFromEnv(process.env);

  const reason =
    sanitizeEnvString(process.env.INSTRUCTION_ENGINE_SDK_BRIDGE_DISABLED_REASON)
    || cliManager?.reason
    || 'sdk_bridge_disabled';
  const error =
    sanitizeEnvString(process.env.INSTRUCTION_ENGINE_SDK_BRIDGE_DISABLED_MESSAGE)
    || cliManager?.message
    || 'SDK bridge is disabled. Set COPILOT_SDK_BRIDGE=1 to enable SDK sessions.';

  return {
    reason,
    error,
    cliManager,
  };
}

function buildSdkBridgeDisabledHealth() {
  const disabledState = resolveSdkBridgeDisabledState();

  return {
    connected: false,
    enabled: false,
    state: 'disabled',
    mode: 'disabled',
    sessionCount: 0,
    reason: disabledState.reason,
    error: disabledState.error,
    cliManager: disabledState.cliManager,
  };
}

function buildSdkBridgeDisabledError() {
  const disabledState = resolveSdkBridgeDisabledState();
  return {
    error: disabledState.error,
    code: disabledState.reason,
    reason: disabledState.reason,
  };
}

function requireSdkBridge(res, deps) {
  if (deps.sdkBridge) {
    return deps.sdkBridge;
  }

  deps.sendJson(res, 503, buildSdkBridgeDisabledError());
  return null;
}

function resolveCliCommandForSdkModels(deps) {
  const sourceEnv = deps.process?.env || process.env;
  const cliManager = readCliManagerStateFromEnv(sourceEnv);

  if (cliManager?.approved === true && isNonEmptyString(cliManager.cliPath)) {
    return cliManager.cliPath.trim();
  }

  if (isNonEmptyString(deps.cliCommand)) {
    return deps.cliCommand.trim();
  }

  if (isNonEmptyString(sourceEnv.COPILOT_SDK_CLI_PATH)) {
    return sourceEnv.COPILOT_SDK_CLI_PATH.trim();
  }

  return 'copilot';
}

function runCliCommand(deps, command, args, timeoutMs = 15000) {
  const execFile = typeof deps.childProcess?.execFile === 'function'
    ? deps.childProcess.execFile.bind(deps.childProcess)
    : childProcess.execFile;

  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      {
        timeout: timeoutMs,
        windowsHide: true,
        env: deps.process?.env || process.env,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(Object.assign(error, { stdout, stderr }));
          return;
        }

        resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') });
      }
    );
  });
}

function extractSdkModelsFromConfigHelp(output) {
  const lines = String(output || '').split(/\r?\n/);
  const models = [];
  let inModelSection = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!inModelSection) {
      if (trimmed.startsWith('`model`:')) {
        inModelSection = true;
      }
      continue;
    }

    const modelMatch = line.match(/^\s*-\s+"([^"]+)"\s*$/);
    if (modelMatch) {
      models.push(modelMatch[1]);
      continue;
    }

    if (models.length > 0 && trimmed === '') {
      break;
    }

    if (models.length > 0 && /^`[^`]+`:/.test(trimmed)) {
      break;
    }
  }

  return Array.from(new Set(models));
}

function handleSdkHealth(ctx, deps) {
  const { res } = ctx;
  const { sendJson, sdkBridge } = deps;

  if (!sdkBridge) {
    sendJson(res, 200, buildSdkBridgeDisabledHealth());
    return;
  }

  Promise.resolve()
    .then(() => sdkBridge.getHealth())
    .then((health) => sendJson(res, 200, health))
    .catch((error) => {
      const failure = toBridgeErrorPayload(error, 500);
      sendJson(res, failure.statusCode, failure.body);
    });
}

function handleListModels(ctx, deps) {
  const { res } = ctx;
  const { sendJson } = deps;

  Promise.resolve()
    .then(async () => {
      const cliCommand = resolveCliCommandForSdkModels(deps);
      const output = await runCliCommand(deps, cliCommand, COPILOT_CONFIG_HELP_ARGS);
      const models = extractSdkModelsFromConfigHelp(output.stdout);

      if (models.length === 0) {
        throw Object.assign(new Error('Copilot CLI did not report any models.'), { statusCode: 502 });
      }

      return { models };
    })
    .then((payload) => sendJson(res, 200, payload))
    .catch((error) => {
      const statusCode = typeof error?.statusCode === 'number'
        ? error.statusCode
        : error?.code === 'ENOENT'
          ? 503
          : 502;
      sendJson(res, statusCode, {
        error: String(error?.message || error || 'Unable to load Copilot CLI models'),
      });
    });
}

function handleCreateSession(ctx, deps) {
  const { req, res, sandboxesHome } = ctx;
  const { sendJson, readJsonBody } = deps;
  const sdkBridge = requireSdkBridge(res, deps);
  if (!sdkBridge) {
    return;
  }

  readJsonBody(req)
    .then((body) => {
      const payload = body && typeof body === 'object' ? body : {};
      const sessionId = payload.sessionId == null ? null : String(payload.sessionId).trim();
      const model = payload.model == null ? null : String(payload.model).trim();
      const contextType = payload.contextType == null ? null : String(payload.contextType).trim().toLowerCase();
      const sandboxId = payload.sandboxId == null ? null : String(payload.sandboxId).trim();
      let cwd;

      if (sessionId != null && sessionId !== '' && !isValidSessionId(sessionId)) {
        throw Object.assign(new Error('Invalid sessionId'), { statusCode: 400 });
      }

      if (payload.model != null && !isNonEmptyString(model)) {
        throw Object.assign(new Error('model must be a non-empty string when provided'), { statusCode: 400 });
      }

      if (payload.contextType != null && !isNonEmptyString(contextType)) {
        throw Object.assign(new Error('contextType must be a non-empty string when provided'), { statusCode: 400 });
      }

      if (payload.sandboxId != null && !isNonEmptyString(sandboxId)) {
        throw Object.assign(new Error('sandboxId must be a non-empty string when provided'), { statusCode: 400 });
      }

      if (sandboxId && !SANDBOX_ID_PATTERN.test(sandboxId)) {
        throw Object.assign(new Error('sandboxId must use only alphanumeric and hyphen characters'), { statusCode: 400 });
      }

      if (sandboxId && contextType && contextType !== 'sandbox') {
        throw Object.assign(new Error('sandboxId requires contextType=sandbox (or omit contextType)'), { statusCode: 400 });
      }

      if (sandboxId) {
        cwd = resolveSandboxSessionCwd(sandboxesHome, sandboxId);
      }

      // For regular (non-sandbox) sessions, extract cwd from orchestration repo path
      if (!cwd && payload.orchestration && typeof payload.orchestration === 'object') {
        const repo = payload.orchestration.repo;
        if (repo && typeof repo === 'object' && typeof repo.repoPath === 'string' && repo.repoPath.trim()) {
          cwd = repo.repoPath.trim();
        }
      }

      // Remote mode override (boolean or null/undefined to follow global default)
      const remote = typeof payload.remote === 'boolean' ? payload.remote : undefined;

      return sdkBridge.createSdkSession({
        sessionId: sessionId || undefined,
        model: model || undefined,
        contextType: sandboxId ? 'sandbox' : (contextType || 'regular'),
        sandboxId: sandboxId || undefined,
        cwd,
        remote,
        orchestration: payload.orchestration && typeof payload.orchestration === 'object' && !Array.isArray(payload.orchestration)
          ? payload.orchestration
          : undefined,
      });
    })
    .then((result) => sendJson(res, 201, result))
    .catch((error) => {
      const failure = toBridgeErrorPayload(error, 500);
      sendJson(res, failure.statusCode, failure.body);
    });
}

function handleListSessions(ctx, deps) {
  const { res } = ctx;
  const { sendJson } = deps;
  const sdkBridge = requireSdkBridge(res, deps);
  if (!sdkBridge) {
    return;
  }

  Promise.resolve()
    .then(() => sdkBridge.listSdkSessions())
    .then((sessions) => sendJson(res, 200, { sessions }))
    .catch((error) => {
      const failure = toBridgeErrorPayload(error, 500);
      sendJson(res, failure.statusCode, failure.body);
    });
}

function handleDeleteSession(ctx, deps) {
  const { res, match } = ctx;
  const { sendJson } = deps;
  const sdkBridge = requireSdkBridge(res, deps);
  if (!sdkBridge) {
    return;
  }

  const sessionId = decodeURIComponent(match[1] || '').trim();
  if (!isValidSessionId(sessionId)) {
    sendJson(res, 400, { error: 'Invalid session id' });
    return;
  }

  Promise.resolve()
    .then(() => sdkBridge.destroySdkSession(sessionId))
    .then((removed) => {
      if (!removed) {
        sendJson(res, 404, { error: 'SDK session not found', sessionId });
        return;
      }
      sendJson(res, 200, { ok: true, sessionId });
    })
    .catch((error) => {
      const failure = toBridgeErrorPayload(error, 500);
      sendJson(res, failure.statusCode, failure.body);
    });
}

function handleEnableRemote(ctx, deps) {
  const { res, match } = ctx;
  const { sendJson } = deps;
  const sdkBridge = requireSdkBridge(res, deps);
  if (!sdkBridge) {
    return;
  }

  const sessionId = decodeURIComponent(match[1] || '').trim();
  if (!isValidSessionId(sessionId)) {
    sendJson(res, 400, { error: 'Invalid session id' });
    return;
  }

  if (typeof sdkBridge.enableRemote !== 'function') {
    sendJson(res, 501, { error: 'enableRemote not supported by this bridge version' });
    return;
  }

  Promise.resolve()
    .then(() => sdkBridge.enableRemote(sessionId))
    .then((result) => sendJson(res, 200, result))
    .catch((error) => {
      const failure = toBridgeErrorPayload(error, 500);
      sendJson(res, failure.statusCode, failure.body);
    });
}

function handleSend(ctx, deps) {
  const { req, res } = ctx;
  const { sendJson, readJsonBody } = deps;
  const sdkBridge = requireSdkBridge(res, deps);
  if (!sdkBridge) {
    return;
  }

  readJsonBody(req)
    .then((body) => {
      const payload = body && typeof body === 'object' ? body : {};
      const sessionId = payload.sessionId == null ? '' : String(payload.sessionId).trim();
      const prompt = payload.prompt == null ? '' : String(payload.prompt).trim();

      if (!isValidSessionId(sessionId)) {
        throw Object.assign(new Error('Invalid sessionId'), { statusCode: 400 });
      }

      if (!prompt) {
        throw Object.assign(new Error('prompt is required'), { statusCode: 400 });
      }

      return sdkBridge.sendToSession(sessionId, {
        prompt,
        attachments: Array.isArray(payload.attachments) ? payload.attachments : undefined,
        mode: payload.mode,
      });
    })
    .then((result) => sendJson(res, 202, result))
    .catch((error) => {
      const failure = toBridgeErrorPayload(error, 500);
      sendJson(res, failure.statusCode, failure.body);
    });
}

function handleAnswerQuestion(ctx, deps) {
  const { req, res } = ctx;
  const { sendJson, readJsonBody } = deps;
  const sdkBridge = requireSdkBridge(res, deps);
  if (!sdkBridge) return;

  readJsonBody(req)
    .then((body) => {
      const payload = body && typeof body === 'object' ? body : {};
      const sessionId = isNonEmptyString(payload.sessionId) ? payload.sessionId.trim() : '';
      const toolCallId = isNonEmptyString(payload.toolCallId) ? payload.toolCallId.trim() : '';
      const answer = typeof payload.answer === 'string' ? payload.answer : '';

      if (!sessionId) {
        throw Object.assign(new Error('sessionId is required'), { statusCode: 400 });
      }
      if (!toolCallId) {
        throw Object.assign(new Error('toolCallId is required'), { statusCode: 400 });
      }

      return sdkBridge.answerQuestion(sessionId, toolCallId, answer);
    })
    .then((result) => sendJson(res, 200, result))
    .catch((error) => {
      const failure = toBridgeErrorPayload(error, 500);
      sendJson(res, failure.statusCode, failure.body);
    });
}

function handleStream(ctx, deps) {
  const { req, res, match } = ctx;
  const { sendJson } = deps;
  const sdkBridge = requireSdkBridge(res, deps);
  if (!sdkBridge) {
    return;
  }

  const sessionId = decodeURIComponent(match[1] || '').trim();
  if (!isValidSessionId(sessionId)) {
    sendJson(res, 400, { error: 'Invalid session id' });
    return;
  }

  const attachResult = sdkBridge.attachSseClient(sessionId, req, res);
  if (!attachResult || attachResult.ok !== true) {
    sendJson(
      res,
      attachResult && typeof attachResult.statusCode === 'number' ? attachResult.statusCode : 500,
      {
        error: (attachResult && attachResult.error) || 'Failed to attach SSE client',
        sessionId,
      }
    );
  }
}

function register(deps = {}) {
  const resolvedDeps = {
    sendJson: deps.sendJson || defaultSendJson,
    readJsonBody: deps.readJsonBody || defaultReadJsonBody,
    sdkBridge: deps.sdkBridge || null,
    childProcess: deps.childProcess || childProcess,
    cliCommand: deps.cliCommand || '',
    process: deps.process || process,
  };

  return [
    {
      method: 'GET',
      path: '/api/sdk/health',
      handler: (ctx) => handleSdkHealth(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: '/api/sdk/models',
      handler: (ctx) => handleListModels(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: '/api/sdk/session',
      handler: (ctx) => handleCreateSession(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: '/api/sdk/sessions',
      handler: (ctx) => handleListSessions(ctx, resolvedDeps),
    },
    {
      method: 'DELETE',
      path: /^\/api\/sdk\/session\/([^/]+)$/,
      handler: (ctx) => handleDeleteSession(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: /^\/api\/sdk\/session\/([^/]+)\/enable-remote$/,
      handler: (ctx) => handleEnableRemote(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: '/api/sdk/send',
      handler: (ctx) => handleSend(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: '/api/sdk/answer',
      handler: (ctx) => handleAnswerQuestion(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: /^\/api\/sdk\/stream\/([^/]+)$/,
      handler: (ctx) => handleStream(ctx, resolvedDeps),
    },
  ];
}

module.exports = { register };
