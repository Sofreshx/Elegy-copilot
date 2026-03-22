const DEFAULT_MAX_SSE_CLIENTS = 10;

function isObject(value) {
  return value !== null && typeof value === "object";
}

function firstNonEmptyString(values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function readBoolean(value, fallback) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value !== "string") {
    return fallback;
  }

  const token = value.trim().toLowerCase();
  if (token === "1" || token === "true" || token === "yes" || token === "on") {
    return true;
  }
  if (token === "0" || token === "false" || token === "no" || token === "off") {
    return false;
  }
  return fallback;
}

function readInteger(value, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.floor(num);
}

function parseCliArgs(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value !== "string" || !value.trim()) {
    return [];
  }
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function resolveBridgeConfig(env, opts = {}) {
  const sourceEnv = isObject(env) ? env : {};
  const sourceOpts = isObject(opts) ? opts : {};

  const cliUrl = firstNonEmptyString([sourceOpts.cliUrl, sourceEnv.COPILOT_SDK_CLI_URL]);
  const enabled = readBoolean(
    sourceOpts.enabled != null ? sourceOpts.enabled : sourceEnv.COPILOT_SDK_BRIDGE,
    false
  );

  const maxSseClientsPerSession = Math.min(
    100,
    Math.max(
      1,
      readInteger(
        sourceOpts.maxSseClientsPerSession != null
          ? sourceOpts.maxSseClientsPerSession
          : sourceEnv.COPILOT_SDK_MAX_SSE_CLIENTS,
        DEFAULT_MAX_SSE_CLIENTS
      )
    )
  );

  const clientOptions = {
    autoStart: true,
    autoRestart: readBoolean(
      sourceOpts.autoRestart != null ? sourceOpts.autoRestart : sourceEnv.COPILOT_SDK_AUTO_RESTART,
      true
    ),
    logLevel: firstNonEmptyString([sourceOpts.logLevel, sourceEnv.COPILOT_SDK_LOG_LEVEL]) || "info",
  };

  if (cliUrl) {
    clientOptions.cliUrl = cliUrl;
  } else {
    clientOptions.cliPath =
      firstNonEmptyString([sourceOpts.cliPath, sourceEnv.COPILOT_SDK_CLI_PATH]) || "copilot";
    clientOptions.cwd = firstNonEmptyString([sourceOpts.cwd, sourceEnv.COPILOT_SDK_CWD]) || process.cwd();
    clientOptions.useStdio = readBoolean(
      sourceOpts.useStdio != null ? sourceOpts.useStdio : sourceEnv.COPILOT_SDK_USE_STDIO,
      true
    );

    const configuredPort = readInteger(
      sourceOpts.port != null ? sourceOpts.port : sourceEnv.COPILOT_SDK_PORT,
      0
    );
    if (configuredPort > 0) {
      clientOptions.port = configuredPort;
    }

    const cliArgs = parseCliArgs(
      sourceOpts.cliArgs != null ? sourceOpts.cliArgs : sourceEnv.COPILOT_SDK_CLI_ARGS
    );
    if (cliArgs.length > 0) {
      clientOptions.cliArgs = cliArgs;
    }
  }

  const config = {
    enabled,
    mode: cliUrl ? "cli-url" : "spawn",
    maxSseClientsPerSession,
    clientOptions,
  };

  if (typeof sourceOpts.policyPreflightFn === "function") {
    config.policyPreflightFn = sourceOpts.policyPreflightFn;
  }

  const copilotHome = firstNonEmptyString([sourceOpts.copilotHome, sourceEnv.COPILOT_HOME]);
  if (copilotHome) {
    config.copilotHome = copilotHome;
  }

  if (typeof sourceOpts.cliVersion === "string" && sourceOpts.cliVersion.trim()) {
    config.cliVersion = sourceOpts.cliVersion.trim();
  }

  return config;
}
