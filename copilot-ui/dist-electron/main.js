"use strict";
/// <reference path="./electron-externals.d.ts" />
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const electron_1 = require("electron");
const updater_1 = require("./updater");
const { startServer } = require('../server.js');
let mainWindow = null;
let serverHandle = null;
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
    serverHandle = await startServer({
        host: '127.0.0.1',
        port: 0,
        copilotHome,
        vscodeHome: copilotHome,
        sandboxesHome: path_1.default.join(copilotHome, 'sandboxes'),
        quiet: true,
    });
    return `http://${serverHandle.host}:${serverHandle.port}/`;
}
async function stopDashboardServer() {
    if (!serverHandle)
        return;
    const handle = serverHandle;
    serverHandle = null;
    await handle.close();
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
