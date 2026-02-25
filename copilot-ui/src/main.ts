/// <reference path="./electron-externals.d.ts" />

import os from 'os';
import path from 'path';

import { app, BrowserWindow, shell } from 'electron';

import { configureUpdater } from './updater';

const { startServer } = require('../server.js') as {
  startServer: (options: Record<string, unknown>) => Promise<{
    host: string;
    port: number;
    close: () => Promise<void>;
  }>;
};

let mainWindow: any = null;
let serverHandle: { host: string; port: number; close: () => Promise<void> } | null = null;

function createWindow(baseUrl: string) {
  const window = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  void window.loadURL(baseUrl);

  window.webContents.setWindowOpenHandler(({ url }: { url: string }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  return window;
}

async function startDashboardServer() {
  const home = os.homedir();
  const copilotHome = path.join(home, '.copilot');

  serverHandle = await startServer({
    host: '127.0.0.1',
    port: 0,
    copilotHome,
    vscodeHome: copilotHome,
    sandboxesHome: path.join(copilotHome, 'sandboxes'),
    quiet: true,
  });

  return `http://${serverHandle.host}:${serverHandle.port}/`;
}

async function stopDashboardServer() {
  if (!serverHandle) return;
  const handle = serverHandle;
  serverHandle = null;
  await handle.close();
}

async function bootstrap() {
  const baseUrl = await startDashboardServer();
  mainWindow = createWindow(baseUrl);

  const updater = configureUpdater({
    appVersion: app.getVersion(),
    explicitChannel: process.env.INSTRUCTION_ENGINE_UPDATE_CHANNEL || null,
    rollbackPolicyJson: process.env.INSTRUCTION_ENGINE_ROLLBACK_POLICY_JSON || null,
    disableUpdates: process.env.INSTRUCTION_ENGINE_DISABLE_UPDATES || null,
    logger: (message) => console.log(message),
  });
  void updater.checkForUpdates().catch(() => {
    // best-effort baseline; update policy hardening follows in next work units
  });
}

app.whenReady().then(async () => {
  await bootstrap();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && serverHandle) {
      const baseUrl = `http://${serverHandle.host}:${serverHandle.port}/`;
      mainWindow = createWindow(baseUrl);
    }
  });
});

app.on('window-all-closed', async () => {
  mainWindow = null;
  await stopDashboardServer();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (mainWindow) {
    mainWindow.removeAllListeners('close');
  }
});
