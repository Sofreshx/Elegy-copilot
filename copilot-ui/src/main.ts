/// <reference path="./electron-externals.d.ts" />

import { spawn, type ChildProcess } from 'child_process';
import { randomBytes } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { app, BrowserWindow, ipcMain, shell } from 'electron';

import { buildPackagedGatewayChildArgs, hasGatewayChildFlag, stripGatewayChildFlag } from './gatewayChildMode';
import { configureUpdater, createUnavailableUpdaterState, type UpdaterState } from './updater';
const { startDesktopPlanningPersistence } = require('../lib/desktopPlanningPersistence.js') as {
  startDesktopPlanningPersistence: (options: Record<string, unknown>) => Promise<{
    connectionString: string;
    queryClient: {
      query: (sql: string, params?: unknown[]) => Promise<unknown>;
    };
    stop: () => Promise<void>;
  }>;
};

const { startServer } = require('../server.js') as {
  startServer: (options: Record<string, unknown>) => Promise<{
    host: string;
    port: number;
    close: () => Promise<void>;
  }>;
};

let mainWindow: any = null;
let serverHandle: { host: string; port: number; close: () => Promise<void> } | null = null;
let desktopWindowUrl: string | null = null;
let gatewayProcess: ChildProcess | null = null;
let desktopPlanningPersistenceHandle: {
  connectionString: string;
  queryClient: {
    query: (sql: string, params?: unknown[]) => Promise<unknown>;
  };
  stop: () => Promise<void>;
} | null = null;
let updaterController: ReturnType<typeof configureUpdater> | null = null;
let disposeUpdaterSubscription: (() => void) | null = null;
let desktopShutdownStarted = false;
let desktopShutdownPromise: Promise<void> | null = null;

const isGatewayChildProcess = hasGatewayChildFlag(process.argv);
const DESKTOP_UPDATER_STATE_EVENT = 'desktop-updater:state';
const DESKTOP_UI_ACCESS_QUERY_PARAM = 'desktop-ui-token';
const DESKTOP_SMOKE_LOG_WINDOW_URL_ENV = 'INSTRUCTION_ENGINE_DESKTOP_SMOKE_LOG_WINDOW_URL';

function resolveEngineRoot(): string {
  if (app.isPackaged) {
    return path.resolve(process.resourcesPath);
  }

  return path.resolve(__dirname, '..', '..');
}

function resolveDefaultWorkspaceRoot(runtimeRoot: string): string {
  return fs.existsSync(runtimeRoot) ? runtimeRoot : path.resolve(process.cwd());
}

function ensureSdkBridgeDefaultEnabled(): void {
  if (Object.prototype.hasOwnProperty.call(process.env, 'COPILOT_SDK_BRIDGE')) {
    return;
  }

  process.env.COPILOT_SDK_BRIDGE =
    String(process.env.INSTRUCTION_ENGINE_DISABLE_SDK_BRIDGE || '').trim() === '1'
      ? '0'
      : '1';
}

function ensureDefaultGatewayConfig(workspaceRoot: string): void {
  const configPath = path.join(os.homedir(), '.copilot', 'messaging-gateway.config.json');
  const legacyConfigPath = path.join(os.homedir(), '.instruction-engine', 'messaging-gateway.config.json');
  if (fs.existsSync(configPath)) {
    return;
  }

  if (fs.existsSync(legacyConfigPath)) {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    try {
      fs.renameSync(legacyConfigPath, configPath);
    } catch {
      fs.copyFileSync(legacyConfigPath, configPath);
      try {
        fs.unlinkSync(legacyConfigPath);
      } catch {
        // best-effort cleanup after successful rehome
      }
    }
    return;
  }

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(
    configPath,
    JSON.stringify(
      {
        mode: 'auto',
        acp: {
          host: '127.0.0.1',
          port: 3000,
        },
        workspaces: {
          allowedRoots: [workspaceRoot],
          activeRoot: workspaceRoot,
        },
      },
      null,
      2
    ),
    'utf8'
  );
}

