import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DesktopUpdaterState } from '../ui/src/lib/types';
import { desktopUpdaterStore } from '../ui/src/stores/desktopUpdaterStore';

const BASE_STATE: DesktopUpdaterState = {
  supported: true,
  status: 'idle',
  channel: 'stable',
  currentVersion: '1.2.3',
  availableVersion: null,
  progressPercent: null,
  transferredBytes: null,
  totalBytes: null,
  message: 'Ready to check for updates.',
  reason: null,
  lastUpdatedAtMs: Date.now(),
  canCheckForUpdates: true,
  canDownload: false,
  canRestartToUpdate: false,
};

describe('desktopUpdaterStore', () => {
  beforeEach(() => {
    const listeners = new Set<(state: DesktopUpdaterState) => void>();
    const updater = {
      getState: vi.fn(async () => BASE_STATE),
      checkForUpdates: vi.fn(async () => ({
        ...BASE_STATE,
        status: 'checking',
        message: 'Checking for updates...',
        canCheckForUpdates: false,
        lastUpdatedAtMs: Date.now(),
      })),
      downloadUpdate: vi.fn(async () => ({
        ...BASE_STATE,
        status: 'downloading',
        availableVersion: '1.2.4',
        progressPercent: 50,
        message: 'Downloading update 1.2.4...',
        canCheckForUpdates: false,
        lastUpdatedAtMs: Date.now(),
      })),
      restartToUpdate: vi.fn(async () => true),
      subscribe: vi.fn((listener: (state: DesktopUpdaterState) => void) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      }),
      emit: (state: DesktopUpdaterState) => {
        listeners.forEach((listener) => listener(state));
      },
    };

    Object.defineProperty(window, 'instructionEngineDesktop', {
      configurable: true,
      value: {
        platform: 'win32',
        electronVersion: '33.2.0',
        updater,
      },
    });
  });

  afterEach(() => {
    desktopUpdaterStore.stopListening();
    vi.restoreAllMocks();
    delete (window as Window & { instructionEngineDesktop?: unknown }).instructionEngineDesktop;
  });

  it('hydrates from the preload bridge and reacts to pushed updater state', async () => {
    desktopUpdaterStore.startListening();
    await Promise.resolve();
    expect(desktopUpdaterStore.getState().currentVersion).toBe('1.2.3');

    const bridge = window.instructionEngineDesktop?.updater as typeof window.instructionEngineDesktop.updater & {
      emit: (state: DesktopUpdaterState) => void;
    };
    bridge.emit({
      ...BASE_STATE,
      status: 'available',
      availableVersion: '1.2.4',
      message: 'Update 1.2.4 is ready to download.',
      canDownload: true,
      lastUpdatedAtMs: Date.now(),
    });

    expect(desktopUpdaterStore.getState().status).toBe('available');
    expect(desktopUpdaterStore.getState().canDownload).toBe(true);
  });

  it('forwards update actions to the preload bridge', async () => {
    desktopUpdaterStore.startListening();
    await Promise.resolve();

    const updater = window.instructionEngineDesktop?.updater;
    await desktopUpdaterStore.checkForUpdates();
    await desktopUpdaterStore.downloadUpdate();
    const restarted = await desktopUpdaterStore.restartToUpdate();

    expect(updater?.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(updater?.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(updater?.restartToUpdate).toHaveBeenCalledTimes(1);
    expect(restarted).toBe(true);
  });
});