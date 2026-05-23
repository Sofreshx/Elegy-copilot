"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveDesktopRuntimeRoot = resolveDesktopRuntimeRoot;
exports.resolveDefaultWorkspaceRoot = resolveDefaultWorkspaceRoot;
exports.resolveDesktopServerPort = resolveDesktopServerPort;
exports.buildDesktopWindowUrl = buildDesktopWindowUrl;
exports.runBundledChildEntryPoint = runBundledChildEntryPoint;
exports.createDesktopRuntimeService = createDesktopRuntimeService;
const crypto_1 = require("crypto");
const child_process_1 = require("child_process");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const DESKTOP_UI_ACCESS_QUERY_PARAM = 'desktop-ui-token';
const DESKTOP_SMOKE_LOG_WINDOW_URL_ENV = 'INSTRUCTION_ENGINE_DESKTOP_SMOKE_LOG_WINDOW_URL';
function resolveLogger(logger) {
    return {
        log: logger?.log ?? (() => undefined),
        warn: logger?.warn ?? (() => undefined),
    };
}
function defaultRandomHex(byteCount) {
    return (0, crypto_1.randomBytes)(byteCount).toString('hex');
}
function resolveDesktopRuntimeRoot(options) {
    if (options.isPackaged) {
        return path_1.default.resolve(options.resourcesPath);
    }
    return path_1.default.resolve(options.currentDirname, '..', '..');
}
function resolveDefaultWorkspaceRoot(runtimeRoot, currentWorkingDirectory, existsSync = fs_1.default.existsSync) {
    return existsSync(runtimeRoot) ? runtimeRoot : path_1.default.resolve(currentWorkingDirectory);
}
function resolveDesktopServerPort(env) {
    const rawValue = String(env.INSTRUCTION_ENGINE_DESKTOP_SERVER_PORT || '').trim();
    if (!rawValue) {
        return 0;
    }
    const parsed = Number(rawValue);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
        throw new Error(`Invalid INSTRUCTION_ENGINE_DESKTOP_SERVER_PORT: ${rawValue}`);
    }
    return parsed;
}
function buildDesktopWindowUrl(host, port, desktopUiToken) {
    const url = new URL(`http://${host}:${port}/`);
    url.searchParams.set(DESKTOP_UI_ACCESS_QUERY_PARAM, desktopUiToken);
    return url.toString();
}
function buildGatewayInlineConfig(workspaceRoot) {
    return JSON.stringify({
        mode: 'disconnected',
        workspaces: {
            allowedRoots: [workspaceRoot],
            activeRoot: workspaceRoot,
        },
        sandboxLifecycle: {
            cleanupOnStartup: false,
        },
    });
}
function ensureDefaultGatewayConfig(paths, runtimeFs) {
    if (runtimeFs.existsSync(paths.gatewayConfigPath)) {
        return;
    }
    if (!runtimeFs.existsSync(paths.legacyGatewayConfigPath)) {
        return;
    }
    runtimeFs.mkdirSync(path_1.default.dirname(paths.gatewayConfigPath), { recursive: true });
    try {
        runtimeFs.renameSync(paths.legacyGatewayConfigPath, paths.gatewayConfigPath);
    }
    catch {
        runtimeFs.copyFileSync(paths.legacyGatewayConfigPath, paths.gatewayConfigPath);
        try {
            runtimeFs.unlinkSync(paths.legacyGatewayConfigPath);
        }
        catch {
            // best-effort cleanup after successful rehome
        }
    }
}
async function stopChildProcess(child) {
    if (!child || child.exitCode != null || child.killed) {
        return;
    }
    await new Promise((resolve) => {
        let settled = false;
        const finish = () => {
            if (settled) {
                return;
            }
            settled = true;
            resolve();
        };
        child.once('exit', finish);
        try {
            child.kill();
        }
        catch {
            finish();
            return;
        }
        setTimeout(finish, 2_000);
    });
}
function spawnGatewayDependencyForDevelopment(localTrackerRoot, trackerToken, workspaceRoot, options, runtimeFs, spawnChildProcess) {
    const env = {
        ...options.env,
        INSTRUCTION_ENGINE_GATEWAY_HTTP_TOKEN: trackerToken,
        INSTRUCTION_ENGINE_GATEWAY_ALLOW_PLATFORMLESS: '1',
        INSTRUCTION_ENGINE_GATEWAY_MODE: 'disconnected',
        INSTRUCTION_ENGINE_GATEWAY_CONFIG_JSON: buildGatewayInlineConfig(workspaceRoot),
    };
    const distEntry = path_1.default.join(localTrackerRoot, 'dist', 'messagingGateway', 'index.js');
    if (runtimeFs.existsSync(distEntry)) {
        return spawnChildProcess(options.processExecPath, [distEntry], {
            cwd: localTrackerRoot,
            env,
            stdio: 'ignore',
            windowsHide: true,
        });
    }
    const srcEntry = path_1.default.join(localTrackerRoot, 'src', 'messagingGateway', 'index.ts');
    if (!runtimeFs.existsSync(srcEntry)) {
        return null;
    }
    const tsNodeBin = path_1.default.join(localTrackerRoot, 'node_modules', '.bin', options.platform === 'win32' ? 'ts-node.cmd' : 'ts-node');
    if (runtimeFs.existsSync(tsNodeBin)) {
        return spawnChildProcess(tsNodeBin, [srcEntry], {
            cwd: localTrackerRoot,
            env,
            stdio: 'ignore',
            windowsHide: true,
        });
    }
    const npmCommand = options.platform === 'win32' ? 'npm.cmd' : 'npm';
    return spawnChildProcess(npmCommand, ['run', 'dev:gateway'], {
        cwd: localTrackerRoot,
        env,
        stdio: 'ignore',
        windowsHide: true,
    });
}
async function runBundledChildEntryPoint(options) {
    const runtimeFs = options.fs ?? fs_1.default;
    const processState = options.processState ?? process;
    const loadModule = options.loadModule ?? ((entryPath) => require(entryPath));
    const entryPath = path_1.default.join(options.runtimeRoot, ...options.entryRelativePath);
    const entryDescription = options.entryDescription || 'entry';
    if (!runtimeFs.existsSync(entryPath)) {
        throw new Error(`[${options.childLabel}] Missing bundled ${entryDescription}: ${entryPath}`);
    }
    const childModule = loadModule(entryPath);
    if (typeof childModule.main !== 'function') {
        throw new Error(`[${options.childLabel}] Bundled ${entryDescription} does not export main(argv?)`);
    }
    const originalArgv = processState.argv.slice();
    processState.argv = options.stripChildFlag(processState.argv);
    try {
        await childModule.main([]);
    }
    finally {
        processState.argv = originalArgv;
    }
}
function createDesktopRuntimeService(options, dependencies) {
    const runtimeFs = dependencies.fs ?? fs_1.default;
    const spawnChildProcess = dependencies.spawn ?? child_process_1.spawn;
    const createRandomHex = dependencies.createRandomHex ?? defaultRandomHex;
    const logger = resolveLogger(options.logger);
    let gatewayProcess = null;
    let workflowSidecarManager = null;
    let desktopPlanningPersistenceHandle = null;
    let serverHandle = null;
    let currentStartResult = null;
    async function stop() {
        currentStartResult = null;
        if (serverHandle) {
            const handle = serverHandle;
            serverHandle = null;
            await handle.close();
        }
        if (desktopPlanningPersistenceHandle) {
            const handle = desktopPlanningPersistenceHandle;
            desktopPlanningPersistenceHandle = null;
            await handle.stop();
        }
        if (workflowSidecarManager) {
            const handle = workflowSidecarManager;
            workflowSidecarManager = null;
            await handle.stop();
        }
        if (gatewayProcess) {
            const child = gatewayProcess;
            gatewayProcess = null;
            await stopChildProcess(child);
        }
    }
    async function start() {
        if (serverHandle && currentStartResult) {
            return currentStartResult;
        }
        const explicitPlanningDatabaseUrl = String(options.env.INSTRUCTION_ENGINE_PLANNING_DB_URL || '').trim();
        const desktopUiToken = createRandomHex(32);
        dependencies.ensureSdkBridgeDefaultEnabled(options.env);
        await dependencies.evaluateDesktopCliManagerState({
            runtimeRoot: options.paths.runtimeRoot,
            copilotHome: options.paths.copilotHome,
            isPackaged: options.isPackaged,
            appVersion: options.appVersion,
            appPath: options.appPath,
            currentDirname: options.currentDirname,
            env: options.env,
            platform: options.platform,
            logger,
        });
        ensureDefaultGatewayConfig(options.paths, runtimeFs);
        try {
            const trackerToken = String(options.env.INSTRUCTION_ENGINE_GATEWAY_HTTP_TOKEN || '').trim()
                || createRandomHex(32);
            options.env.INSTRUCTION_ENGINE_GATEWAY_HTTP_TOKEN = trackerToken;
            const localTrackerRoot = path_1.default.join(options.paths.runtimeRoot, 'local-tracker');
            if (runtimeFs.existsSync(localTrackerRoot)) {
                const gatewayEnv = {
                    ...options.env,
                    INSTRUCTION_ENGINE_GATEWAY_HTTP_TOKEN: trackerToken,
                    INSTRUCTION_ENGINE_GATEWAY_ALLOW_PLATFORMLESS: '1',
                    INSTRUCTION_ENGINE_GATEWAY_MODE: 'disconnected',
                    INSTRUCTION_ENGINE_GATEWAY_CONFIG_JSON: buildGatewayInlineConfig(options.paths.workspaceRoot),
                };
                gatewayProcess = options.isPackaged
                    ? options.shellAdapter.launchPackagedGatewayChild({
                        localTrackerRoot,
                        env: gatewayEnv,
                    })
                    : spawnGatewayDependencyForDevelopment(localTrackerRoot, trackerToken, options.paths.workspaceRoot, options, runtimeFs, spawnChildProcess);
            }
            workflowSidecarManager = await dependencies.startWorkflowSidecar({
                runtimeRoot: options.paths.runtimeRoot,
                processExecPath: options.processExecPath,
                isPackaged: options.isPackaged,
                copilotHome: options.paths.copilotHome,
                shellAdapter: options.shellAdapter,
            });
            if (options.isPackaged && !explicitPlanningDatabaseUrl) {
                desktopPlanningPersistenceHandle = await dependencies.startDesktopPlanningPersistence({
                    stateRoot: path_1.default.join(options.paths.copilotHome, 'planning-db'),
                    logger: (message) => logger.log(message),
                });
                options.env.INSTRUCTION_ENGINE_PLANNING_DB_URL = desktopPlanningPersistenceHandle.connectionString;
                options.env.INSTRUCTION_ENGINE_PLANNING_DB_REQUIRED = '1';
            }
            serverHandle = await dependencies.startServer({
                host: '127.0.0.1',
                port: resolveDesktopServerPort(options.env),
                copilotHome: options.paths.copilotHome,
                vscodeHome: options.paths.copilotHome,
                sandboxesHome: path_1.default.join(options.paths.copilotHome, 'sandboxes'),
                trackerUrl: 'http://127.0.0.1:4100',
                trackerToken,
                desktopUiToken,
                workflowSidecarManager,
                planningPersistenceClient: desktopPlanningPersistenceHandle?.queryClient,
                engineRoot: options.isPackaged ? options.paths.runtimeRoot : undefined,
                quiet: true,
            });
            currentStartResult = {
                host: serverHandle.host,
                port: serverHandle.port,
                windowUrl: buildDesktopWindowUrl(serverHandle.host, serverHandle.port, desktopUiToken),
                desktopUiToken,
                trackerUrl: 'http://127.0.0.1:4100',
                trackerToken,
            };
            if (options.env[DESKTOP_SMOKE_LOG_WINDOW_URL_ENV] === '1') {
                logger.log(`[desktop-smoke] window-url=${currentStartResult.windowUrl}`);
            }
            return currentStartResult;
        }
        catch (error) {
            await stop();
            throw error;
        }
    }
    return {
        start,
        stop,
        isRunning: () => serverHandle !== null,
        getWindowUrl: () => currentStartResult?.windowUrl || null,
    };
}
