import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import {
  buildDesktopWindowUrl,
  createDesktopRuntimeService,
  resolveDesktopServerPort,
} from './runtimeService';

test('buildDesktopWindowUrl includes the one-time desktop token', () => {
  assert.equal(
    buildDesktopWindowUrl('127.0.0.1', 3210, 'token'),
    'http://127.0.0.1:3210/?desktop-ui-token=token',
  );
});

test('resolveDesktopServerPort accepts zero and rejects invalid values', () => {
  assert.equal(resolveDesktopServerPort({ INSTRUCTION_ENGINE_DESKTOP_SERVER_PORT: '0' }), 0);
  assert.throws(
    () => resolveDesktopServerPort({ INSTRUCTION_ENGINE_DESKTOP_SERVER_PORT: '70000' }),
    /Invalid INSTRUCTION_ENGINE_DESKTOP_SERVER_PORT/,
  );
});

test('desktop runtime starts and closes the HTTP server without legacy sidecars', async () => {
  const lifecycle: string[] = [];
  const elegyHome = path.join('C:\\Users\\test', '.elegy');
  const service = createDesktopRuntimeService(
    {
      paths: {
        runtimeRoot: 'C:\\app',
        workspaceRoot: 'C:\\workspace',
        elegyHome,
      },
      isPackaged: false,
      processExecPath: 'C:\\app\\node\\node.exe',
      appVersion: '1.0.0',
      appPath: 'C:\\app\\copilot-ui',
      currentDirname: 'C:\\app\\copilot-ui\\lib\\desktop-shell',
      env: {},
      platform: 'win32',
    },
    {
      fs: {
        existsSync: () => false,
        mkdirSync: () => undefined,
      },
      createRandomHex: () => 'fixed-token',
      startDesktopPlanningPersistence: async () => {
        throw new Error('planning persistence should not start in dev mode');
      },
      startServer: async (options) => {
        lifecycle.push('server:start');
        assert.equal(options.kimakiRuntimeService, undefined);
        return {
          host: '127.0.0.1',
          port: 3210,
          close: async () => {
            lifecycle.push('server:stop');
          },
        };
      },
    },
  );

  const result = await service.start();
  assert.equal(result.windowUrl, 'http://127.0.0.1:3210/?desktop-ui-token=fixed-token');
  await service.stop();
  assert.deepEqual(lifecycle, ['server:start', 'server:stop']);
});
