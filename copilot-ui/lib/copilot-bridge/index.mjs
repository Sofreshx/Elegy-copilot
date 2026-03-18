import { CopilotClient } from "@github/copilot-sdk";
import { createRequire } from "module";
import path from "path";
import { resolveBridgeConfig } from "./bridge-config.mjs";
import { createPreToolUseHook, createSessionEndHook } from "./hooks.mjs";
import { createPermissionRequestHandler } from "./permissions.mjs";

const require = createRequire(import.meta.url);
const {
  recordExplicitAssetInvocation,
} = require("../assetInvocationAudit.js");

const DEFAULT_MAX_SSE_CLIENTS = 10;

const EVENT_RELAY_MAP = Object.freeze({
  "assistant.message_delta": "assistant.message_delta",
  "assistant.reasoning_delta": "assistant.reasoning_delta",
  "assistant.message": "assistant.message",
  "assistant.reasoning": "assistant.reasoning",
  "session.idle": "session.idle",
  "session.error": "session.error",
  "tool.executing": "tool.executing",
  "tool.completed": "tool.completed",
  "tool.execution_start": "tool.executing",
  "tool.execution_complete": "tool.completed",
});

const SSE_HEADERS = Object.freeze({
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
});

function isObject(value) {
  return value !== null && typeof value === "object";
}

function toErrorMessage(error) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error || "Unknown error");
}

