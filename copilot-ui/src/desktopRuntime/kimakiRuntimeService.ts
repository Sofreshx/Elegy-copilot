import { spawn, type ChildProcess } from 'child_process';
import path from 'path';

import { createKimakiSseParser } from './kimakiSseParser';

export type KimakiRuntimeState = 'idle' | 'awaiting_install' | 'awaiting_auth' | 'ready' | 'error';

export interface KimakiRuntimeService {
  start: (options?: { callbackUrl?: string }) => void;
  stop: () => Promise<void>;
  restart: (options?: { callbackUrl?: string }) => Promise<void>;
  getState: () => KimakiRuntimeState;
  getInstallUrl: () => string | null;
  getReady: () => boolean;
  getGuildIds: () => string[];
  getAppId: () => string | null;
  getLastError: () => string | null;
  getDataDir: () => string;
}

export interface KimakiRuntimeServiceOptions {
  elegyHome: string;
  nodeExecutable: string;
  kimakiEntrypoint: string;
  logger?: Pick<Console, 'log'>;
  spawnImpl?: typeof spawn;
  lockPort?: number;
  stopTimeoutMs?: number;
}

export function buildKimakiRuntimeArgs(
  kimakiEntrypoint: string,
  dataDir: string,
  callbackUrl?: string,
): string[] {
  const args = [kimakiEntrypoint, '--gateway', '--data-dir', dataDir];
  if (callbackUrl) {
    args.push('--gateway-callback-url', callbackUrl);
  }
  return args;
}

export function createKimakiRuntimeService(
  options: KimakiRuntimeServiceOptions,
): KimakiRuntimeService {
  const dataDir = path.join(options.elegyHome, 'kimaki');
  const spawnImpl = options.spawnImpl ?? spawn;
  const log = (message: string): void => options.logger?.log(`[kimaki] ${message}`);

  let state: KimakiRuntimeState = 'idle';
  let installUrl: string | null = null;
  let guildIds: string[] = [];
  let appId: string | null = null;
  let lastError: string | null = null;
  let child: ChildProcess | null = null;
  let stopping = false;
  let lastStartOptions: { callbackUrl?: string } = {};

  const parser = createKimakiSseParser((event) => {
    if (event.type === 'install_url') {
      installUrl = event.url;
      state = 'awaiting_install';
      return;
    }
    if (event.type === 'authorized') {
      state = 'awaiting_auth';
      return;
    }
    if (event.type === 'ready') {
      state = 'ready';
      appId = event.app_id;
      guildIds = event.guild_ids;
      lastError = null;
      return;
    }
    state = 'error';
    lastError = event.message;
    installUrl = event.install_url ?? installUrl;
  });

  function start(startOptions: { callbackUrl?: string } = {}): void {
    if (child) {
      return;
    }

    lastStartOptions = { ...startOptions };
    stopping = false;
    state = 'idle';
    lastError = null;
    parser.reset();
    const spawnedChild = spawnImpl(
      options.nodeExecutable,
      buildKimakiRuntimeArgs(options.kimakiEntrypoint, dataDir, startOptions.callbackUrl),
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        env: {
          ...process.env,
          KIMAKI_LOCK_PORT: String(options.lockPort ?? 31001),
        },
      },
    );
    child = spawnedChild;

    spawnedChild.stdout?.on('data', (chunk) => parser.feed(chunk.toString('utf8')));
    spawnedChild.stderr?.on('data', (chunk) => log(chunk.toString('utf8').trim()));
    spawnedChild.on('error', (error) => {
      state = 'error';
      lastError = error.message;
      child = null;
    });
    spawnedChild.on('exit', (code) => {
      if (!stopping) {
        state = 'error';
        lastError = `Kimaki exited unexpectedly (code=${code ?? 'unknown'})`;
      }
      child = null;
    });
  }

  async function stop(): Promise<void> {
    stopping = true;
    const runningChild = child;
    state = 'idle';
    if (!runningChild) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Kimaki did not exit within the shutdown timeout.'));
      }, options.stopTimeoutMs ?? 2_000);
      runningChild.once('exit', () => {
        clearTimeout(timeout);
        if (child === runningChild) {
          child = null;
        }
        resolve();
      });
      if (!runningChild.kill()) {
        clearTimeout(timeout);
        reject(new Error('Unable to signal Kimaki to stop.'));
      }
    });
  }

  return {
    start,
    stop,
    async restart(startOptions = lastStartOptions) {
      await stop();
      start(startOptions);
    },
    getState: () => state,
    getInstallUrl: () => installUrl,
    getReady: () => state === 'ready',
    getGuildIds: () => [...guildIds],
    getAppId: () => appId,
    getLastError: () => lastError,
    getDataDir: () => dataDir,
  };
}
