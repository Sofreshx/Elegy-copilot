import { randomBytes } from 'crypto';
import { spawn as defaultSpawn, type ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';

import type { DesktopCliManagerState, EvaluateDesktopCliManagerStateOptions } from './cliManager';
import type { WorkflowSidecarManager } from '../workflowSidecar';

const DESKTOP_UI_ACCESS_QUERY_PARAM = 'desktop-ui-token';
const DESKTOP_SMOKE_LOG_WINDOW_URL_ENV = 'INSTRUCTION_ENGINE_DESKTOP_SMOKE_LOG_WINDOW_URL';

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
  copilotHome: string;
  gatewayConfigPath: string;
  legacyGatewayConfigPath: string;
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
  ensureSdkBridgeDefaultEnabled: (env: NodeJS.ProcessEnv) => void;
  evaluateDesktopCliManagerState: (
    options: EvaluateDesktopCliManagerStateOptions,
  ) => Promise<DesktopCliManagerState>;
  startWorkflowSidecar: (options: {
    runtimeRoot: string;
    processExecPath: string;
    isPackaged: boolean;
    copilotHome: string;
    shellAdapter?: Pick<DesktopRuntimeShellAdapter, 'launchPackagedWorkflowSidecarChild'>;
  }) => Promise<WorkflowSidecarManager>;
  startDesktopPlanningPersistence: (options: {
    stateRoot: string;
    logger: (message: string) => void;
  }) => Promise<DesktopPlanningPersistenceHandle>;
  startServer: (options: {
    host: string;
    port: number;
    copilotHome: string;
    vscodeHome: string;
    sandboxesHome: string;
    trackerUrl: string;
    trackerToken: string;
    desktopUiToken: string;
    workflowSidecarManager: WorkflowSidecarManager;
    planningPersistenceClient?: PlanningPersistenceQueryClient;
    engineRoot?: string;
    quiet: boolean;
  }) => Promise<DesktopServerHandle>;
  spawn?: typeof defaultSpawn;
  fs?: DesktopRuntimeFs;
  createRandomHex?: (byteCount: number) => string;
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

  let gatewayProcess: ChildProcess | null = null;
  let workflowSidecarManager: WorkflowSidecarManager | null = null;
  let desktopPlanningPersistenceHandle: DesktopPlanningPersistenceHandle | null = null;
  let serverHandle: DesktopServerHandle | null = null;
  let currentStartResult: DesktopRuntimeStartResult | null = null;

  async function stop(): Promise<void> {
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

  async function start(): Promise<DesktopRuntimeStartResult> {
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
      const trackerToken =
        String(options.env.INSTRUCTION_ENGINE_GATEWAY_HTTP_TOKEN || '').trim()
        || createRandomHex(32);
      options.env.INSTRUCTION_ENGINE_GATEWAY_HTTP_TOKEN = trackerToken;

      const localTrackerRoot = path.join(options.paths.runtimeRoot, 'local-tracker');
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
          : spawnGatewayDependencyForDevelopment(
            localTrackerRoot,
            trackerToken,
            options.paths.workspaceRoot,
            options,
            runtimeFs,
            spawnChildProcess,
          );
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
          stateRoot: path.join(options.paths.copilotHome, 'planning-db'),
          logger: (message: string) => logger.log(message),
        });
        options.env.INSTRUCTION_ENGINE_PLANNING_DB_URL = desktopPlanningPersistenceHandle.connectionString;
        options.env.INSTRUCTION_ENGINE_PLANNING_DB_REQUIRED = '1';
      }

      serverHandle = await dependencies.startServer({
        host: '127.0.0.1',
        port: resolveDesktopServerPort(options.env),
        copilotHome: options.paths.copilotHome,
        vscodeHome: options.paths.copilotHome,
        sandboxesHome: path.join(options.paths.copilotHome, 'sandboxes'),
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
    } catch (error) {
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
