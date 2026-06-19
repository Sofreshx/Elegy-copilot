import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { GATEWAY_CHILD_FLAG, stripGatewayChildFlag } from '../gatewayChildMode';
import { createDesktopRuntimeService, runBundledChildEntryPoint } from './runtimeService';

interface CapturedServerOptions {
  planningPersistenceClient?: {
    query: unknown;
  };
  trackerToken?: string;
  desktopUiToken?: string;
  engineRoot?: string;
  env?: NodeJS.ProcessEnv;
}

test('desktop runtime service starts the extracted runtime orchestration and shuts it down cleanly', async () => {
  const runtimeRoot = 'C:\\runtime';
  const elegyHome = 'C:\\Users\\tester\\.elegy';
  const existingPaths = new Set([
    runtimeRoot,
    path.join(runtimeRoot, 'local-tracker'),
  ]);
  const lifecycle: string[] = [];
  let serverOptions: CapturedServerOptions | undefined;

  const service = createDesktopRuntimeService(
    {
      paths: {
        runtimeRoot,
        workspaceRoot: runtimeRoot,
        elegyHome,
      },
      isPackaged: true,
      processExecPath: 'C:\\runtime\\elegy-copilot-tauri-shell.exe',
      appVersion: '1.0.1',
      appPath: 'C:\\runtime\\copilot-ui',
      currentDirname: 'C:\\runtime\\copilot-ui\\src-tauri\\target\\release',
      env: {},
      platform: 'win32',
      logger: {
        log: () => undefined,
        warn: () => undefined,
      },
    },
    {

      startDesktopPlanningPersistence: async () => ({
        connectionString: 'postgres://planning',
        queryClient: {
          query: async () => ({ rows: [] }),
        },
        stop: async () => {
          lifecycle.push('planning:stop');
        },
      }),
      startServer: async (options) => {
        serverOptions = options as unknown as CapturedServerOptions;
        return {
          host: '127.0.0.1',
          port: 3210,
          close: async () => {
            lifecycle.push('server:stop');
          },
        };
      },
      fs: {
        existsSync: (candidate) => existingPaths.has(candidate),
        mkdirSync: () => undefined,

      },
      createRandomHex: ((values: string[]) => () => {
        const next = values.shift();
        if (!next) {
          throw new Error('Missing random value');
        }
        return next;
      })(['desktop-token', 'tracker-token']),
    },
  );

  const result = await service.start();

  assert.equal(result.windowUrl, 'http://127.0.0.1:3210/?desktop-ui-token=desktop-token');
  assert.equal(result.trackerToken, 'tracker-token');
  assert.equal(serverOptions?.planningPersistenceClient?.query != null, true);
  assert.equal(serverOptions?.trackerToken, 'tracker-token');
  assert.equal(serverOptions?.desktopUiToken, 'desktop-token');
  assert.equal(serverOptions?.engineRoot, runtimeRoot);
  assert.equal(serverOptions?.env?.INSTRUCTION_ENGINE_ELEGY_PLANNING_CLI_PATH, 'elegy-planning');
  assert.equal(serverOptions?.env?.INSTRUCTION_ENGINE_ELEGY_PLANNING_DB_PATH, path.join(elegyHome, 'planning.db'));
  assert.equal(service.isRunning(), true);
  assert.equal(service.getWindowUrl(), result.windowUrl);

  await service.stop();

  assert.deepEqual(lifecycle, [
    'server:stop',
    'planning:stop',
  ]);
  assert.equal(service.isRunning(), false);
  assert.equal(service.getWindowUrl(), null);
});

