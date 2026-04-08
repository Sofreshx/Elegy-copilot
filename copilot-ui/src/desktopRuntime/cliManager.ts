import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

import { resolveDesktopReleaseChannelContract, type DesktopReleaseChannelContract } from '../updatePolicy';

export interface DesktopCliManagerState {
  channel: string;
  sdkChannel: string;
  cliChannel: string;
  requestedChannel: string | null;
  acquisition: string;
  status: 'ready' | 'blocked';
  approved: boolean;
  reason: string | null;
  message: string | null;
  source: string;
  cliPath: string | null;
  cliVersion: string | null;
  sdkVersion: string | null;
  lastCheckedAtMs: number;
}

export interface DesktopCliManagerLogger {
  log: (message: string) => void;
  warn: (message: string) => void;
}

export interface EvaluateDesktopCliManagerStateOptions {
  runtimeRoot: string;
  copilotHome: string;
  isPackaged: boolean;
  appVersion: string;
  appPath: string;
  currentDirname: string;
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  logger?: Partial<DesktopCliManagerLogger>;
}

const dynamicImportModule = new Function(
  'specifier',
  'return import(specifier);',
) as (specifier: string) => Promise<Record<string, unknown>>;

function resolveLogger(logger?: Partial<DesktopCliManagerLogger>): DesktopCliManagerLogger {
  return {
    log: logger?.log ?? (() => undefined),
    warn: logger?.warn ?? (() => undefined),
  };
}

export function createDesktopCliManagerState(
  contract: DesktopReleaseChannelContract,
  sdkVersion: string | null,
  overrides: Partial<DesktopCliManagerState>,
): DesktopCliManagerState {
  return {
    channel: contract.channel,
    sdkChannel: contract.sdkChannel,
    cliChannel: contract.cliChannel,
    requestedChannel: null,
    acquisition: 'bundle_or_seeded_install_only',
    status: 'blocked',
    approved: false,
    reason: null,
    message: null,
    source: 'none',
    cliPath: null,
    cliVersion: null,
    sdkVersion,
    lastCheckedAtMs: Date.now(),
    ...overrides,
  };
}

export function applyDesktopCliManagerStateToEnvFallback(
  state: DesktopCliManagerState,
  env: NodeJS.ProcessEnv,
): void {
  env.INSTRUCTION_ENGINE_COPILOT_CLI_STATE_JSON = JSON.stringify({
    channel: state.channel,
    sdkChannel: state.sdkChannel,
    cliChannel: state.cliChannel,
    requestedChannel: state.requestedChannel,
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
  });
  env.INSTRUCTION_ENGINE_COPILOT_CLI_CHANNEL = state.channel;

  delete env.COPILOT_SDK_CLI_URL;
  delete env.COPILOT_SDK_CLI_PATH;

  if (state.approved && state.cliPath) {
    env.COPILOT_SDK_CLI_PATH = state.cliPath;
    delete env.INSTRUCTION_ENGINE_SDK_BRIDGE_DISABLED_REASON;
    delete env.INSTRUCTION_ENGINE_SDK_BRIDGE_DISABLED_MESSAGE;
    return;
  }

  env.INSTRUCTION_ENGINE_SDK_BRIDGE_DISABLED_REASON = String(state.reason || 'managed_cli_blocked');
  env.INSTRUCTION_ENGINE_SDK_BRIDGE_DISABLED_MESSAGE = String(
    state.message || 'Managed Copilot CLI is unavailable for the desktop runtime.',
  );
}

export function maybeDisableSdkBridgeForCliManagerState(
  state: DesktopCliManagerState,
  sdkBridgeRequested: boolean,
  env: NodeJS.ProcessEnv,
  logger?: Partial<DesktopCliManagerLogger>,
): void {
  const resolvedLogger = resolveLogger(logger);

  if (sdkBridgeRequested && !state.approved) {
    env.COPILOT_SDK_BRIDGE = '0';
    resolvedLogger.warn(
      `[desktop-cli] blocked SDK bridge on ${state.channel} lane: ${state.reason || 'managed_cli_blocked'}`,
    );
  } else if (sdkBridgeRequested && state.approved) {
    resolvedLogger.log(`[desktop-cli] using ${state.source} Copilot CLI for ${state.channel} lane`);
  }
}

export function ensureSdkBridgeDefaultEnabled(env: NodeJS.ProcessEnv): void {
  if (Object.prototype.hasOwnProperty.call(env, 'COPILOT_SDK_BRIDGE')) {
    return;
  }

  env.COPILOT_SDK_BRIDGE =
    String(env.INSTRUCTION_ENGINE_DISABLE_SDK_BRIDGE || '').trim() === '1'
      ? '0'
      : '1';
}

