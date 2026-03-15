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
const updater_1 = require("./updater");
const { startEmbeddedPostgresRuntime } = require('../lib/embeddedPostgresRuntime.js');
const { startServer } = require('../server.js');
let mainWindow = null;
let serverHandle = null;
let gatewayProcess = null;
let embeddedPostgresHandle = null;
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
async function startDashboardServer() {
    const home = os_1.default.homedir();
    const copilotHome = path_1.default.join(home, '.copilot');
    const runtimeRoot = resolveEngineRoot();
    const workspaceRoot = resolveDefaultWorkspaceRoot(runtimeRoot);
    const engineRootOverride = electron_1.app.isPackaged ? runtimeRoot : undefined;
    ensureSdkBridgeDefaultEnabled();
    ensureDefaultGatewayConfig(workspaceRoot);
    const gateway = await startGatewayDependency(runtimeRoot, workspaceRoot);
    if (electron_1.app.isPackaged) {
        try {
            embeddedPostgresHandle = await startEmbeddedPostgresRuntime({
                runtimeRoot,
                logger: (message) => console.log(message),
            });
            if (embeddedPostgresHandle) {
                process.env.INSTRUCTION_ENGINE_PLANNING_DB_URL = embeddedPostgresHandle.connectionString;
                process.env.INSTRUCTION_ENGINE_PLANNING_DB_REQUIRED = '1';
            }
        }
        catch (error) {
            embeddedPostgresHandle = null;
            console.warn('[embedded-postgres] startup failed; continuing without persistence', error);
        }
    }
    serverHandle = await startServer({
        host: '127.0.0.1',
        port: 0,
        copilotHome,
        vscodeHome: copilotHome,
        sandboxesHome: path_1.default.join(copilotHome, 'sandboxes'),
        trackerUrl: gateway.trackerUrl,
        trackerToken: gateway.trackerToken,
        planningPersistenceClient: embeddedPostgresHandle ? embeddedPostgresHandle.queryClient : undefined,
        engineRoot: engineRootOverride,
        quiet: true,
    });
    return `http://${serverHandle.host}:${serverHandle.port}/`;
}
async function stopDashboardServer() {
    if (serverHandle) {
        const handle = serverHandle;
        serverHandle = null;
        await handle.close();
    }
    if (embeddedPostgresHandle) {
        const handle = embeddedPostgresHandle;
        embeddedPostgresHandle = null;
        await handle.stop();
    }
    await stopGatewayDependency();
}
async function bootstrap() {
    const baseUrl = await startDashboardServer();
    mainWindow = createWindow(baseUrl);
    const updater = (0, updater_1.configureUpdater)({
        appVersion: electron_1.app.getVersion(),
        explicitChannel: process.env.INSTRUCTION_ENGINE_UPDATE_CHANNEL || null,
        rollbackPolicyJson: process.env.INSTRUCTION_ENGINE_ROLLBACK_POLICY_JSON || null,
        disableUpdates: process.env.INSTRUCTION_ENGINE_DISABLE_UPDATES || null,
        logger: (message) => console.log(message),
    });
    void updater.checkForUpdates().catch(() => {
        // best-effort baseline; update policy hardening follows in next work units
    });
}
electron_1.app.whenReady().then(async () => {
    await bootstrap();
    electron_1.app.on('activate', () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0 && serverHandle) {
            const baseUrl = `http://${serverHandle.host}:${serverHandle.port}/`;
            mainWindow = createWindow(baseUrl);
        }
    });
});
electron_1.app.on('window-all-closed', async () => {
    mainWindow = null;
    await stopDashboardServer();
    if (process.platform !== 'darwin') {
        electron_1.app.quit();
    }
});
electron_1.app.on('before-quit', () => {
    if (mainWindow) {
        mainWindow.removeAllListeners('close');
    }
});
