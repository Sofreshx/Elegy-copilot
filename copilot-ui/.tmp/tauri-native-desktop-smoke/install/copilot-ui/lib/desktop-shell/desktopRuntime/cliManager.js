"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDesktopCliManagerState = createDesktopCliManagerState;
exports.applyDesktopCliManagerStateToEnvFallback = applyDesktopCliManagerStateToEnvFallback;
exports.maybeDisableSdkBridgeForCliManagerState = maybeDisableSdkBridgeForCliManagerState;
exports.ensureSdkBridgeDefaultEnabled = ensureSdkBridgeDefaultEnabled;
exports.evaluateDesktopCliManagerState = evaluateDesktopCliManagerState;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const url_1 = require("url");
const updatePolicy_1 = require("../updatePolicy");
const dynamicImportModule = new Function('specifier', 'return import(specifier);');
function resolveLogger(logger) {
    return {
        log: logger?.log ?? (() => undefined),
        warn: logger?.warn ?? (() => undefined),
    };
}
function createDesktopCliManagerState(contract, sdkVersion, overrides) {
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
function applyDesktopCliManagerStateToEnvFallback(state, env) {
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
    env.INSTRUCTION_ENGINE_SDK_BRIDGE_DISABLED_MESSAGE = String(state.message || 'Managed Copilot CLI is unavailable for the desktop runtime.');
}
function maybeDisableSdkBridgeForCliManagerState(state, sdkBridgeRequested, env, logger) {
    const resolvedLogger = resolveLogger(logger);
    if (sdkBridgeRequested && !state.approved) {
        env.COPILOT_SDK_BRIDGE = '0';
        resolvedLogger.warn(`[desktop-cli] blocked SDK bridge on ${state.channel} lane: ${state.reason || 'managed_cli_blocked'}`);
    }
    else if (sdkBridgeRequested && state.approved) {
        resolvedLogger.log(`[desktop-cli] using ${state.source} Copilot CLI for ${state.channel} lane`);
    }
}
function ensureSdkBridgeDefaultEnabled(env) {
    if (Object.prototype.hasOwnProperty.call(env, 'COPILOT_SDK_BRIDGE')) {
        return;
    }
    env.COPILOT_SDK_BRIDGE =
        String(env.INSTRUCTION_ENGINE_DISABLE_SDK_BRIDGE || '').trim() === '1'
            ? '0'
            : '1';
}
async function evaluateDesktopCliManagerState(options) {
    const sdkBridgeRequested = String(options.env.COPILOT_SDK_BRIDGE || '').trim() === '1';
    const releaseContract = (0, updatePolicy_1.resolveDesktopReleaseChannelContract)({
        appVersion: options.appVersion,
        explicitChannel: options.env.INSTRUCTION_ENGINE_UPDATE_CHANNEL || null,
    });
    const fallbackContract = releaseContract.contract;
    const logger = resolveLogger(options.logger);
    try {
        const appPackageJsonCandidates = [
            path_1.default.join(options.appPath, 'package.json'),
            path_1.default.join(options.currentDirname, '..', 'package.json'),
            path_1.default.join(options.runtimeRoot, 'copilot-ui', 'package.json'),
            path_1.default.join(options.runtimeRoot, 'package.json'),
        ];
        const appPackageJsonPath = appPackageJsonCandidates.find((candidate) => fs_1.default.existsSync(candidate)) || '';
        const packageJson = appPackageJsonPath
            ? JSON.parse(fs_1.default.readFileSync(appPackageJsonPath, 'utf8'))
            : { dependencies: {} };
        const sdkVersion = String(packageJson.dependencies?.['@github/copilot-sdk'] || '').trim() || null;
        if (!releaseContract.ok) {
            const state = createDesktopCliManagerState(fallbackContract, sdkVersion, {
                requestedChannel: releaseContract.explicitChannel,
                reason: releaseContract.reason,
                message: `Invalid INSTRUCTION_ENGINE_UPDATE_CHANNEL value "${releaseContract.explicitChannel}". `
                    + 'Expected stable or prerelease.',
            });
            applyDesktopCliManagerStateToEnvFallback(state, options.env);
            maybeDisableSdkBridgeForCliManagerState(state, sdkBridgeRequested, options.env, logger);
            return state;
        }
        const cliManagerModuleCandidates = [
            path_1.default.join(options.appPath, 'lib', 'copilot-bridge', 'cliManager.mjs'),
            path_1.default.join(options.currentDirname, '..', 'lib', 'copilot-bridge', 'cliManager.mjs'),
            path_1.default.join(options.runtimeRoot, 'copilot-ui', 'lib', 'copilot-bridge', 'cliManager.mjs'),
        ];
        const cliManagerModuleSourcePath = cliManagerModuleCandidates.find((candidate) => fs_1.default.existsSync(candidate));
        if (!cliManagerModuleSourcePath) {
            throw new Error('Desktop CLI manager module path is unavailable');
        }
        const cliManagerModulePath = (0, url_1.pathToFileURL)(cliManagerModuleSourcePath).href;
        const cliManagerModule = await dynamicImportModule(cliManagerModulePath);
        if (typeof cliManagerModule.evaluateDesktopCliManagerState !== 'function'
            || typeof cliManagerModule.applyDesktopCliManagerStateToEnv !== 'function') {
            throw new Error('Desktop CLI manager exports are unavailable');
        }
        const bundleRoot = options.isPackaged
            ? path_1.default.join(options.runtimeRoot, 'copilot-cli')
            : path_1.default.join(options.runtimeRoot, 'copilot-ui', 'resources', 'copilot-cli');
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
    }
    catch (error) {
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
