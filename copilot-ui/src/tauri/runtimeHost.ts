import { spawn } from 'child_process';
import os from 'os';
import path from 'path';
import readline from 'readline';

import {
  createDesktopRuntimeService,
  resolveDefaultWorkspaceRoot,
  type DesktopRuntimeService,
} from '../desktopRuntime/runtimeService';
import {
  createRuntimeDiagnostics,
  type RuntimeDiagnosticPayload,
  type RuntimeDiagnostics,
} from '../desktopRuntime/runtimeDiagnostics';
import { startWorkflowSidecar } from '../workflowSidecar';

const READY_PREFIX = 'TAURI_RUNTIME_READY ';
const ERROR_PREFIX = 'TAURI_RUNTIME_ERROR ';
const SHUTDOWN_SIGNAL = 'shutdown';

function bootLog(message: string): void {
  process.stderr.write(`[boot:runtimeHost] ${message}\n`);
}

function requireEnv(name: string): string {
  const value = String(process.env[name] || '').trim();
  if (!value) {
    throw new Error(`Missing required ${name} environment variable.`);
  }

  return value;
}

function isPackagedHost(): boolean {
  return String(process.env.ELEGY_TAURI_IS_PACKAGED || '').trim() === '1';
}

async function main(): Promise<void> {
  bootLog('resolving environment variables');
  const runtimeRoot = requireEnv('ELEGY_TAURI_RUNTIME_ROOT');
  const nodeExecutablePath = requireEnv('ELEGY_TAURI_NODE_EXECUTABLE');
  const serverEntrypointPath = requireEnv('ELEGY_TAURI_SERVER_ENTRYPOINT');
  const gatewayEntrypointPath = requireEnv('ELEGY_TAURI_GATEWAY_ENTRYPOINT');
  const workflowSidecarEntrypointPath = requireEnv('ELEGY_TAURI_WORKFLOW_SIDECAR_ENTRYPOINT');
  const appVersion = requireEnv('ELEGY_TAURI_APP_VERSION');
  const copilotUiRoot = path.dirname(serverEntrypointPath);
  const currentDirname = path.dirname(__filename);
  const localTrackerRoot = path.join(runtimeRoot, 'local-tracker');
  const elegyHome = path.join(os.homedir(), '.elegy');
  const isPackaged = isPackagedHost();

  bootLog(`runtimeRoot=${runtimeRoot}`);
  bootLog(`nodeExecutable=${nodeExecutablePath}`);
  bootLog(`serverEntrypoint=${serverEntrypointPath}`);
  bootLog(`gatewayEntrypoint=${gatewayEntrypointPath}`);
  bootLog(`workflowSidecarEntrypoint=${workflowSidecarEntrypointPath}`);
  bootLog(`isPackaged=${isPackaged}, appVersion=${appVersion}`);

  bootLog('loading planning persistence module');
  let startDesktopPlanningPersistence: (options: Record<string, unknown>) => Promise<{
    connectionString: string;
    queryClient: {
      query: (sql: string, params?: unknown[]) => Promise<unknown>;
    };
    stop: () => Promise<void>;
  }>;

  try {
    const planningModule = require(path.join(copilotUiRoot, 'lib', 'desktopPlanningPersistence.js')) as {
      startDesktopPlanningPersistence: typeof startDesktopPlanningPersistence;
    };
    startDesktopPlanningPersistence = planningModule.startDesktopPlanningPersistence;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    bootLog(`failed to load planning persistence module: ${msg}`);
    throw error;
  }

  bootLog('loading server module');
  let startServer: (options: Record<string, unknown>) => Promise<{
    host: string;
    port: number;
    close: () => Promise<void>;
  }>;

  try {
    const serverModule = require(serverEntrypointPath) as {
      startServer: typeof startServer;
    };
    startServer = serverModule.startServer;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    bootLog(`failed to load server module (${serverEntrypointPath}): ${msg}`);
    throw error;
  }

  let runtimeService: DesktopRuntimeService | null = null;
  let shutdownStarted = false;

  const shutdown = async (): Promise<void> => {
    if (shutdownStarted) {
      return;
    }

    shutdownStarted = true;
    await runtimeService?.stop();
  };

  const diagnostics: RuntimeDiagnostics = createRuntimeDiagnostics({
    logsDir: path.join(elegyHome, 'logs'),
  });

  const installCrashHandlers = (): void => {
    const buildPayload = (event: 'uncaught_exception' | 'unhandled_rejection', error: unknown): RuntimeDiagnosticPayload => ({
      pid: process.pid,
      platform: process.platform,
      appVersion,
      runtimeRoot,
      error: {
        name: error instanceof Error ? error.name : 'Error',
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
      context: { event },
    });

    process.on('uncaughtException', (error) => {
      diagnostics.recordEventSync('uncaught_exception', buildPayload('uncaught_exception', error));
      bootLog(`uncaughtException: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    });

    process.on('unhandledRejection', (reason) => {
      diagnostics.recordEventSync('unhandled_rejection', buildPayload('unhandled_rejection', reason));
      bootLog(`unhandledRejection: ${reason instanceof Error ? reason.message : String(reason)}`);
      process.exit(1);
    });
  };
  installCrashHandlers();

  bootLog('creating desktop runtime service');
  runtimeService = createDesktopRuntimeService(
    {
      paths: {
        runtimeRoot,
        workspaceRoot: resolveDefaultWorkspaceRoot(runtimeRoot, process.cwd()),
        elegyHome,
      },
      isPackaged,
      processExecPath: nodeExecutablePath,
      appVersion,
      appPath: copilotUiRoot,
      currentDirname,
      env: process.env,
      platform: process.platform,
      logger: console,
    },
    {
      startDesktopPlanningPersistence,
      startServer,
      diagnostics,
    },
  );

  const stdinInterface = readline.createInterface({
    input: process.stdin,
    terminal: false,
  });

  stdinInterface.on('line', (line) => {
    if (line.trim() !== SHUTDOWN_SIGNAL) {
      return;
    }

    void shutdown()
      .catch((error: unknown) => {
        const detail = error instanceof Error ? error.message : String(error);
        const stack = error instanceof Error ? error.stack : undefined;
        console.error(`${ERROR_PREFIX}${JSON.stringify({ message: detail, stack })}`);
      })
      .finally(() => {
        process.exit(0);
      });
  });

  process.stdin.on('end', () => {
    void shutdown().finally(() => {
      process.exit(0);
    });
  });

  process.on('SIGINT', () => {
    void shutdown().finally(() => {
      process.exit(0);
    });
  });
  process.on('SIGTERM', () => {
    void shutdown().finally(() => {
      process.exit(0);
    });
  });

  try {
    bootLog('starting runtime service');
    const startResult = await runtimeService.start();
    bootLog(`runtime service started successfully, port=${startResult.port}`);
    console.log(`${READY_PREFIX}${JSON.stringify({ windowUrl: startResult.windowUrl })}`);
  } catch (error) {
    bootLog('runtime service start failed, shutting down');
    await shutdown();
    const detail = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    console.error(`${ERROR_PREFIX}${JSON.stringify({ message: detail, stack })}`);
    process.exit(1);
  }
}

void main().catch((error: unknown) => {
  const detail = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  console.error(`${ERROR_PREFIX}${JSON.stringify({ message: detail, stack })}`);
  process.exit(1);
});
