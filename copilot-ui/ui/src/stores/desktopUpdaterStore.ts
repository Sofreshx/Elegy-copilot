import { createStore } from '../lib/store';
import type { DesktopUpdaterState } from '../lib/types';

const INITIAL_STATE: DesktopUpdaterState = {
  supported: false,
  status: 'blocked',
  channel: 'stable',
  currentVersion: 'unknown',
  availableVersion: null,
  progressPercent: null,
  transferredBytes: null,
  totalBytes: null,
  message: 'Desktop updater unavailable.',
  reason: 'desktop_bridge_unavailable',
  lastUpdatedAtMs: null,
  canCheckForUpdates: false,
  canDownload: false,
  canRestartToUpdate: false,
};

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return 'Unable to talk to the desktop updater.';
}

function resolveDesktopUpdaterBridge() {
  if (typeof window === 'undefined' || !window.instructionEngineDesktop?.updater) {
    return null;
  }

  return window.instructionEngineDesktop.updater;
}

function createDesktopUpdaterStore() {
  const store = createStore<DesktopUpdaterState>(INITIAL_STATE);
  let unsubscribe: (() => void) | null = null;

  async function syncState(load: () => Promise<DesktopUpdaterState>): Promise<DesktopUpdaterState> {
    try {
      const nextState = await load();
      store.setState(nextState);
      return nextState;
    } catch (error) {
      const message = toErrorMessage(error);
      const nextState: DesktopUpdaterState = {
        ...store.getState(),
        supported: false,
        status: 'error',
        message,
        reason: 'desktop_updater_bridge_error',
        canCheckForUpdates: false,
        canDownload: false,
        canRestartToUpdate: false,
        lastUpdatedAtMs: Date.now(),
      };
      store.setState(nextState);
      return nextState;
    }
  }

  function startListening(): void {
    if (unsubscribe) {
      return;
    }

    const bridge = resolveDesktopUpdaterBridge();
    if (!bridge) {
      return;
    }

    unsubscribe = bridge.subscribe((nextState) => {
      store.setState(nextState);
    });
    void syncState(() => bridge.getState());
  }

  function stopListening(): void {
    unsubscribe?.();
    unsubscribe = null;
  }

  async function checkForUpdates(): Promise<DesktopUpdaterState> {
    const bridge = resolveDesktopUpdaterBridge();
    if (!bridge) {
      return store.getState();
    }
    return syncState(() => bridge.checkForUpdates());
  }

  async function downloadUpdate(): Promise<DesktopUpdaterState> {
    const bridge = resolveDesktopUpdaterBridge();
    if (!bridge) {
      return store.getState();
    }
    return syncState(() => bridge.downloadUpdate());
  }

  async function restartToUpdate(): Promise<boolean> {
    const bridge = resolveDesktopUpdaterBridge();
    if (!bridge) {
      return false;
    }
    return bridge.restartToUpdate();
  }

  return {
    getState: store.getState,
    subscribe: store.subscribe,
    startListening,
    stopListening,
    checkForUpdates,
    downloadUpdate,
    restartToUpdate,
  };
}

export const desktopUpdaterStore = createDesktopUpdaterStore();