test('desktop runtime service discovers packaged elegy-planning authority and forwards it to the server env', async () => {
  const runtimeRoot = 'C:\\runtime';
  const elegyHome = 'C:\\Users\\tester\\.elegy';
  const existingPaths = new Set([
    runtimeRoot,
    path.join(runtimeRoot, 'local-tracker'),
    path.join(runtimeRoot, 'elegy-planning', 'elegy-planning.exe'),
  ]);
  let serverOptions: CapturedServerOptions | undefined;

  const env: NodeJS.ProcessEnv = {};
  const service = createDesktopRuntimeService(
    {
      paths: {
        runtimeRoot,
        workspaceRoot: runtimeRoot,
        elegyHome,
      },
      isPackaged: true,
      processExecPath: 'C:\\runtime\\elegy-copilot-tauri-shell.exe',
      appVersion: '1.0.1',
      appPath: 'C:\\runtime\\copilot-ui',
      currentDirname: 'C:\\runtime\\copilot-ui\\src-tauri\\target\\release',
      env,
      platform: 'win32',
      logger: {
        log: () => undefined,
        warn: () => undefined,
      },
    },
    {

      startDesktopPlanningPersistence: async () => ({
        connectionString: 'postgres://planning',
        queryClient: {
          query: async () => ({ rows: [] }),
        },
        stop: async () => undefined,
      }),
      startServer: async (options) => {
        serverOptions = options as unknown as CapturedServerOptions;
        return {
          host: '127.0.0.1',
          port: 3210,
          close: async () => undefined,
        };
      },
      fs: {
        existsSync: (candidate) => existingPaths.has(candidate),
        mkdirSync: () => undefined,

      },
      createRandomHex: ((values: string[]) => () => {
        const next = values.shift();
        if (!next) {
          throw new Error('Missing random value');
        }
        return next;
      })(['desktop-token', 'tracker-token']),
    },
  );

  await service.start();

  assert.equal(env.INSTRUCTION_ENGINE_ELEGY_PLANNING_ENABLED, '1');
  assert.equal(
    env.INSTRUCTION_ENGINE_ELEGY_PLANNING_CLI_PATH,
    path.join(runtimeRoot, 'elegy-planning', 'elegy-planning.exe'),
  );
  assert.equal(
    env.INSTRUCTION_ENGINE_ELEGY_PLANNING_DB_PATH,
    path.join(elegyHome, 'planning.db'),
  );
  assert.equal(serverOptions?.env?.INSTRUCTION_ENGINE_ELEGY_PLANNING_CLI_PATH, path.join(runtimeRoot, 'elegy-planning', 'elegy-planning.exe'));
  assert.equal(serverOptions?.env?.INSTRUCTION_ENGINE_ELEGY_PLANNING_DB_PATH, path.join(elegyHome, 'planning.db'));

  await service.stop();
});

test('desktop runtime service defers planning DISABLED decision when no CLI is discoverable', async () => {
  const runtimeRoot = 'C:\\runtime';
  const elegyHome = 'C:\\Users\\tester\\.elegy';
  const existingPaths = new Set([
    runtimeRoot,
    path.join(runtimeRoot, 'local-tracker'),
  ]);
  const env: NodeJS.ProcessEnv = {};

  const service = createDesktopRuntimeService(
    {
      paths: {
        runtimeRoot,
        workspaceRoot: runtimeRoot,
        elegyHome,
      },
      isPackaged: true,
      processExecPath: 'C:\\runtime\\elegy-copilot-tauri-shell.exe',
      appVersion: '1.0.1',
      appPath: 'C:\\runtime\\copilot-ui',
      currentDirname: 'C:\\runtime\\copilot-ui\\src-tauri\\target\\release',
      env,
      platform: 'win32',
      logger: {
        log: () => undefined,
        warn: () => undefined,
      },
    },
    {

      startDesktopPlanningPersistence: async () => ({
        connectionString: 'postgres://planning',
        queryClient: {
          query: async () => ({ rows: [] }),
        },
        stop: async () => undefined,
      }),
      startServer: async () => ({
        host: '127.0.0.1',
        port: 3210,
        close: async () => undefined,
      }),
      fs: {
        existsSync: (candidate) => existingPaths.has(candidate),
        mkdirSync: () => undefined,

      },
      createRandomHex: ((values: string[]) => () => {
        const next = values.shift();
        if (!next) {
          throw new Error('Missing random value');
        }
        return next;
      })(['desktop-token', 'tracker-token']),
    },
  );

  await service.start();

  assert.equal(env.INSTRUCTION_ENGINE_ELEGY_PLANNING_CLI_PATH, 'elegy-planning');
  assert.equal(env.INSTRUCTION_ENGINE_ELEGY_PLANNING_DISABLED, undefined);
  assert.equal(env.INSTRUCTION_ENGINE_ELEGY_PLANNING_DB_PATH, path.join(elegyHome, 'planning.db'));

  await service.stop();
});

