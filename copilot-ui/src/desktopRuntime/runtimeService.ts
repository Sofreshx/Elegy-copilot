import { randomBytes } from 'crypto';
import fs from 'fs';
import path from 'path';

import { createKimakiCli, type KimakiCli } from './kimakiCli';
import {
  createKimakiRuntimeService,
  type KimakiRuntimeService,
} from './kimakiRuntimeService';
import { resolveKimakiEntrypoint } from './kimakiRuntimeResolver';
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
  planningCliPath?: string;
  planningDbPath?: string;
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
}

interface DesktopRuntimeFs {
  existsSync: (filePath: string) => boolean;
  mkdirSync: (filePath: string, options?: { recursive?: boolean }) => void;
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
    planningPersistenceClient?: PlanningPersistenceQueryClient;
    engineRoot?: string;
    env?: NodeJS.ProcessEnv;
    kimakiRuntimeService?: KimakiRuntimeService;
    kimakiCli?: KimakiCli;
    quiet: boolean;
  }) => Promise<DesktopServerHandle>;
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

function resolveBundledPlanningCliPath(
  runtimeRoot: string,
  elegyHome: string,
  runtimeFs: Pick<DesktopRuntimeFs, 'existsSync'>,
): string {
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
  const configuredCliPath = explicitCliPath
    || String(options.paths.planningCliPath || '').trim()
    || resolveBundledPlanningCliPath(options.paths.runtimeRoot, options.paths.elegyHome, runtimeFs);
  const configuredDbPath = path.join(options.paths.elegyHome, 'planning.db');

  if (configuredDbPath) {
    options.env.INSTRUCTION_ENGINE_ELEGY_PLANNING_DB_PATH = configuredDbPath;
  }

  if (process.platform === 'win32') {
    options.env.INSTRUCTION_ENGINE_ELEGY_PLANNING_SESSION_PATH = path.join(options.paths.elegyHome, 'planning-session.json');
  }

  if (configuredCliPath) {
    options.env.INSTRUCTION_ENGINE_ELEGY_PLANNING_ENABLED = '1';
    options.env.INSTRUCTION_ENGINE_ELEGY_PLANNING_CLI_PATH = configuredCliPath;
    delete options.env.INSTRUCTION_ENGINE_ELEGY_PLANNING_DISABLED;
    return;
  }

  delete options.env.INSTRUCTION_ENGINE_ELEGY_PLANNING_CLI_PATH;
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
  const createRandomHex = dependencies.createRandomHex ?? defaultRandomHex;
  const logger = resolveLogger(options.logger);
  const diagnostics = dependencies.diagnostics;

  let desktopPlanningPersistenceHandle: DesktopPlanningPersistenceHandle | null = null;
  let serverHandle: DesktopServerHandle | null = null;
  let kimakiRuntimeService: KimakiRuntimeService | null = null;
  let currentStartResult: DesktopRuntimeStartResult | null = null;
  let stopping = false;

  function captureChildrenState(): Record<string, { status: string; pid: number | null; lastStderr?: string[] }> {
    return {
      planning: {
        status: desktopPlanningPersistenceHandle ? 'running' : 'not_started',
        pid: null,
      },
      server: {
        status: serverHandle ? 'running' : 'not_started',
        pid: null,
      },
      kimaki: {
        status: kimakiRuntimeService?.getState() ?? 'not_started',
        pid: null,
      },
    };
  }

  async function stop(): Promise<void> {
    bootLog('stopping runtime service');
    stopping = true;
    currentStartResult = null;

    if (kimakiRuntimeService) {
      bootLog('stopping Kimaki');
      const service = kimakiRuntimeService;
      kimakiRuntimeService = null;
      await service.stop();
    }

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

    bootLog('runtime service stopped');
  }

  async function start(): Promise<DesktopRuntimeStartResult> {
    if (serverHandle && currentStartResult) {
      bootLog('already running, returning cached result');
      return currentStartResult;
    }

    const explicitPlanningDatabaseUrl = String(options.env.INSTRUCTION_ENGINE_PLANNING_DB_URL || '').trim();
    const desktopUiToken = createRandomHex(32);

    bootLog('ensuring planning authority env');
    ensurePlanningAuthorityEnv(options, runtimeFs);

    try {
      const trackerToken = createRandomHex(32);

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
      const kimakiResolution = resolveKimakiEntrypoint({
        appPath: options.appPath,
        runtimeRoot: options.paths.runtimeRoot,
        explicitPath: options.env.INSTRUCTION_ENGINE_KIMAKI_ENTRYPOINT,
        existsSync: runtimeFs.existsSync,
      });
      const kimakiDataDir = path.join(options.paths.elegyHome, 'kimaki');
      let kimakiCli: KimakiCli | undefined;
      if (kimakiResolution.entrypoint) {
        const kimakiEntrypoint = kimakiResolution.entrypoint;
        kimakiRuntimeService = createKimakiRuntimeService({
          elegyHome: options.paths.elegyHome,
          nodeExecutable: options.processExecPath,
          kimakiEntrypoint,
          logger,
        });
        kimakiCli = createKimakiCli({
          nodeExecutable: options.processExecPath,
          kimakiEntrypoint,
          dataDir: kimakiDataDir,
        });
      } else {
        logger.warn(
          `Kimaki entrypoint is unavailable. Checked: ${kimakiResolution.checkedPaths.join(', ')}`,
        );
      }

      serverHandle = await dependencies.startServer({
        host: '127.0.0.1',
        port: resolveDesktopServerPort(options.env),
        elegyHome: options.paths.elegyHome,
        sandboxesHome: path.join(options.paths.elegyHome, 'sandboxes'),
        trackerUrl: 'http://127.0.0.1:4100',
        trackerToken,
        desktopUiToken,
        planningPersistenceClient: desktopPlanningPersistenceHandle?.queryClient,
        engineRoot: options.isPackaged ? options.paths.runtimeRoot : undefined,
        env: options.env,
        kimakiRuntimeService: kimakiRuntimeService ?? undefined,
        kimakiCli,
        quiet: true,
      });
      bootLog(`HTTP server listening on ${serverHandle.host}:${serverHandle.port}`);

      if (kimakiRuntimeService) {
        kimakiRuntimeService.start({
          callbackUrl: `http://${serverHandle.host}:${serverHandle.port}/?remote-onboarding=complete`,
        });
        bootLog('Kimaki started');
      }

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
