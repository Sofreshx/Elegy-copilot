/// <reference path="./electron-externals.d.ts" />

import { spawn, type ChildProcess } from 'child_process';
import { randomBytes } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';

import { app, BrowserWindow, ipcMain, shell } from 'electron';

import {
  buildPackagedGatewayChildArgs,
  hasGatewayChildFlag,
  hasWorkflowSidecarChildFlag,
  stripGatewayChildFlag,
  stripWorkflowSidecarChildFlag,
} from './gatewayChildMode';
import { configureUpdater, createUnavailableUpdaterState, type UpdaterState } from './updater';
import { resolveDesktopReleaseChannelContract, type DesktopReleaseChannelContract } from './updatePolicy';
import { startWorkflowSidecar, type WorkflowSidecarManager } from './workflowSidecar';
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
let workflowSidecarManager: WorkflowSidecarManager | null = null;
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
const isWorkflowSidecarChildProcess = hasWorkflowSidecarChildFlag(process.argv);
const DESKTOP_UPDATER_STATE_EVENT = 'desktop-updater:state';
const DESKTOP_UI_ACCESS_QUERY_PARAM = 'desktop-ui-token';
const DESKTOP_SMOKE_LOG_WINDOW_URL_ENV = 'INSTRUCTION_ENGINE_DESKTOP_SMOKE_LOG_WINDOW_URL';

interface DesktopCliManagerState {
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

const dynamicImportModule = new Function(
  'specifier',
  'return import(specifier);',
) as (specifier: string) => Promise<Record<string, unknown>>;

function createDesktopCliManagerState(
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

function applyDesktopCliManagerStateToEnvFallback(state: DesktopCliManagerState, env: NodeJS.ProcessEnv): void {
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

function maybeDisableSdkBridgeForCliManagerState(state: DesktopCliManagerState, sdkBridgeRequested: boolean): void {
  if (sdkBridgeRequested && !state.approved) {
    process.env.COPILOT_SDK_BRIDGE = '0';
    console.warn(`[desktop-cli] blocked SDK bridge on ${state.channel} lane: ${state.reason || 'managed_cli_blocked'}`);
  } else if (sdkBridgeRequested && state.approved) {
    console.log(`[desktop-cli] using ${state.source} Copilot CLI for ${state.channel} lane`);
  }
}

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

async function evaluateDesktopCliManagerState(
  runtimeRoot: string,
  copilotHome: string,
): Promise<DesktopCliManagerState> {
  const sdkBridgeRequested = String(process.env.COPILOT_SDK_BRIDGE || '').trim() === '1';
  const releaseContract = resolveDesktopReleaseChannelContract({
    appVersion: app.getVersion(),
    explicitChannel: process.env.INSTRUCTION_ENGINE_UPDATE_CHANNEL || null,
  });
  const fallbackContract = releaseContract.contract;

  try {
    const appPackageJsonCandidates = [
      path.join(app.getAppPath(), 'package.json'),
      path.join(__dirname, '..', 'package.json'),
      path.join(runtimeRoot, 'copilot-ui', 'package.json'),
      path.join(runtimeRoot, 'package.json'),
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
      applyDesktopCliManagerStateToEnvFallback(state, process.env);
      maybeDisableSdkBridgeForCliManagerState(state, sdkBridgeRequested);
      return state;
    }

    const cliManagerModuleCandidates = [
      path.join(app.getAppPath(), 'lib', 'copilot-bridge', 'cliManager.mjs'),
      path.join(__dirname, '..', 'lib', 'copilot-bridge', 'cliManager.mjs'),
      path.join(runtimeRoot, 'copilot-ui', 'lib', 'copilot-bridge', 'cliManager.mjs'),
    ];
    const cliManagerModuleSourcePath = cliManagerModuleCandidates.find((candidate) => fs.existsSync(candidate));
    if (!cliManagerModuleSourcePath) {
      throw new Error('Desktop CLI manager module path is unavailable');
    }
    const cliManagerModulePath = pathToFileURL(cliManagerModuleSourcePath).href;
    const cliManagerModule = await dynamicImportModule(cliManagerModulePath) as {
      evaluateDesktopCliManagerState?: (options: Record<string, unknown>) => DesktopCliManagerState;
      applyDesktopCliManagerStateToEnv?: (state: DesktopCliManagerState, env: NodeJS.ProcessEnv) => NodeJS.ProcessEnv;
    };

    if (typeof cliManagerModule.evaluateDesktopCliManagerState !== 'function'
      || typeof cliManagerModule.applyDesktopCliManagerStateToEnv !== 'function') {
      throw new Error('Desktop CLI manager exports are unavailable');
    }

    const bundleRoot = app.isPackaged
      ? path.join(runtimeRoot, 'copilot-cli')
      : path.join(runtimeRoot, 'copilot-ui', 'resources', 'copilot-cli');
    const state = cliManagerModule.evaluateDesktopCliManagerState({
      channel: releaseContract.contract.cliChannel,
      sdkVersion: sdkVersion || '',
      copilotHome,
      bundleRoot,
      env: process.env,
      platform: process.platform,
    });

    cliManagerModule.applyDesktopCliManagerStateToEnv(state, process.env);
    maybeDisableSdkBridgeForCliManagerState(state, sdkBridgeRequested);
    return state;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const state = createDesktopCliManagerState(fallbackContract, null, {
      reason: 'managed_cli_bootstrap_failed',
      message: `Desktop Copilot CLI bootstrap failed: ${message}`,
    });
    applyDesktopCliManagerStateToEnvFallback(state, process.env);
    maybeDisableSdkBridgeForCliManagerState(state, sdkBridgeRequested);
    return state;
  }
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

async function runPackagedWorkflowSidecarChildProcess(): Promise<void> {
  const runtimeRoot = resolveEngineRoot();
  const distEntry = path.join(runtimeRoot, 'local-tracker', 'dist', 'messagingGateway', 'workflowSidecar.js');
  if (!fs.existsSync(distEntry)) {
    throw new Error(`[workflow-sidecar-child] Missing bundled workflow sidecar entry: ${distEntry}`);
  }

  const workflowSidecarModule = require(distEntry) as { main?: (argv?: string[]) => Promise<void> };
  if (typeof workflowSidecarModule.main !== 'function') {
    throw new Error('[workflow-sidecar-child] Bundled workflow sidecar entry does not export main(argv?)');
  }

  const originalArgv = process.argv.slice();
  process.argv = stripWorkflowSidecarChildFlag(process.argv);
  try {
    await workflowSidecarModule.main([]);
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
  await evaluateDesktopCliManagerState(runtimeRoot, copilotHome);
  ensureDefaultGatewayConfig(workspaceRoot);
  try {
    const gateway = await startGatewayDependency(runtimeRoot, workspaceRoot);
    workflowSidecarManager = await startWorkflowSidecar({
      runtimeRoot,
      processExecPath: process.execPath,
      isPackaged: app.isPackaged,
      copilotHome,
    });
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
      workflowSidecarManager,
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

  if (workflowSidecarManager) {
    const handle = workflowSidecarManager;
    workflowSidecarManager = null;
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
} else if (isWorkflowSidecarChildProcess) {
  app.whenReady().then(async () => {
    await runPackagedWorkflowSidecarChildProcess();
  }).catch((error: unknown) => {
    console.error('[workflow-sidecar-child] startup failed', error);
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