test('desktop runtime service cleans up partially started dependencies when startup fails', async () => {
  const runtimeRoot = 'C:\\runtime';
  const elegyHome = 'C:\\Users\\tester\\.elegy';
  const existingPaths = new Set([
    path.join(runtimeRoot, 'local-tracker'),
  ]);
  const lifecycle: string[] = [];

  const service = createDesktopRuntimeService(
    {
      paths: {
        runtimeRoot,
        workspaceRoot: runtimeRoot,
        elegyHome,
      },
      isPackaged: true,
      processExecPath: 'C:\\runtime\\elegy-copilot-tauri-shell.exe',
      appVersion: '1.0.1',
      appPath: 'C:\\runtime\\copilot-ui',
      currentDirname: 'C:\\runtime\\copilot-ui\\src-tauri\\target\\release',
      env: {},
      platform: 'win32',
      logger: {
        log: () => undefined,
        warn: () => undefined,
      },
    },
    {

      startDesktopPlanningPersistence: async () => ({
        connectionString: 'postgres://planning',
        queryClient: {
          query: async () => ({ rows: [] }),
        },
        stop: async () => {
          lifecycle.push('planning:stop');
        },
      }),
      startServer: async () => {
        throw new Error('server failed');
      },
      fs: {
        existsSync: (candidate) => existingPaths.has(candidate),
        mkdirSync: () => undefined,

      },
      createRandomHex: ((values: string[]) => () => {
        const next = values.shift();
        if (!next) {
          throw new Error('Missing random value');
        }
        return next;
      })(['desktop-token', 'tracker-token']),
    },
  );

  await assert.rejects(() => service.start(), /server failed/);

  assert.deepEqual(lifecycle, [
    'planning:stop',
  ]);
  assert.equal(service.isRunning(), false);
  assert.equal(service.getWindowUrl(), null);
});

test('bundled child entrypoint strips its dedicated flag while invoking the bundled module', async () => {
  const runtimeRoot = 'C:\\runtime';
  const processState = {
    argv: ['desktop-shell.exe', '.', GATEWAY_CHILD_FLAG, '--mode=disconnected'],
  };
  const observedArgv: string[][] = [];

  await runBundledChildEntryPoint({
    runtimeRoot,
    entryRelativePath: ['local-tracker', 'dist', 'messagingGateway', 'index.js'],
    childLabel: 'gateway-child',
    stripChildFlag: stripGatewayChildFlag,
    fs: {
      existsSync: (candidate) => candidate === path.join(runtimeRoot, 'local-tracker', 'dist', 'messagingGateway', 'index.js'),
    },
    loadModule: () => ({
      main: async () => {
        observedArgv.push(processState.argv.slice());
      },
    }),
    processState,
  });

  assert.deepEqual(observedArgv, [['desktop-shell.exe', '.', '--mode=disconnected']]);
  assert.deepEqual(processState.argv, ['desktop-shell.exe', '.', GATEWAY_CHILD_FLAG, '--mode=disconnected']);
});

test('runtime service records startup_dep_failed diagnostic when start throws', async () => {
  const runtimeRoot = 'C:\\runtime';
  const elegyHome = 'C:\\Users\\tester\\.elegy';
  const events: { name: string; payload: Record<string, unknown> }[] = [];
  const diagnostics = {
    recordEvent: async (name: string, payload: Record<string, unknown>) => {
      events.push({ name, payload });
    },
    recordEventSync: (name: string, payload: Record<string, unknown>) => {
      events.push({ name, payload });
    },
    resolveLogPath: (name: string) => `C:/logs/${name}.json`,
  };
  const existingPaths = new Set([
    path.join(runtimeRoot, 'local-tracker'),
  ]);
  const service = createDesktopRuntimeService(
    {
      paths: {
        runtimeRoot,
        workspaceRoot: runtimeRoot,
        elegyHome,
      },
      isPackaged: true,
      processExecPath: 'C:\\runtime\\elegy-copilot-tauri-shell.exe',
      appVersion: '1.0.1',
      appPath: 'C:\\runtime\\copilot-ui',
      currentDirname: 'C:\\runtime\\copilot-ui\\src-tauri\\target\\release',
      env: {},
      platform: 'win32',
      logger: { log: () => undefined, warn: () => undefined },
    },
    {

      startDesktopPlanningPersistence: async () => ({
        connectionString: 'postgres://planning',
        queryClient: { query: async () => ({ rows: [] }) },
        stop: async () => undefined,
      }),
      startServer: async () => {
        throw new Error('server exploded');
      },
      fs: {
        existsSync: (candidate: string) => existingPaths.has(candidate),
        mkdirSync: () => undefined,

      },
      createRandomHex: (() => () => {
        return 'token';
      })(),
      diagnostics: diagnostics as never,
    },
  );

  await assert.rejects(() => service.start(), /server exploded/);
  const startupFailure = events.find((event) => event.name === 'startup_dep_failed');
  assert.ok(startupFailure, 'expected a startup_dep_failed diagnostic event');
  const error = startupFailure.payload.error as { message?: string };
  assert.equal(error?.message, 'server exploded');
  const childrenState = startupFailure.payload.childrenState as Record<string, { status: string }>;
  assert.equal(childrenState.planning.status, 'running');
  assert.equal(childrenState.server.status, 'not_started');
});
