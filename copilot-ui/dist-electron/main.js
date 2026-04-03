"use strict";
/// <reference path="./electron-externals.d.ts" />
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const child_process_1 = require("child_process");
const crypto_1 = require("crypto");
const fs_1 = __importDefault(require("fs"));
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const electron_1 = require("electron");
const gatewayChildMode_1 = require("./gatewayChildMode");
const updater_1 = require("./updater");
const { startDesktopPlanningPersistence } = require('../lib/desktopPlanningPersistence.js');
const { startServer } = require('../server.js');
let mainWindow = null;
let serverHandle = null;
let desktopWindowUrl = null;
let gatewayProcess = null;
let desktopPlanningPersistenceHandle = null;
let updaterController = null;
let disposeUpdaterSubscription = null;
let desktopShutdownStarted = false;
let desktopShutdownPromise = null;
const isGatewayChildProcess = (0, gatewayChildMode_1.hasGatewayChildFlag)(process.argv);
const DESKTOP_UPDATER_STATE_EVENT = 'desktop-updater:state';
const DESKTOP_UI_ACCESS_QUERY_PARAM = 'desktop-ui-token';
const DESKTOP_SMOKE_LOG_WINDOW_URL_ENV = 'INSTRUCTION_ENGINE_DESKTOP_SMOKE_LOG_WINDOW_URL';
function resolveEngineRoot() {
    if (electron_1.app.isPackaged) {
        return path_1.default.resolve(process.resourcesPath);
    }
    return path_1.default.resolve(__dirname, '..', '..');
}
function resolveDefaultWorkspaceRoot(runtimeRoot) {
    return fs_1.default.existsSync(runtimeRoot) ? runtimeRoot : path_1.default.resolve(process.cwd());
}
function ensureSdkBridgeDefaultEnabled() {
    if (Object.prototype.hasOwnProperty.call(process.env, 'COPILOT_SDK_BRIDGE')) {
        return;
    }
    process.env.COPILOT_SDK_BRIDGE =
        String(process.env.INSTRUCTION_ENGINE_DISABLE_SDK_BRIDGE || '').trim() === '1'
            ? '0'
            : '1';
}
function ensureDefaultGatewayConfig(workspaceRoot) {
    const configPath = path_1.default.join(os_1.default.homedir(), '.copilot', 'messaging-gateway.config.json');
    const legacyConfigPath = path_1.default.join(os_1.default.homedir(), '.instruction-engine', 'messaging-gateway.config.json');
    if (fs_1.default.existsSync(configPath)) {
        return;
    }
    if (fs_1.default.existsSync(legacyConfigPath)) {
        fs_1.default.mkdirSync(path_1.default.dirname(configPath), { recursive: true });
        try {
            fs_1.default.renameSync(legacyConfigPath, configPath);
        }
        catch {
            fs_1.default.copyFileSync(legacyConfigPath, configPath);
            try {
                fs_1.default.unlinkSync(legacyConfigPath);
            }
            catch {
                // best-effort cleanup after successful rehome
            }
        }
        return;
    }
    fs_1.default.mkdirSync(path_1.default.dirname(configPath), { recursive: true });
    fs_1.default.writeFileSync(configPath, JSON.stringify({
        mode: 'auto',
        acp: {
            host: '127.0.0.1',
            port: 3000,
        },
        workspaces: {
            allowedRoots: [workspaceRoot],
            activeRoot: workspaceRoot,
        },
    }, null, 2), 'utf8');
}
function resolveDesktopServerPort() {
    const rawValue = String(process.env.INSTRUCTION_ENGINE_DESKTOP_SERVER_PORT || '').trim();
    if (!rawValue) {
        return 0;
    }
    const parsed = Number(rawValue);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
        throw new Error(`Invalid INSTRUCTION_ENGINE_DESKTOP_SERVER_PORT: ${rawValue}`);
    }
    return parsed;
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
function spawnGatewayDependency(localTrackerRoot, trackerToken, workspaceRoot) {
    const env = {
        ...process.env,
        INSTRUCTION_ENGINE_GATEWAY_HTTP_TOKEN: trackerToken,
        INSTRUCTION_ENGINE_GATEWAY_ALLOW_PLATFORMLESS: '1',
        INSTRUCTION_ENGINE_GATEWAY_MODE: 'disconnected',
        INSTRUCTION_ENGINE_GATEWAY_CONFIG_JSON: buildGatewayInlineConfig(workspaceRoot),
    };
    const distEntry = path_1.default.join(localTrackerRoot, 'dist', 'messagingGateway', 'index.js');
    if (fs_1.default.existsSync(distEntry)) {
        if (electron_1.app.isPackaged) {
            return (0, child_process_1.spawn)(process.execPath, (0, gatewayChildMode_1.buildPackagedGatewayChildArgs)(), {
                cwd: localTrackerRoot,
                env,
                stdio: 'ignore',
                windowsHide: true,
            });
        }
        return (0, child_process_1.spawn)(process.execPath, [distEntry], {
            cwd: localTrackerRoot,
            env,
            stdio: 'ignore',
            windowsHide: true,
        });
    }
    if (electron_1.app.isPackaged) {
        return null;
    }
    const srcEntry = path_1.default.join(localTrackerRoot, 'src', 'messagingGateway', 'index.ts');
    if (fs_1.default.existsSync(srcEntry)) {
        const tsNodeBin = path_1.default.join(localTrackerRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'ts-node.cmd' : 'ts-node');
        if (fs_1.default.existsSync(tsNodeBin)) {
            return (0, child_process_1.spawn)(tsNodeBin, [srcEntry], {
                cwd: localTrackerRoot,
                env,
                stdio: 'ignore',
                windowsHide: true,
            });
        }
        const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
        return (0, child_process_1.spawn)(npmCommand, ['run', 'dev:gateway'], {
            cwd: localTrackerRoot,
            env,
            stdio: 'ignore',
            windowsHide: true,
        });
    }
    return null;
}
async function startGatewayDependency(runtimeRoot, workspaceRoot) {
    const trackerToken = String(process.env.INSTRUCTION_ENGINE_GATEWAY_HTTP_TOKEN || '').trim() || (0, crypto_1.randomBytes)(32).toString('hex');
    process.env.INSTRUCTION_ENGINE_GATEWAY_HTTP_TOKEN = trackerToken;
    const localTrackerRoot = path_1.default.join(runtimeRoot, 'local-tracker');
    if (fs_1.default.existsSync(localTrackerRoot)) {
        gatewayProcess = spawnGatewayDependency(localTrackerRoot, trackerToken, workspaceRoot);
    }
    return {
        trackerUrl: 'http://127.0.0.1:4100',
        trackerToken,
    };
}
async function runPackagedGatewayChildProcess() {
    const runtimeRoot = resolveEngineRoot();
    const distEntry = path_1.default.join(runtimeRoot, 'local-tracker', 'dist', 'messagingGateway', 'index.js');
    if (!fs_1.default.existsSync(distEntry)) {
        throw new Error(`[gateway-child] Missing bundled gateway entry: ${distEntry}`);
    }
    const gatewayModule = require(distEntry);
    if (typeof gatewayModule.main !== 'function') {
        throw new Error('[gateway-child] Bundled gateway entry does not export main(argv?)');
    }
    const originalArgv = process.argv.slice();
    process.argv = (0, gatewayChildMode_1.stripGatewayChildFlag)(process.argv);
    try {
        await gatewayModule.main([]);
    }
    finally {
        process.argv = originalArgv;
    }
}
async function stopGatewayDependency() {
    if (!gatewayProcess)
        return;
    const child = gatewayProcess;
    gatewayProcess = null;
    if (child.exitCode != null || child.killed)
        return;
    await new Promise((resolve) => {
        let settled = false;
        const finish = () => {
            if (settled)
                return;
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
        setTimeout(finish, 2000);
    });
}
function createWindow(baseUrl) {
    const window = new electron_1.BrowserWindow({
        width: 1360,
        height: 900,
        minWidth: 1100,
        minHeight: 720,
        webPreferences: {
            preload: path_1.default.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });
    void window.loadURL(baseUrl);
    window.webContents.setWindowOpenHandler(({ url }) => {
        void electron_1.shell.openExternal(url);
        return { action: 'deny' };
    });
    return window;
}
function buildDesktopWindowUrl(host, port, desktopUiToken) {
    const url = new URL(`http://${host}:${port}/`);
    url.searchParams.set(DESKTOP_UI_ACCESS_QUERY_PARAM, desktopUiToken);
    return url.toString();
}
function focusOrRestoreMainWindow() {
    const currentWindow = mainWindow && typeof mainWindow.isDestroyed === 'function' && !mainWindow.isDestroyed()
        ? mainWindow
        : electron_1.BrowserWindow.getAllWindows()[0] || null;
    if (currentWindow) {
        if (typeof currentWindow.isMinimized === 'function' && currentWindow.isMinimized()) {
            currentWindow.restore();
        }
        currentWindow.focus();
        mainWindow = currentWindow;
        return;
    }
    if (serverHandle) {
        mainWindow = createWindow(desktopWindowUrl || `http://${serverHandle.host}:${serverHandle.port}/`);
    }
}
async function startDashboardServer() {
    const home = os_1.default.homedir();
    const copilotHome = path_1.default.join(home, '.copilot');
    const runtimeRoot = resolveEngineRoot();
    const workspaceRoot = resolveDefaultWorkspaceRoot(runtimeRoot);
    const engineRootOverride = electron_1.app.isPackaged ? runtimeRoot : undefined;
    const explicitPlanningDatabaseUrl = String(process.env.INSTRUCTION_ENGINE_PLANNING_DB_URL || '').trim();
    const desktopUiToken = (0, crypto_1.randomBytes)(32).toString('hex');
    ensureSdkBridgeDefaultEnabled();
    ensureDefaultGatewayConfig(workspaceRoot);
    try {
        const gateway = await startGatewayDependency(runtimeRoot, workspaceRoot);
        if (electron_1.app.isPackaged && !explicitPlanningDatabaseUrl) {
            desktopPlanningPersistenceHandle = await startDesktopPlanningPersistence({
                stateRoot: path_1.default.join(copilotHome, 'planning-db'),
                logger: (message) => console.log(message),
            });
            process.env.INSTRUCTION_ENGINE_PLANNING_DB_URL = desktopPlanningPersistenceHandle.connectionString;
            process.env.INSTRUCTION_ENGINE_PLANNING_DB_REQUIRED = '1';
        }
        serverHandle = await startServer({
            host: '127.0.0.1',
            port: resolveDesktopServerPort(),
            copilotHome,
            vscodeHome: copilotHome,
            sandboxesHome: path_1.default.join(copilotHome, 'sandboxes'),
            trackerUrl: gateway.trackerUrl,
            trackerToken: gateway.trackerToken,
            desktopUiToken,
            planningPersistenceClient: desktopPlanningPersistenceHandle
                ? desktopPlanningPersistenceHandle.queryClient
                : undefined,
            engineRoot: engineRootOverride,
            quiet: true,
        });
        desktopWindowUrl = buildDesktopWindowUrl(serverHandle.host, serverHandle.port, desktopUiToken);
        if (process.env[DESKTOP_SMOKE_LOG_WINDOW_URL_ENV] === '1') {
            console.log(`[desktop-smoke] window-url=${desktopWindowUrl}`);
        }
        return desktopWindowUrl;
    }
    catch (error) {
        await stopDashboardServer();
        throw error;
    }
}
async function stopDashboardServer() {
    desktopWindowUrl = null;
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
    await stopGatewayDependency();
}
async function shutdownDesktopRuntime() {
    disposeUpdaterSubscription?.();
    disposeUpdaterSubscription = null;
    if (mainWindow) {
        mainWindow.removeAllListeners('close');
    }
    await stopDashboardServer();
}
function getUpdaterState() {
    if (updaterController) {
        return updaterController.getState();
    }
    return (0, updater_1.createUnavailableUpdaterState)(electron_1.app.getVersion(), 'updater_not_initialized');
}
function broadcastUpdaterState(state) {
    for (const window of electron_1.BrowserWindow.getAllWindows()) {
        if (window.isDestroyed()) {
            continue;
        }
        window.webContents.send(DESKTOP_UPDATER_STATE_EVENT, state);
    }
}
electron_1.ipcMain.handle('desktop-updater:get-state', async () => getUpdaterState());
electron_1.ipcMain.handle('desktop-updater:check-for-updates', async () => {
    if (!updaterController) {
        return getUpdaterState();
    }
    return updaterController.checkForUpdates();
});
electron_1.ipcMain.handle('desktop-updater:download-update', async () => {
    if (!updaterController) {
        return getUpdaterState();
    }
    return updaterController.downloadUpdate();
});
electron_1.ipcMain.handle('desktop-updater:restart-to-update', async () => {
    if (!updaterController) {
        return false;
    }
    return updaterController.restartToUpdate();
});
async function bootstrap() {
    const baseUrl = await startDashboardServer();
    mainWindow = createWindow(baseUrl);
    updaterController = (0, updater_1.configureUpdater)({
        appVersion: electron_1.app.getVersion(),
        explicitChannel: process.env.INSTRUCTION_ENGINE_UPDATE_CHANNEL || null,
        rollbackPolicyJson: process.env.INSTRUCTION_ENGINE_ROLLBACK_POLICY_JSON || null,
        disableUpdates: process.env.INSTRUCTION_ENGINE_DISABLE_UPDATES || null,
        logger: (message) => console.log(message),
    });
    disposeUpdaterSubscription?.();
    disposeUpdaterSubscription = updaterController.subscribe((state) => {
        broadcastUpdaterState(state);
    });
    broadcastUpdaterState(updaterController.getState());
    void updaterController.checkForUpdates().catch(() => {
        // best-effort baseline; update policy hardening follows in next work units
    });
}
if (isGatewayChildProcess) {
    electron_1.app.whenReady().then(async () => {
        await runPackagedGatewayChildProcess();
    }).catch((error) => {
        console.error('[gateway-child] startup failed', error);
        electron_1.app.exit(1);
    });
}
else {
    const hasSingleInstanceLock = electron_1.app.requestSingleInstanceLock();
    if (!hasSingleInstanceLock) {
        electron_1.app.quit();
    }
    else {
        electron_1.app.on('second-instance', () => {
            focusOrRestoreMainWindow();
        });
        electron_1.app.whenReady().then(async () => {
            try {
                await bootstrap();
            }
            catch (error) {
                console.error('[desktop] bootstrap failed', error);
                await stopDashboardServer();
                electron_1.app.exit(1);
                return;
            }
            electron_1.app.on('activate', () => {
                if (electron_1.BrowserWindow.getAllWindows().length === 0 && !serverHandle) {
                    void bootstrap().catch(async (error) => {
                        console.error('[desktop] activate bootstrap failed', error);
                        await stopDashboardServer();
                        electron_1.app.exit(1);
                    });
                    return;
                }
                if (electron_1.BrowserWindow.getAllWindows().length === 0 && serverHandle) {
                    if (!desktopWindowUrl) {
                        console.error('[desktop] missing desktop window URL while server is running');
                        return;
                    }
                    mainWindow = createWindow(desktopWindowUrl);
                    return;
                }
                focusOrRestoreMainWindow();
            });
        });
    }
}
electron_1.app.on('window-all-closed', async () => {
    mainWindow = null;
    if (process.platform !== 'darwin') {
        await stopDashboardServer();
        electron_1.app.quit();
    }
});
electron_1.app.on('before-quit', (event) => {
    if (desktopShutdownStarted) {
        return;
    }
    event.preventDefault();
    desktopShutdownStarted = true;
    desktopShutdownPromise ??= shutdownDesktopRuntime()
        .catch((error) => {
        console.error('[desktop] shutdown failed', error);
    })
        .finally(() => {
        electron_1.app.exit(0);
    });
});