function resolveDesktopServerPort(): number {
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

function buildGatewayInlineConfig(workspaceRoot: string): string {
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

function spawnGatewayDependency(localTrackerRoot: string, trackerToken: string, workspaceRoot: string): ChildProcess | null {
  const env = {
    ...process.env,
    INSTRUCTION_ENGINE_GATEWAY_HTTP_TOKEN: trackerToken,
    INSTRUCTION_ENGINE_GATEWAY_ALLOW_PLATFORMLESS: '1',
    INSTRUCTION_ENGINE_GATEWAY_MODE: 'disconnected',
    INSTRUCTION_ENGINE_GATEWAY_CONFIG_JSON: buildGatewayInlineConfig(workspaceRoot),
  };

  const distEntry = path.join(localTrackerRoot, 'dist', 'messagingGateway', 'index.js');
  if (fs.existsSync(distEntry)) {
    if (app.isPackaged) {
      return spawn(process.execPath, buildPackagedGatewayChildArgs(), {
        cwd: localTrackerRoot,
        env,
        stdio: 'ignore',
        windowsHide: true,
      });
    }

    return spawn(process.execPath, [distEntry], {
      cwd: localTrackerRoot,
      env,
      stdio: 'ignore',
      windowsHide: true,
    });
  }

  if (app.isPackaged) {
    return null;
  }

  const srcEntry = path.join(localTrackerRoot, 'src', 'messagingGateway', 'index.ts');
  if (fs.existsSync(srcEntry)) {
    const tsNodeBin = path.join(
      localTrackerRoot,
      'node_modules',
      '.bin',
      process.platform === 'win32' ? 'ts-node.cmd' : 'ts-node'
    );
    if (fs.existsSync(tsNodeBin)) {
      return spawn(tsNodeBin, [srcEntry], {
        cwd: localTrackerRoot,
        env,
        stdio: 'ignore',
        windowsHide: true,
      });
    }

    const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    return spawn(npmCommand, ['run', 'dev:gateway'], {
      cwd: localTrackerRoot,
      env,
      stdio: 'ignore',
      windowsHide: true,
    });
  }

  return null;
}

async function startGatewayDependency(
  runtimeRoot: string,
  workspaceRoot: string
): Promise<{ trackerUrl: string; trackerToken: string }> {
  const trackerToken =
    String(process.env.INSTRUCTION_ENGINE_GATEWAY_HTTP_TOKEN || '').trim() || randomBytes(32).toString('hex');
  process.env.INSTRUCTION_ENGINE_GATEWAY_HTTP_TOKEN = trackerToken;

  const localTrackerRoot = path.join(runtimeRoot, 'local-tracker');
  if (fs.existsSync(localTrackerRoot)) {
    gatewayProcess = spawnGatewayDependency(localTrackerRoot, trackerToken, workspaceRoot);
  }

  return {
    trackerUrl: 'http://127.0.0.1:4100',
    trackerToken,
  };
}

async function runPackagedGatewayChildProcess(): Promise<void> {
  const runtimeRoot = resolveEngineRoot();
  const distEntry = path.join(runtimeRoot, 'local-tracker', 'dist', 'messagingGateway', 'index.js');
  if (!fs.existsSync(distEntry)) {
    throw new Error(`[gateway-child] Missing bundled gateway entry: ${distEntry}`);
  }

  const gatewayModule = require(distEntry) as { main?: (argv?: string[]) => Promise<void> };
  if (typeof gatewayModule.main !== 'function') {
    throw new Error('[gateway-child] Bundled gateway entry does not export main(argv?)');
  }

  const originalArgv = process.argv.slice();
  process.argv = stripGatewayChildFlag(process.argv);
  try {
    await gatewayModule.main([]);
  } finally {
    process.argv = originalArgv;
  }
}

async function stopGatewayDependency(): Promise<void> {
  if (!gatewayProcess) return;
  const child = gatewayProcess;
  gatewayProcess = null;
  if (child.exitCode != null || child.killed) return;

  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    child.once('exit', finish);
    try {
      child.kill();
    } catch {
      finish();
      return;
    }

    setTimeout(finish, 2000);
  });
}

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

function buildDesktopWindowUrl(host: string, port: number, desktopUiToken: string): string {
  const url = new URL(`http://${host}:${port}/`);
  url.searchParams.set(DESKTOP_UI_ACCESS_QUERY_PARAM, desktopUiToken);
  return url.toString();
}

