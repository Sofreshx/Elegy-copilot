import fs from "fs";
import os from "os";
import path from "path";

const CHANNEL_CONTRACT_FILE_NAME = "channel-contract.json";
const MANAGED_CLI_MANIFEST_FILE_NAME = "manifest.json";
const MANAGED_CLI_INSTALL_DIR_NAME = "managed-cli";

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function firstNonEmptyString(values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function readJsonFile(filePath) {
  try {
    const text = fs.readFileSync(filePath, "utf8");
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function resolveDefaultExecutableRelativePath(platform) {
  if (platform === "win32") {
    return path.join("bin", "copilot.cmd");
  }
  return path.join("bin", "copilot");
}

function sanitizePublicCliState(state) {
  return {
    channel: state.channel,
    sdkChannel: state.sdkChannel,
    cliChannel: state.cliChannel,
    acquisition: state.acquisition,
    status: state.status,
    approved: state.approved,
    reason: state.reason,
    message: state.message,
    source: state.source,
    cliPath: state.cliPath,
    cliVersion: state.cliVersion,
    sdkVersion: state.sdkVersion,
    lastCheckedAtMs: state.lastCheckedAtMs,
  };
}

function createBlockedState(baseState, reason, message, extra = {}) {
  return {
    ...baseState,
    status: "blocked",
    approved: false,
    reason,
    message,
    source: extra.source || baseState.source || "none",
    cliPath: extra.cliPath || null,
    cliVersion: extra.cliVersion || null,
    sdkVersion: extra.sdkVersion || baseState.sdkVersion || null,
    lastCheckedAtMs: Date.now(),
  };
}

function inspectManagedCliRoot(rootPath, expected, options = {}) {
  const manifestPath = path.join(rootPath, MANAGED_CLI_MANIFEST_FILE_NAME);
  if (!fs.existsSync(manifestPath)) {
    return {
      found: false,
    };
  }

  const manifest = readJsonFile(manifestPath);
  const baseState = {
    channel: expected.channel,
    sdkChannel: expected.sdkChannel,
    cliChannel: expected.cliChannel,
    acquisition: expected.acquisition,
    status: "blocked",
    approved: false,
    reason: null,
    message: null,
    source: options.source || "managed-install",
    cliPath: null,
    cliVersion: null,
    sdkVersion: expected.sdkVersion || null,
    lastCheckedAtMs: Date.now(),
  };

  if (!isObject(manifest) || Number(manifest.schemaVersion) !== 1) {
    return {
      found: true,
      state: createBlockedState(
        baseState,
        "managed_cli_manifest_invalid",
        `Managed Copilot CLI manifest is invalid at ${manifestPath}.`,
      ),
    };
  }

  const manifestChannel = firstNonEmptyString([manifest.channel]).toLowerCase();
  const cliVersion = firstNonEmptyString([manifest.version]) || null;
  const sdkVersion = firstNonEmptyString([manifest.sdkVersion]) || null;
  const executableRelativePath =
    firstNonEmptyString([manifest.executableRelativePath]) || resolveDefaultExecutableRelativePath(options.platform);
  const cliPath = path.resolve(rootPath, executableRelativePath);

  if (!fs.existsSync(cliPath)) {
    return {
      found: true,
      state: createBlockedState(
        baseState,
        "managed_cli_executable_missing",
        `Managed Copilot CLI executable is missing at ${cliPath}.`,
        {
          source: options.source,
          cliVersion,
          sdkVersion,
        },
      ),
    };
  }

  if (manifestChannel !== expected.cliChannel) {
    return {
      found: true,
      state: createBlockedState(
        baseState,
        "managed_cli_channel_mismatch",
        `Managed Copilot CLI channel ${manifestChannel || "(missing)"} does not match required ${expected.cliChannel} lane.`,
        {
          source: options.source,
          cliPath,
          cliVersion,
          sdkVersion,
        },
      ),
    };
  }

  if (!sdkVersion || sdkVersion !== expected.sdkVersion) {
    return {
      found: true,
      state: createBlockedState(
        baseState,
        "managed_cli_outdated",
        `Managed Copilot CLI metadata does not match SDK ${expected.sdkVersion}.`,
        {
          source: options.source,
          cliPath,
          cliVersion,
          sdkVersion,
        },
      ),
    };
  }

  return {
    found: true,
    state: {
      ...baseState,
      status: "ready",
      approved: true,
      reason: null,
      message: `Managed Copilot CLI is ready on the ${expected.cliChannel} lane (${options.source || "managed-install"}).`,
      source: options.source || "managed-install",
      cliPath,
      cliVersion,
      sdkVersion,
      lastCheckedAtMs: Date.now(),
    },
  };
}

function resolveChannelContract(contract, channel, sdkVersion) {
  if (!isObject(contract) || Number(contract.schemaVersion) !== 1) {
    return null;
  }

  const channels = isObject(contract.channels) ? contract.channels : null;
  const entry = channels && isObject(channels[channel]) ? channels[channel] : null;
  if (!entry) {
    return null;
  }

  const sdkChannel = firstNonEmptyString([entry.sdkChannel]).toLowerCase();
  const cliChannel = firstNonEmptyString([entry.cliChannel]).toLowerCase();
  if (!sdkChannel || !cliChannel) {
    return null;
  }

  return {
    channel,
    sdkChannel,
    cliChannel,
    sdkVersion,
    acquisition:
      firstNonEmptyString([contract.defaultAcquisition]) || "bundle_or_seeded_install_only",
  };
}

export function evaluateDesktopCliManagerState(options = {}) {
  const sourceEnv = isObject(options.env) ? options.env : process.env;
  const platform = firstNonEmptyString([options.platform]) || process.platform;
  const channel = firstNonEmptyString([options.channel]).toLowerCase() || "stable";
  const sdkVersion = firstNonEmptyString([options.sdkVersion]);
  const copilotHome =
    firstNonEmptyString([options.copilotHome]) || path.join(os.homedir(), ".copilot");
  const bundleRoot = firstNonEmptyString([options.bundleRoot]);
  const contractPath =
    firstNonEmptyString([options.contractPath]) || path.join(bundleRoot, CHANNEL_CONTRACT_FILE_NAME);
  const contract = readJsonFile(contractPath);
  const expected = resolveChannelContract(contract, channel, sdkVersion);
  const baseState = {
    channel,
    sdkChannel: channel,
    cliChannel: channel,
    acquisition: expected?.acquisition || "bundle_or_seeded_install_only",
    status: "blocked",
    approved: false,
    reason: null,
    message: null,
    source: "none",
    cliPath: null,
    cliVersion: null,
    sdkVersion: sdkVersion || null,
    lastCheckedAtMs: Date.now(),
  };

  if (!expected) {
    return createBlockedState(
      baseState,
      "managed_cli_contract_unavailable",
      `Managed Copilot CLI contract is unavailable at ${contractPath}.`,
    );
  }

  const configuredCliUrl = firstNonEmptyString([sourceEnv.COPILOT_SDK_CLI_URL]);
  if (configuredCliUrl) {
    return createBlockedState(
      {
        ...baseState,
        sdkChannel: expected.sdkChannel,
        cliChannel: expected.cliChannel,
        acquisition: expected.acquisition,
      },
      "desktop_cli_url_unmanaged",
      "Desktop SDK sessions require an app-managed Copilot CLI; cliUrl overrides are blocked in desktop mode.",
      {
        source: "cli-url",
      },
    );
  }

  const configuredCliPath = firstNonEmptyString([sourceEnv.COPILOT_SDK_CLI_PATH]);
  if (configuredCliPath) {
    return createBlockedState(
      {
        ...baseState,
        sdkChannel: expected.sdkChannel,
        cliChannel: expected.cliChannel,
        acquisition: expected.acquisition,
      },
      "desktop_cli_path_unmanaged",
      "Desktop SDK sessions require an app-managed Copilot CLI; unmanaged COPILOT_SDK_CLI_PATH overrides are blocked.",
      {
        source: "env-cli-path",
        cliPath: configuredCliPath,
      },
    );
  }

  const bundledRoot = bundleRoot ? path.join(bundleRoot, channel) : "";
  if (bundledRoot) {
    const bundled = inspectManagedCliRoot(bundledRoot, expected, {
      source: "bundled-resource",
      platform,
    });
    if (bundled.found) {
      return bundled.state;
    }
  }

  const installRoot = path.join(copilotHome, MANAGED_CLI_INSTALL_DIR_NAME, channel);
  const installed = inspectManagedCliRoot(installRoot, expected, {
    source: "seeded-install",
    platform,
  });
  if (installed.found) {
    return installed.state;
  }

  return createBlockedState(
    {
      ...baseState,
      sdkChannel: expected.sdkChannel,
      cliChannel: expected.cliChannel,
      acquisition: expected.acquisition,
    },
    "managed_cli_missing",
    `Managed Copilot CLI for the ${channel} lane is required, but no bundled or seeded payload is available.`,
  );
}

export function applyDesktopCliManagerStateToEnv(state, env) {
  const targetEnv = isObject(env) ? env : process.env;
  const publicState = sanitizePublicCliState(state);

  targetEnv.INSTRUCTION_ENGINE_COPILOT_CLI_STATE_JSON = JSON.stringify(publicState);
  targetEnv.INSTRUCTION_ENGINE_COPILOT_CLI_CHANNEL = String(state.channel || "stable");

  delete targetEnv.COPILOT_SDK_CLI_URL;
  delete targetEnv.COPILOT_SDK_CLI_PATH;

  if (state.approved && state.cliPath) {
    targetEnv.COPILOT_SDK_CLI_PATH = state.cliPath;
    delete targetEnv.INSTRUCTION_ENGINE_SDK_BRIDGE_DISABLED_REASON;
    delete targetEnv.INSTRUCTION_ENGINE_SDK_BRIDGE_DISABLED_MESSAGE;
    return targetEnv;
  }

  targetEnv.INSTRUCTION_ENGINE_SDK_BRIDGE_DISABLED_REASON = String(state.reason || "managed_cli_blocked");
  targetEnv.INSTRUCTION_ENGINE_SDK_BRIDGE_DISABLED_MESSAGE = String(
    state.message || "Managed Copilot CLI is unavailable for the desktop runtime.",
  );
  return targetEnv;
}

export function readDesktopCliManagerStateFromEnv(env) {
  const sourceEnv = isObject(env) ? env : process.env;
  const raw = firstNonEmptyString([sourceEnv.INSTRUCTION_ENGINE_COPILOT_CLI_STATE_JSON]);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
