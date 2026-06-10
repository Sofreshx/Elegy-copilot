import { randomBytes } from 'crypto';
import { spawn as defaultSpawn, type ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';

import type { WorkflowSidecarManager } from '../workflowSidecar';
import type { RuntimeDiagnostics, RuntimeDiagnosticPayload } from './runtimeDiagnostics';

const DESKTOP_UI_ACCESS_QUERY_PARAM = 'desktop-ui-token';
const DESKTOP_SMOKE_LOG_WINDOW_URL_ENV = 'INSTRUCTION_ENGINE_DESKTOP_SMOKE_LOG_WINDOW_URL';
const BOOT_DIAGNOSTIC_PREFIX = '[boot:runtimeService]';

function bootLog(message: string): void {
  process.stderr.write(`${BOOT_DIAGNOSTIC_PREFIX} ${message}\n`);
}

interface PlanningPersistenceQueryClient {
  query: (sql: string, params?: unknown[]) => Promise<unknown>;
}

export interface DesktopPlanningPersistenceHandle {
  connectionString: string;
  queryClient: PlanningPersistenceQueryClient;
  stop: () => Promise<void>;
}

export interface DesktopServerHandle {
  host: string;
  port: number;
  close: () => Promise<void>;
}

export interface DesktopRuntimeLogger {
  log: (message: string) => void;
  warn: (message: string) => void;
}

export interface DesktopRuntimePaths {
  runtimeRoot: string;
  workspaceRoot: string;
  elegyHome: string;
  gatewayConfigPath: string;
  legacyGatewayConfigPath: string;
  planningCliPath?: string;
  planningDbPath?: string;
}

export interface DesktopRuntimeShellAdapter {
  launchPackagedGatewayChild: (options: {
    localTrackerRoot: string;
    env: NodeJS.ProcessEnv;
  }) => ChildProcess | null;
  launchPackagedWorkflowSidecarChild?: (options: {
    localTrackerRoot: string;
    env: NodeJS.ProcessEnv;
  }) => ChildProcess | null;
}

export interface DesktopRuntimeServiceOptions {
  paths: DesktopRuntimePaths;
  isPackaged: boolean;
  processExecPath: string;
  appVersion: string;
  appPath: string;
  currentDirname: string;
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  logger?: Partial<DesktopRuntimeLogger>;
  shellAdapter: DesktopRuntimeShellAdapter;
}

interface DesktopRuntimeFs {
  existsSync: (filePath: string) => boolean;
  mkdirSync: (filePath: string, options?: { recursive?: boolean }) => void;
  renameSync: (oldPath: string, newPath: string) => void;
  copyFileSync: (source: string, destination: string) => void;
  unlinkSync: (filePath: string) => void;
}

export interface BundledChildEntryPointOptions {
  runtimeRoot: string;
  entryRelativePath: string[];
  childLabel: string;
  entryDescription?: string;
  stripChildFlag: (argv: string[]) => string[];
  fs?: Pick<DesktopRuntimeFs, 'existsSync'>;
  loadModule?: (entryPath: string) => { main?: (argv?: string[]) => Promise<void> };
  processState?: { argv: string[] };
}

export interface DesktopRuntimeServiceDependencies {
  startWorkflowSidecar: (options: {
    runtimeRoot: string;
    processExecPath: string;
    isPackaged: boolean;
    elegyHome: string;
    shellAdapter?: Pick<DesktopRuntimeShellAdapter, 'launchPackagedWorkflowSidecarChild'>;
  }) => Promise<WorkflowSidecarManager>;
  startDesktopPlanningPersistence: (options: {
    stateRoot: string;
    logger: (message: string) => void;
  }) => Promise<DesktopPlanningPersistenceHandle>;
  startServer: (options: {
    host: string;
    port: number;
    elegyHome: string;
    sandboxesHome: string;
    trackerUrl: string;
    trackerToken: string;
    desktopUiToken: string;
    workflowSidecarManager: WorkflowSidecarManager;
    planningPersistenceClient?: PlanningPersistenceQueryClient;
    engineRoot?: string;
    env?: NodeJS.ProcessEnv;
    quiet: boolean;
  }) => Promise<DesktopServerHandle>;
  spawn?: typeof defaultSpawn;
  fs?: DesktopRuntimeFs;
  createRandomHex?: (byteCount: number) => string;
  diagnostics?: RuntimeDiagnostics;
}

export interface DesktopRuntimeStartResult {
  host: string;
  port: number;
  windowUrl: string;
  desktopUiToken: string;
  trackerUrl: string;
  trackerToken: string;
}

export interface DesktopRuntimeService {
  start: () => Promise<DesktopRuntimeStartResult>;
  stop: () => Promise<void>;
  isRunning: () => boolean;
  getWindowUrl: () => string | null;
}

function resolveLogger(logger?: Partial<DesktopRuntimeLogger>): DesktopRuntimeLogger {
  return {
    log: logger?.log ?? (() => undefined),
    warn: logger?.warn ?? (() => undefined),
  };
}

function defaultRandomHex(byteCount: number): string {
  return randomBytes(byteCount).toString('hex');
}

export function resolveDesktopRuntimeRoot(options: {
  isPackaged: boolean;
  resourcesPath: string;
  currentDirname: string;
}): string {
  if (options.isPackaged) {
    return path.resolve(options.resourcesPath);
  }

  return path.resolve(options.currentDirname, '..', '..');
}

export function resolveDefaultWorkspaceRoot(
  runtimeRoot: string,
  currentWorkingDirectory: string,
  existsSync: (candidate: string) => boolean = fs.existsSync,
): string {
  return existsSync(runtimeRoot) ? runtimeRoot : path.resolve(currentWorkingDirectory);
}

export function resolveDesktopServerPort(env: NodeJS.ProcessEnv): number {
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

export function buildDesktopWindowUrl(host: string, port: number, desktopUiToken: string): string {
  const url = new URL(`http://${host}:${port}/`);
  url.searchParams.set(DESKTOP_UI_ACCESS_QUERY_PARAM, desktopUiToken);
  return url.toString();
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

function resolveBundledPlanningCliPath(
  runtimeRoot: string,
  elegyHome: string,
  runtimeFs: Pick<DesktopRuntimeFs, 'existsSync'>,
): string {
  // Use the shared cross-platform resolver from elegyPlanningCliResolver
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const resolver = require('../../elegyPlanningCliResolver') as { resolveElegyPlanningCliPath: (options: { runtimeRoot?: string; elegyHome?: string; existsSync?: (path: string) => boolean }) => string };
  return resolver.resolveElegyPlanningCliPath({
    runtimeRoot,
    elegyHome,
    existsSync: runtimeFs.existsSync,
  });
}

function ensurePlanningAuthorityEnv(
  options: Pick<DesktopRuntimeServiceOptions, 'env' | 'paths' | 'isPackaged'>,
  runtimeFs: Pick<DesktopRuntimeFs, 'existsSync'>,
): void {
  const explicitCliPath = String(options.env.INSTRUCTION_ENGINE_ELEGY_PLANNING_CLI_PATH || '').trim();
  const explicitDbPath = String(options.env.INSTRUCTION_ENGINE_ELEGY_PLANNING_DB_PATH || '').trim();
  const configuredCliPath = explicitCliPath
    || String(options.paths.planningCliPath || '').trim()
    || resolveBundledPlanningCliPath(options.paths.runtimeRoot, options.paths.elegyHome, runtimeFs);
  const configuredDbPath = explicitDbPath
    || String(options.paths.planningDbPath || '').trim()
    || path.join(options.paths.elegyHome, 'elegy-planning.db');

  if (configuredDbPath) {
    options.env.INSTRUCTION_ENGINE_ELEGY_PLANNING_DB_PATH = configuredDbPath;
  }

  // Set the planning session sidecar override path on Windows so the
  // Copilot server reads from the override location.
  if (process.platform === 'win32') {
    options.env.INSTRUCTION_ENGINE_ELEGY_PLANNING_SESSION_PATH = path.join(options.paths.elegyHome, 'planning-session.json');
  }

  if (configuredCliPath) {
    options.env.INSTRUCTION_ENGINE_ELEGY_PLANNING_ENABLED = '1';
    options.env.INSTRUCTION_ENGINE_ELEGY_PLANNING_CLI_PATH = configuredCliPath;
    delete options.env.INSTRUCTION_ENGINE_ELEGY_PLANNING_DISABLED;
    return;
  }

  // Do not set INSTRUCTION_ENGINE_ELEGY_PLANNING_DISABLED here.
  // The server startup handles binary download and will set DISABLED only
  // if both local resolution and download fail. Deferring the decision
  // avoids a coordination gap where an early DISABLED flag blocks a
  // successful download from re-enabling planning.
  delete options.env.INSTRUCTION_ENGINE_ELEGY_PLANNING_CLI_PATH;
}

function ensureDefaultGatewayConfig(paths: Pick<DesktopRuntimePaths, 'gatewayConfigPath' | 'legacyGatewayConfigPath'>, runtimeFs: DesktopRuntimeFs): void {
  if (runtimeFs.existsSync(paths.gatewayConfigPath)) {
    return;
  }

  if (!runtimeFs.existsSync(paths.legacyGatewayConfigPath)) {
    return;
  }

  runtimeFs.mkdirSync(path.dirname(paths.gatewayConfigPath), { recursive: true });
  try {
    runtimeFs.renameSync(paths.legacyGatewayConfigPath, paths.gatewayConfigPath);
  } catch {
    runtimeFs.copyFileSync(paths.legacyGatewayConfigPath, paths.gatewayConfigPath);
    try {
      runtimeFs.unlinkSync(paths.legacyGatewayConfigPath);
    } catch {
      // best-effort cleanup after successful rehome
    }
  }
}

async function stopChildProcess(child: ChildProcess | null): Promise<void> {
  if (!child || child.exitCode != null || child.killed) {
    return;
  }

  await new Promise<void>((resolve) => {
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
    } catch {
      finish();
      return;
    }

    setTimeout(finish, 2_000);
  });
}

function spawnGatewayDependencyForDevelopment(
  localTrackerRoot: string,
  trackerToken: string,
  workspaceRoot: string,
  options: Pick<DesktopRuntimeServiceOptions, 'env' | 'platform' | 'processExecPath'>,
  runtimeFs: Pick<DesktopRuntimeFs, 'existsSync'>,
  spawnChildProcess: typeof defaultSpawn,
): ChildProcess | null {
  const env = {
    ...options.env,
    INSTRUCTION_ENGINE_GATEWAY_HTTP_TOKEN: trackerToken,
    INSTRUCTION_ENGINE_GATEWAY_ALLOW_PLATFORMLESS: '1',
    INSTRUCTION_ENGINE_GATEWAY_MODE: 'disconnected',
    INSTRUCTION_ENGINE_GATEWAY_CONFIG_JSON: buildGatewayInlineConfig(workspaceRoot),
  };

  const distEntry = path.join(localTrackerRoot, 'dist', 'messagingGateway', 'index.js');
  if (runtimeFs.existsSync(distEntry)) {
    return spawnChildProcess(options.processExecPath, [distEntry], {
      cwd: localTrackerRoot,
      env,
      stdio: 'ignore',
      windowsHide: true,
    });
  }

  const srcEntry = path.join(localTrackerRoot, 'src', 'messagingGateway', 'index.ts');
  if (!runtimeFs.existsSync(srcEntry)) {
    return null;
  }

  const tsNodeBin = path.join(
    localTrackerRoot,
    'node_modules',
    '.bin',
    options.platform === 'win32' ? 'ts-node.cmd' : 'ts-node',
  );
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

export async function runBundledChildEntryPoint(options: BundledChildEntryPointOptions): Promise<void> {
  const runtimeFs = options.fs ?? fs;
  const processState = options.processState ?? process;
  const loadModule = options.loadModule ?? ((entryPath: string) => require(entryPath) as {
    main?: (argv?: string[]) => Promise<void>;
  });
  const entryPath = path.join(options.runtimeRoot, ...options.entryRelativePath);
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
  } finally {
    processState.argv = originalArgv;
  }
}

export function createDesktopRuntimeService(
  options: DesktopRuntimeServiceOptions,
  dependencies: DesktopRuntimeServiceDependencies,
): DesktopRuntimeService {
  const runtimeFs = dependencies.fs ?? fs;
  const spawnChildProcess = dependencies.spawn ?? defaultSpawn;
  const createRandomHex = dependencies.createRandomHex ?? defaultRandomHex;
  const logger = resolveLogger(options.logger);
  const diagnostics = dependencies.diagnostics;

  let gatewayProcess: ChildProcess | null = null;
  let workflowSidecarManager: WorkflowSidecarManager | null = null;
  let desktopPlanningPersistenceHandle: DesktopPlanningPersistenceHandle | null = null;
  let serverHandle: DesktopServerHandle | null = null;
  let currentStartResult: DesktopRuntimeStartResult | null = null;
  let stopping = false;

  function captureChildrenState(): Record<string, { status: string; pid: number | null; lastStderr?: string[] }> {
    return {
      gateway: {
        status: gatewayProcess ? (gatewayProcess.exitCode != null ? 'exited' : 'running') : 'not_started',
        pid: gatewayProcess?.pid ?? null,
      },
      workflow: {
        status: workflowSidecarManager ? 'running' : 'not_started',
        pid: null,
      },
      planning: {
        status: desktopPlanningPersistenceHandle ? 'running' : 'not_started',
        pid: null,
      },
      server: {
        status: serverHandle ? 'running' : 'not_started',
        pid: null,
      },
    };
  }

  function attachGatewayExitWatcher(child: ChildProcess): void {
    child.once('exit', (code: number | null, signal: NodeJS.Signals | null) => {
      if (stopping) {
        bootLog(`gateway process exited cleanly: code=${code} signal=${signal ?? 'null'}`);
        return;
      }
      bootLog(`gateway process exited unexpectedly: code=${code} signal=${signal ?? 'null'}`);
      if (!diagnostics) {
        return;
      }
      const payload: RuntimeDiagnosticPayload = {
        pid: process.pid,
        platform: process.platform,
        appVersion: options.appVersion,
        runtimeRoot: options.paths.runtimeRoot,
        child: {
          label: 'gateway',
          pid: child.pid ?? null,
          exitCode: code,
          signal: signal ?? null,
          lastStderr: [],
        },
        childrenState: captureChildrenState(),
      };
      void diagnostics.recordEvent('child_unexpected_exit', payload);
    });
  }

  async function stop(): Promise<void> {
    bootLog('stopping runtime service');
    stopping = true;
    currentStartResult = null;

    if (serverHandle) {
      bootLog('closing HTTP server');
      const handle = serverHandle;
      serverHandle = null;
      await handle.close();
    }

    if (desktopPlanningPersistenceHandle) {
      bootLog('stopping planning persistence');
      const handle = desktopPlanningPersistenceHandle;
      desktopPlanningPersistenceHandle = null;
      await handle.stop();
    }

    if (workflowSidecarManager) {
      bootLog('stopping workflow sidecar');
      const handle = workflowSidecarManager;
      workflowSidecarManager = null;
      await handle.stop();
    }

    if (gatewayProcess) {
      bootLog('stopping gateway process');
      const child = gatewayProcess;
      gatewayProcess = null;
      await stopChildProcess(child);
    }

    bootLog('runtime service stopped');
  }

  async function start(): Promise<DesktopRuntimeStartResult> {
    if (serverHandle && currentStartResult) {
      bootLog('already running, returning cached result');
      return currentStartResult;
    }

    const explicitPlanningDatabaseUrl = String(options.env.INSTRUCTION_ENGINE_PLANNING_DB_URL || '').trim();
    const desktopUiToken = createRandomHex(32);

    bootLog('ensuring default gateway config');
    ensureDefaultGatewayConfig(options.paths, runtimeFs);
    bootLog('ensuring planning authority env');
    ensurePlanningAuthorityEnv(options, runtimeFs);

    try {
      const trackerToken =
        String(options.env.INSTRUCTION_ENGINE_GATEWAY_HTTP_TOKEN || '').trim()
        || createRandomHex(32);
      options.env.INSTRUCTION_ENGINE_GATEWAY_HTTP_TOKEN = trackerToken;

      const localTrackerRoot = path.join(options.paths.runtimeRoot, 'local-tracker');
      if (runtimeFs.existsSync(localTrackerRoot)) {
        bootLog(`local-tracker found at ${localTrackerRoot}, starting gateway`);
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
          : spawnGatewayDependencyForDevelopment(
            localTrackerRoot,
            trackerToken,
            options.paths.workspaceRoot,
            options,
            runtimeFs,
            spawnChildProcess,
          );
        if (gatewayProcess) {
          attachGatewayExitWatcher(gatewayProcess);
        }
        bootLog(`gateway process spawned: pid=${gatewayProcess?.pid ?? 'null'}`);
      } else {
        bootLog(`local-tracker not found at ${localTrackerRoot}, skipping gateway`);
      }

      bootLog('starting workflow sidecar');
      workflowSidecarManager = await dependencies.startWorkflowSidecar({
        runtimeRoot: options.paths.runtimeRoot,
        processExecPath: options.processExecPath,
        isPackaged: options.isPackaged,
        elegyHome: options.paths.elegyHome,
        shellAdapter: options.shellAdapter,
      });
      bootLog('workflow sidecar started');

      if (options.isPackaged && !explicitPlanningDatabaseUrl) {
        bootLog('starting planning persistence (packaged mode)');
        desktopPlanningPersistenceHandle = await dependencies.startDesktopPlanningPersistence({
          stateRoot: path.join(options.paths.elegyHome, 'planning-db'),
          logger: (message: string) => logger.log(message),
        });
        options.env.INSTRUCTION_ENGINE_PLANNING_DB_URL = desktopPlanningPersistenceHandle.connectionString;
        options.env.INSTRUCTION_ENGINE_PLANNING_DB_REQUIRED = '1';
        bootLog('planning persistence started');
      } else if (explicitPlanningDatabaseUrl) {
        bootLog('skipping planning persistence (explicit DB URL provided)');
      } else {
        bootLog('skipping planning persistence (dev mode)');
      }

      bootLog('starting HTTP server');
      serverHandle = await dependencies.startServer({
        host: '127.0.0.1',
        port: resolveDesktopServerPort(options.env),
        elegyHome: options.paths.elegyHome,
        sandboxesHome: path.join(options.paths.elegyHome, 'sandboxes'),
        trackerUrl: 'http://127.0.0.1:4100',
        trackerToken,
        desktopUiToken,
        workflowSidecarManager,
        planningPersistenceClient: desktopPlanningPersistenceHandle?.queryClient,
        engineRoot: options.isPackaged ? options.paths.runtimeRoot : undefined,
        env: options.env,
        quiet: true,
      });
      bootLog(`HTTP server listening on ${serverHandle.host}:${serverHandle.port}`);

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

      bootLog('startup complete');
      return currentStartResult;
    } catch (error) {
      bootLog(`startup failed: ${error instanceof Error ? error.message : String(error)}`);
      const detail = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      if (diagnostics) {
        const payload: RuntimeDiagnosticPayload = {
          pid: process.pid,
          platform: process.platform,
          appVersion: options.appVersion,
          runtimeRoot: options.paths.runtimeRoot,
          error: { name: error instanceof Error ? error.name : 'Error', message: detail, stack },
          childrenState: captureChildrenState(),
        };
        void diagnostics.recordEvent('startup_dep_failed', payload);
      }
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