export async function evaluateDesktopCliManagerState(
  options: EvaluateDesktopCliManagerStateOptions,
): Promise<DesktopCliManagerState> {
  const sdkBridgeRequested = String(options.env.COPILOT_SDK_BRIDGE || '').trim() === '1';
  const releaseContract = resolveDesktopReleaseChannelContract({
    appVersion: options.appVersion,
    explicitChannel: options.env.INSTRUCTION_ENGINE_UPDATE_CHANNEL || null,
  });
  const fallbackContract = releaseContract.contract;
  const logger = resolveLogger(options.logger);

  try {
    const appPackageJsonCandidates = [
      path.join(options.appPath, 'package.json'),
      path.join(options.currentDirname, '..', 'package.json'),
      path.join(options.runtimeRoot, 'copilot-ui', 'package.json'),
      path.join(options.runtimeRoot, 'package.json'),
    ];
    const appPackageJsonPath = appPackageJsonCandidates.find((candidate) => fs.existsSync(candidate)) || '';
    const packageJson = appPackageJsonPath
      ? JSON.parse(fs.readFileSync(appPackageJsonPath, 'utf8')) as { dependencies?: Record<string, string> }
      : { dependencies: {} };
    const sdkVersion = String(packageJson.dependencies?.['@github/copilot-sdk'] || '').trim() || null;

    if (!releaseContract.ok) {
      const state = createDesktopCliManagerState(fallbackContract, sdkVersion, {
        requestedChannel: releaseContract.explicitChannel,
        reason: releaseContract.reason,
        message:
          `Invalid INSTRUCTION_ENGINE_UPDATE_CHANNEL value "${releaseContract.explicitChannel}". `
          + 'Expected stable or prerelease.',
      });
      applyDesktopCliManagerStateToEnvFallback(state, options.env);
      maybeDisableSdkBridgeForCliManagerState(state, sdkBridgeRequested, options.env, logger);
      return state;
    }

    const cliManagerModuleCandidates = [
      path.join(options.appPath, 'lib', 'copilot-bridge', 'cliManager.mjs'),
      path.join(options.currentDirname, '..', 'lib', 'copilot-bridge', 'cliManager.mjs'),
      path.join(options.runtimeRoot, 'copilot-ui', 'lib', 'copilot-bridge', 'cliManager.mjs'),
    ];
    const cliManagerModuleSourcePath = cliManagerModuleCandidates.find((candidate) => fs.existsSync(candidate));
    if (!cliManagerModuleSourcePath) {
      throw new Error('Desktop CLI manager module path is unavailable');
    }

    const cliManagerModulePath = pathToFileURL(cliManagerModuleSourcePath).href;
    const cliManagerModule = await dynamicImportModule(cliManagerModulePath) as {
      evaluateDesktopCliManagerState?: (moduleOptions: Record<string, unknown>) => DesktopCliManagerState;
      applyDesktopCliManagerStateToEnv?: (
        state: DesktopCliManagerState,
        env: NodeJS.ProcessEnv,
      ) => NodeJS.ProcessEnv;
    };

    if (
      typeof cliManagerModule.evaluateDesktopCliManagerState !== 'function'
      || typeof cliManagerModule.applyDesktopCliManagerStateToEnv !== 'function'
    ) {
      throw new Error('Desktop CLI manager exports are unavailable');
    }

    const bundleRoot = options.isPackaged
      ? path.join(options.runtimeRoot, 'copilot-cli')
      : path.join(options.runtimeRoot, 'copilot-ui', 'resources', 'copilot-cli');
    const state = cliManagerModule.evaluateDesktopCliManagerState({
      channel: releaseContract.contract.cliChannel,
      sdkVersion: sdkVersion || '',
      copilotHome: options.copilotHome,
      bundleRoot,
      env: options.env,
      platform: options.platform,
    });

    cliManagerModule.applyDesktopCliManagerStateToEnv(state, options.env);
    maybeDisableSdkBridgeForCliManagerState(state, sdkBridgeRequested, options.env, logger);
    return state;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const state = createDesktopCliManagerState(fallbackContract, null, {
      reason: 'managed_cli_bootstrap_failed',
      message: `Desktop Copilot CLI bootstrap failed: ${message}`,
    });
    applyDesktopCliManagerStateToEnvFallback(state, options.env);
    maybeDisableSdkBridgeForCliManagerState(state, sdkBridgeRequested, options.env, logger);
    return state;
  }
}