function normalizeSessionId(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function normalizeOptionalString(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function areSamePath(left, right) {
  if (!left || !right) return false;
  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);
  if (process.platform === "win32") {
    return normalizedLeft.toLowerCase() === normalizedRight.toLowerCase();
  }
  return normalizedLeft === normalizedRight;
}

function normalizeMaxSseClients(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return DEFAULT_MAX_SSE_CLIENTS;
  const rounded = Math.floor(num);
  if (rounded < 1) return DEFAULT_MAX_SSE_CLIENTS;
  return Math.min(rounded, 100);
}

function safeIsoNow(nowFn) {
  const value = typeof nowFn === "function" ? nowFn() : new Date();
  if (value instanceof Date) return value.toISOString();
  return new Date().toISOString();
}

function writeSseEvent(res, eventName, payload) {
  if (!res || res.destroyed || res.writableEnded) {
    return false;
  }

  const event = typeof eventName === "string" && eventName.trim() ? eventName.trim() : "message";
  const data = JSON.stringify(payload == null ? {} : payload);

  try {
    res.write(`event: ${event}\n`);
    res.write(`data: ${data}\n\n`);
    return true;
  } catch {
    return false;
  }
}

export function createBridgeClient(options = {}) {
  return new CopilotClient(options);
}

export class SdkBridgeService {
  constructor(config = {}, deps = {}) {
    const resolvedConfig = isObject(config) ? config : {};
    const resolvedDeps = isObject(deps) ? deps : {};

    this._config = resolvedConfig;
    this._deps = {
      createClient:
        typeof resolvedDeps.createClient === "function"
          ? resolvedDeps.createClient
          : (options) => createBridgeClient(options),
      now: typeof resolvedDeps.now === "function" ? resolvedDeps.now : () => new Date(),
      recordAssetInvocation:
        typeof resolvedDeps.recordAssetInvocation === "function"
          ? resolvedDeps.recordAssetInvocation
          : (payload) => recordExplicitAssetInvocation(payload),
    };

    this._client = null;
    this._sessions = new Map();
    this._initialized = false;
    this._lastError = null;
    this._maxSseClientsPerSession = normalizeMaxSseClients(
      resolvedConfig.maxSseClientsPerSession
    );
  }

  get client() {
    return this._client;
  }

  get initialized() {
    return this._initialized;
  }

  async init() {
    if (this._client && this._initialized) {
      return this;
    }

    const clientOptions = isObject(this._config.clientOptions) ? this._config.clientOptions : {};
    const client = this._deps.createClient(clientOptions);

    if (!client || typeof client.start !== "function") {
      throw new Error("SdkBridgeService requires a CopilotClient-compatible start() function");
    }

    await client.start();

    this._client = client;
    this._initialized = true;
    this._lastError = null;

    return this;
  }

  async shutdown() {
    const sessionIds = Array.from(this._sessions.keys());
    const sessionErrors = [];

    for (const sessionId of sessionIds) {
      try {
        await this.destroySdkSession(sessionId, { reason: "shutdown" });
      } catch (error) {
        sessionErrors.push({ sessionId, error: toErrorMessage(error) });
      }
    }

    const stopErrors = [];
    if (this._client && typeof this._client.stop === "function") {
      try {
        const result = await this._client.stop();
        if (Array.isArray(result) && result.length > 0) {
          for (const item of result) {
            stopErrors.push(toErrorMessage(item));
          }
        }
      } catch (error) {
        stopErrors.push(toErrorMessage(error));
      }
    }

    this._sessions.clear();
    this._client = null;
    this._initialized = false;
    this._lastError = stopErrors[0] || sessionErrors[0]?.error || null;

    return {
      stopped: true,
      sessionErrors,
      stopErrors,
    };
  }

  async getHealth() {
    const state = this._client && typeof this._client.getState === "function"
      ? this._client.getState()
      : "disconnected";
    const connected = state === "connected";

    const health = {
      connected,
      state,
      mode: this._config.mode || "spawn",
      sessionCount: this._sessions.size,
    };

    if (this._config && this._config.cliVersion) {
      health.cliVersion = String(this._config.cliVersion);
    }

    if (this._lastError) {
      health.error = this._lastError;
    }

    return health;
  }

  _resolveBaseClientOptions() {
    return isObject(this._config.clientOptions) ? this._config.clientOptions : {};
  }

  _resolveSessionContext(sessionConfig) {
    const requestedCwd = normalizeOptionalString(sessionConfig.cwd);
    const sandboxId = normalizeOptionalString(sessionConfig.sandboxId) || null;
    const contextToken = normalizeOptionalString(sessionConfig.contextType).toLowerCase();
    const contextType = contextToken || (sandboxId ? "sandbox" : "regular");
    const baseClientOptions = this._resolveBaseClientOptions();
    const baseCwd = normalizeOptionalString(baseClientOptions.cwd) || null;

    const useDedicatedClient = Boolean(
      requestedCwd
      && (!baseCwd || !areSamePath(baseCwd, requestedCwd))
    );

    return {
      contextType,
      sandboxId,
      requestedCwd: requestedCwd || null,
      baseCwd,
      effectiveCwd: requestedCwd || baseCwd,
      useDedicatedClient,
    };
  }

  async createSdkSession(options = {}) {
    if (!this._client) {
      throw new Error("SDK bridge is not initialized");
    }

    const sessionConfig = isObject(options) ? options : {};
    const policyPreflightFn =
      typeof sessionConfig.policyPreflightFn === "function"
        ? sessionConfig.policyPreflightFn
        : this._config.policyPreflightFn;

    const onPreToolUse =
      typeof sessionConfig.onPreToolUse === "function"
        ? sessionConfig.onPreToolUse
        : createPreToolUseHook(policyPreflightFn);

    const onPermissionRequest =
      typeof sessionConfig.onPermissionRequest === "function"
        ? sessionConfig.onPermissionRequest
        : createPermissionRequestHandler(policyPreflightFn);

    const onSessionEnd =
      typeof sessionConfig.onSessionEnd === "function"
        ? sessionConfig.onSessionEnd
        : createSessionEndHook(({ sessionId }) => {
            this._sessions.delete(sessionId);
          });

    const createRequest = {
      sessionId: sessionConfig.sessionId,
      model: sessionConfig.model,
      tools: Array.isArray(sessionConfig.tools) ? sessionConfig.tools : undefined,
      systemMessage: sessionConfig.systemMessage,
      availableTools: Array.isArray(sessionConfig.availableTools)
        ? sessionConfig.availableTools
        : undefined,
      excludedTools: Array.isArray(sessionConfig.excludedTools)
        ? sessionConfig.excludedTools
        : undefined,
      provider: sessionConfig.provider,
      streaming: sessionConfig.streaming !== false,
      hooks: {
        onPreToolUse,
        onSessionEnd,
      },
      onPermissionRequest,
      onPreToolUse,
      onSessionEnd,
    };

    const context = this._resolveSessionContext(sessionConfig);
    let client = this._client;
    let ownsClient = false;

    if (context.useDedicatedClient) {
      const dedicatedOptions = {
        ...this._resolveBaseClientOptions(),
        cwd: context.requestedCwd,
      };
      client = this._deps.createClient(dedicatedOptions);
      if (!client || typeof client.start !== "function") {
        throw new Error("SdkBridgeService requires a CopilotClient-compatible start() function");
      }
      await client.start();
      ownsClient = true;
    }

    let session;
    try {
      session = await client.createSession(createRequest);
    } catch (error) {
      if (ownsClient && client && typeof client.stop === "function") {
        try {
          await client.stop();
        } catch {
          // Ignore dedicated client shutdown failures after session creation failure.
        }
      }
      throw error;
    }

    const sessionId = normalizeSessionId(session && session.sessionId);
    if (!sessionId) {
      if (ownsClient && client && typeof client.stop === "function") {
        try {
          await client.stop();
        } catch {
          // Ignore dedicated client shutdown failures after invalid session id.
        }
      }
      throw new Error("SDK client returned an invalid session id");
    }

    if (this._sessions.has(sessionId)) {
      if (ownsClient && client && typeof client.stop === "function") {
        try {
          await client.stop();
        } catch {
          // Ignore dedicated client shutdown failures after duplicate session id.
        }
      }
      throw new Error(`SDK session already exists: ${sessionId}`);
    }

    const record = {
      sessionId,
      model: typeof createRequest.model === "string" ? createRequest.model : null,
      createdAt: safeIsoNow(this._deps.now),
      session,
      client,
      ownsClient,
      contextType: context.contextType,
      sandboxId: context.sandboxId,
      cwd: context.effectiveCwd,
      availableTools: createRequest.availableTools || null,
      hooks: {
        onPreToolUse,
        onSessionEnd,
        onPermissionRequest,
      },
      sseClients: new Set(),
      unsubscribe: null,
    };

    if (session && typeof session.on === "function") {
      record.unsubscribe = session.on((event) => {
        this._handleSessionEvent(record, event);
      });
    }

    this._sessions.set(sessionId, record);
    return {
      sessionId,
      model: record.model,
      createdAt: record.createdAt,
      contextType: record.contextType,
      sandboxId: record.sandboxId,
      cwd: record.cwd,
    };
  }

  async destroySdkSession(sessionId, options = {}) {
    const normalizedSessionId = normalizeSessionId(sessionId);
    if (!normalizedSessionId) {
      return false;
    }

    const record = this._sessions.get(normalizedSessionId);
    if (!record) {
      return false;
    }

    if (typeof record.unsubscribe === "function") {
      try {
        record.unsubscribe();
      } catch {
        // Ignore unsubscribe failures.
      }
      record.unsubscribe = null;
    }

    for (const client of Array.from(record.sseClients)) {
      this._detachSseClientRecord(record, client, { endResponse: true });
    }

    let destroyError = null;
    if (record.session && typeof record.session.destroy === "function") {
      try {
        await record.session.destroy();
      } catch (error) {
        destroyError = error;
      }
    }

    let stopError = null;
    if (record.ownsClient && record.client && typeof record.client.stop === "function") {
      try {
        await record.client.stop();
      } catch (error) {
        stopError = error;
      }
    }

    this._sessions.delete(normalizedSessionId);

    const reason =
      isObject(options) && typeof options.reason === "string" && options.reason.trim()
        ? options.reason.trim()
        : "destroy";

    await this._invokeSessionEndHook(record, { sessionId: normalizedSessionId, reason });

    if (destroyError) {
      throw destroyError;
    }
    if (stopError) {
      throw stopError;
    }

    return true;
  }

  getSdkSession(sessionId) {
    const normalizedSessionId = normalizeSessionId(sessionId);
    if (!normalizedSessionId) return null;
    const record = this._sessions.get(normalizedSessionId);
    if (!record) return null;
    return {
      sessionId: record.sessionId,
      model: record.model,
      createdAt: record.createdAt,
      sseClientCount: record.sseClients.size,
      contextType: record.contextType,
      sandboxId: record.sandboxId,
      cwd: record.cwd,
      session: record.session,
    };
  }

  listSdkSessions() {
    return Array.from(this._sessions.values()).map((record) => ({
      sessionId: record.sessionId,
      model: record.model,
      createdAt: record.createdAt,
      sseClientCount: record.sseClients.size,
      contextType: record.contextType,
      sandboxId: record.sandboxId,
      cwd: record.cwd,
    }));
  }

  async sendToSession(sessionId, input = {}) {
    const normalizedSessionId = normalizeSessionId(sessionId);
    const record = this._sessions.get(normalizedSessionId);

    if (!record) {
      const notFoundError = new Error(`SDK session not found: ${normalizedSessionId}`);
      notFoundError.code = "SDK_SESSION_NOT_FOUND";
      throw notFoundError;
    }

    const payload = isObject(input) ? input : {};
    const prompt = typeof payload.prompt === "string" ? payload.prompt.trim() : "";

    if (!prompt) {
      const invalidPayloadError = new Error("prompt is required");
      invalidPayloadError.code = "SDK_INVALID_PAYLOAD";
      throw invalidPayloadError;
    }

    const messageId = await record.session.send({
      prompt,
      attachments: Array.isArray(payload.attachments) ? payload.attachments : undefined,
      mode: payload.mode === "immediate" ? "immediate" : "enqueue",
    });

    return { messageId };
  }

  attachSseClient(sessionId, req, res) {
    const normalizedSessionId = normalizeSessionId(sessionId);
    const record = this._sessions.get(normalizedSessionId);

    if (!record) {
      return {
        ok: false,
        statusCode: 404,
        error: "SDK session not found",
      };
    }

    if (record.sseClients.size >= this._maxSseClientsPerSession) {
      return {
        ok: false,
        statusCode: 429,
        error: `SSE client limit reached (${this._maxSseClientsPerSession})`,
      };
    }

    if (res && typeof res.writeHead === "function") {
      res.writeHead(200, SSE_HEADERS);
      if (typeof res.flushHeaders === "function") {
        res.flushHeaders();
      }
    }

    const client = {
      req,
      res,
      detached: false,
      detach: () => {
        this._detachSseClientRecord(record, client, { endResponse: false });
      },
    };

    record.sseClients.add(client);

    if (req && typeof req.on === "function") {
      req.on("close", client.detach);
      req.on("aborted", client.detach);
    }

    if (res && typeof res.on === "function") {
      res.on("close", client.detach);
      res.on("error", client.detach);
    }

    writeSseEvent(res, "connected", {
      sessionId: normalizedSessionId,
      connectedAt: safeIsoNow(this._deps.now),
    });

    return {
      ok: true,
      statusCode: 200,
      sessionId: normalizedSessionId,
    };
  }

  detachSseClient(sessionId, target) {
    const normalizedSessionId = normalizeSessionId(sessionId);
    const record = this._sessions.get(normalizedSessionId);
    if (!record) {
      return false;
    }

    let matchedClient = null;
    for (const client of record.sseClients) {
      if (client === target || client.res === target) {
        matchedClient = client;
        break;
      }
    }

    if (!matchedClient) {
      return false;
    }

    this._detachSseClientRecord(record, matchedClient, { endResponse: true });
    return true;
  }

  _handleSessionEvent(record, event) {
    if (!record || !isObject(event)) {
      return;
    }

    if (event.type === "session.error") {
      const message = event && isObject(event.data) ? event.data.message : null;
      if (typeof message === "string" && message.trim()) {
        this._lastError = message.trim();
      }
    }

    if (event.type === "tool.user_requested") {
      this._runToolHooks(record, event);
    }

    const mappedType = EVENT_RELAY_MAP[event.type];
    if (!mappedType) {
      return;
    }

    this._broadcastSse(record, mappedType, {
      sessionId: record.sessionId,
      type: mappedType,
      event,
    });
  }

  async _runToolHooks(record, event) {
    const toolRequest = {
      kind: "tool",
      sessionId: record.sessionId,
      toolName: event && isObject(event.data) ? event.data.toolName : undefined,
      arguments: event && isObject(event.data) ? event.data.arguments : undefined,
      toolCallId: event && isObject(event.data) ? event.data.toolCallId : undefined,
    };

    if (typeof this._deps.recordAssetInvocation === "function") {
      try {
        await this._deps.recordAssetInvocation({
          actor: {
            kind: "runtime",
            id: "sdk-bridge",
            label: "sdk-bridge",
          },
          availableTools: record.availableTools,
          copilotHome: this._config.copilotHome,
          correlationId: event && isObject(event.data) ? event.data.correlationId : undefined,
          eventData: event && isObject(event.data) ? event.data : undefined,
          repoPath: record.cwd,
          sessionId: record.sessionId,
          source: "sdk-bridge",
          toolCallId: toolRequest.toolCallId,
          toolName: toolRequest.toolName,
        });
      } catch {
        // Invocation audit failures should not break event processing.
      }
    }

    if (record.hooks && typeof record.hooks.onPreToolUse === "function") {
      try {
        await record.hooks.onPreToolUse(toolRequest);
      } catch {
        // Hook failures should not break event processing.
      }
    }

    if (record.hooks && typeof record.hooks.onPermissionRequest === "function") {
      try {
        await record.hooks.onPermissionRequest(toolRequest);
      } catch {
        // Hook failures should not break event processing.
      }
    }
  }

  _broadcastSse(record, eventName, payload) {
    for (const client of Array.from(record.sseClients)) {
      const wrote = writeSseEvent(client.res, eventName, payload);
      if (!wrote) {
        this._detachSseClientRecord(record, client, { endResponse: false });
      }
    }
  }

  _detachSseClientRecord(record, client, options = {}) {
    if (!record || !client || client.detached) {
      return;
    }

    client.detached = true;
    record.sseClients.delete(client);

    if (client.req && typeof client.req.off === "function") {
      client.req.off("close", client.detach);
      client.req.off("aborted", client.detach);
    }

    if (client.res && typeof client.res.off === "function") {
      client.res.off("close", client.detach);
      client.res.off("error", client.detach);
    }

    const shouldEndResponse = !isObject(options) || options.endResponse !== false;
    if (shouldEndResponse && client.res && !client.res.writableEnded && !client.res.destroyed) {
      try {
        client.res.end();
      } catch {
        // Ignore close failures.
      }
    }
  }

  async _invokeSessionEndHook(record, payload) {
    if (!record || !record.hooks || typeof record.hooks.onSessionEnd !== "function") {
      return;
    }

    try {
      await record.hooks.onSessionEnd(payload);
    } catch {
      // Session-end hook errors are non-fatal cleanup events.
    }
  }
}

export function createSdkBridgeService(config = {}, deps = {}) {
  return new SdkBridgeService(config, deps);
}

export { resolveBridgeConfig };