function focusOrRestoreMainWindow(): void {
  const currentWindow = mainWindow && typeof mainWindow.isDestroyed === 'function' && !mainWindow.isDestroyed()
    ? mainWindow
    : BrowserWindow.getAllWindows()[0] || null;

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
  const home = os.homedir();
  const copilotHome = path.join(home, '.copilot');
  const runtimeRoot = resolveEngineRoot();
  const workspaceRoot = resolveDefaultWorkspaceRoot(runtimeRoot);
  const engineRootOverride = app.isPackaged ? runtimeRoot : undefined;
  const explicitPlanningDatabaseUrl = String(process.env.INSTRUCTION_ENGINE_PLANNING_DB_URL || '').trim();
  const desktopUiToken = randomBytes(32).toString('hex');

  ensureSdkBridgeDefaultEnabled();
  ensureDefaultGatewayConfig(workspaceRoot);
  try {
    const gateway = await startGatewayDependency(runtimeRoot, workspaceRoot);
    if (app.isPackaged && !explicitPlanningDatabaseUrl) {
      desktopPlanningPersistenceHandle = await startDesktopPlanningPersistence({
        stateRoot: path.join(copilotHome, 'planning-db'),
        logger: (message: string) => console.log(message),
      });
      process.env.INSTRUCTION_ENGINE_PLANNING_DB_URL = desktopPlanningPersistenceHandle.connectionString;
      process.env.INSTRUCTION_ENGINE_PLANNING_DB_REQUIRED = '1';
    }

    serverHandle = await startServer({
      host: '127.0.0.1',
      port: resolveDesktopServerPort(),
      copilotHome,
      vscodeHome: copilotHome,
      sandboxesHome: path.join(copilotHome, 'sandboxes'),
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
  } catch (error) {
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

function getUpdaterState(): UpdaterState {
  if (updaterController) {
    return updaterController.getState();
  }

  return createUnavailableUpdaterState(app.getVersion(), 'updater_not_initialized');
}

function broadcastUpdaterState(state: UpdaterState): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) {
      continue;
    }
    window.webContents.send(DESKTOP_UPDATER_STATE_EVENT, state);
  }
}

ipcMain.handle('desktop-updater:get-state', async () => getUpdaterState());
ipcMain.handle('desktop-updater:check-for-updates', async () => {
  if (!updaterController) {
    return getUpdaterState();
  }
  return updaterController.checkForUpdates();
});
ipcMain.handle('desktop-updater:download-update', async () => {
  if (!updaterController) {
    return getUpdaterState();
  }
  return updaterController.downloadUpdate();
});
ipcMain.handle('desktop-updater:restart-to-update', async () => {
  if (!updaterController) {
    return false;
  }
  return updaterController.restartToUpdate();
});

async function bootstrap() {
  const baseUrl = await startDashboardServer();
  mainWindow = createWindow(baseUrl);

  updaterController = configureUpdater({
    appVersion: app.getVersion(),
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
  app.whenReady().then(async () => {
    await runPackagedGatewayChildProcess();
  }).catch((error: unknown) => {
    console.error('[gateway-child] startup failed', error);
    app.exit(1);
  });
} else {
  const hasSingleInstanceLock = app.requestSingleInstanceLock();
  if (!hasSingleInstanceLock) {
    app.quit();
  } else {
    app.on('second-instance', () => {
      focusOrRestoreMainWindow();
    });

    app.whenReady().then(async () => {
      try {
        await bootstrap();
      } catch (error) {
        console.error('[desktop] bootstrap failed', error);
        await stopDashboardServer();
        app.exit(1);
        return;
      }

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0 && !serverHandle) {
          void bootstrap().catch(async (error) => {
            console.error('[desktop] activate bootstrap failed', error);
            await stopDashboardServer();
            app.exit(1);
          });
          return;
        }

        if (BrowserWindow.getAllWindows().length === 0 && serverHandle) {
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

app.on('window-all-closed', async () => {
  mainWindow = null;
  if (process.platform !== 'darwin') {
    await stopDashboardServer();
    app.quit();
  }
});

app.on('before-quit', (event: { preventDefault: () => void }) => {
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
      app.exit(0);
    });
});
