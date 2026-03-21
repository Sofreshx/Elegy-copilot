/// <reference path="./electron-externals.d.ts" />

import { resolveRollbackPolicy, RollbackPolicyResolution } from './rollbackPolicy';
import { evaluateUpdateCandidate, evaluateUpdateCheck, resolveUpdateChannel } from './updatePolicy';

export type UpdaterStatus =
  | 'idle'
  | 'checking'
  | 'blocked'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'up-to-date'
  | 'error';

export interface UpdaterState {
  supported: boolean;
  status: UpdaterStatus;
  channel: string;
  currentVersion: string;
  availableVersion: string | null;
  progressPercent: number | null;
  transferredBytes: number | null;
  totalBytes: number | null;
  message: string | null;
  reason: string | null;
  lastUpdatedAtMs: number;
  canCheckForUpdates: boolean;
  canDownload: boolean;
  canRestartToUpdate: boolean;
}

type UpdaterStateListener = (state: UpdaterState) => void;

interface UpdaterClient {
  autoDownload: boolean;
  allowPrerelease: boolean;
  checkForUpdates?: () => Promise<unknown>;
  checkForUpdatesAndNotify: () => Promise<unknown>;
  downloadUpdate?: () => Promise<unknown>;
  quitAndInstall?: (isSilent?: boolean, isForceRunAfter?: boolean) => void;
  on: (event: string, listener: (...args: unknown[]) => void) => void;
}

interface UpdaterOptions {
  appVersion: string;
  explicitChannel?: string | null;
  rollbackPolicyJson?: string | null;
  disableUpdates?: boolean | string | null;
  updaterClient?: UpdaterClient;
  logger?: (message: string) => void;
}

let cachedDefaultUpdaterClient: UpdaterClient | null | undefined;

function finalizeUpdaterState(state: Omit<UpdaterState, 'canCheckForUpdates' | 'canDownload' | 'canRestartToUpdate'>): UpdaterState {
  const canCheckForUpdates = state.supported && state.status !== 'checking' && state.status !== 'downloading';
  return {
    ...state,
    canCheckForUpdates,
    canDownload: state.supported && state.status === 'available',
    canRestartToUpdate: state.supported && state.status === 'downloaded',
  };
}

export function createUnavailableUpdaterState(appVersion: string, reason: string, channel = 'stable'): UpdaterState {
  return finalizeUpdaterState({
    supported: false,
    status: 'blocked',
    channel,
    currentVersion: appVersion,
    availableVersion: null,
    progressPercent: null,
    transferredBytes: null,
    totalBytes: null,
    message: reason,
    reason,
    lastUpdatedAtMs: Date.now(),
  });
}

function resolveDefaultUpdaterClient(): UpdaterClient | null {
  if (cachedDefaultUpdaterClient !== undefined) {
    return cachedDefaultUpdaterClient;
  }

  try {
    const electronUpdater = require('electron-updater') as { autoUpdater?: UpdaterClient };
    cachedDefaultUpdaterClient = electronUpdater.autoUpdater || null;
  } catch {
    cachedDefaultUpdaterClient = null;
  }

  return cachedDefaultUpdaterClient;
}

function parseBooleanOverride(input: boolean | string | null | undefined): boolean | null {
  if (typeof input === 'boolean') {
    return input;
  }

  const value = String(input || '').trim().toLowerCase();
  if (!value) {
    return null;
  }

  if (value === '1' || value === 'true' || value === 'yes' || value === 'on') {
    return true;
  }
  if (value === '0' || value === 'false' || value === 'no' || value === 'off') {
    return false;
  }

  return null;
}

function resolveEffectiveRollbackPolicy(options: UpdaterOptions): RollbackPolicyResolution {
  const disableOverride = parseBooleanOverride(options.disableUpdates);
  const disableOverrideIsMalformed =
    options.disableUpdates !== undefined && options.disableUpdates !== null && disableOverride === null;
  if (disableOverrideIsMalformed) {
    return {
      ok: false,
      reason: 'rollback_policy_malformed',
    };
  }

  if (disableOverride === true) {
    return {
      ok: true,
      policy: {
        updatesEnabled: false,
      },
    };
  }

  const parsedPolicy = resolveRollbackPolicy(options.rollbackPolicyJson);
  if (!parsedPolicy.ok) {
    return parsedPolicy;
  }

  if (disableOverride === false) {
    return {
      ok: true,
      policy: {
        ...parsedPolicy.policy,
        updatesEnabled: true,
      },
    };
  }

  return parsedPolicy;
}

export function configureUpdater(options: UpdaterOptions) {
  const logger = options.logger || (() => {});
  const updater = options.updaterClient || resolveDefaultUpdaterClient();
  const channel = resolveUpdateChannel({
    appVersion: options.appVersion,
    explicitChannel: options.explicitChannel,
  });
  const rollbackPolicy = resolveEffectiveRollbackPolicy(options);
  const checkDecision = evaluateUpdateCheck({
    appVersion: options.appVersion,
    explicitChannel: options.explicitChannel,
    rollbackPolicy,
  });

  let state = finalizeUpdaterState({
    supported: Boolean(updater) && checkDecision.allowed,
    status: updater && checkDecision.allowed ? 'idle' : 'blocked',
    channel,
    currentVersion: options.appVersion,
    availableVersion: null,
    progressPercent: null,
    transferredBytes: null,
    totalBytes: null,
    message: updater
      ? (checkDecision.allowed ? 'Ready to check for updates.' : `Updates blocked: ${checkDecision.reason}`)
      : 'Updater module unavailable.',
    reason: updater ? (checkDecision.allowed ? null : checkDecision.reason) : 'updater_module_unavailable',
    lastUpdatedAtMs: Date.now(),
  });
  const listeners = new Set<UpdaterStateListener>();

  const emitState = (patch: Partial<Omit<UpdaterState, 'canCheckForUpdates' | 'canDownload' | 'canRestartToUpdate'>>): UpdaterState => {
    state = finalizeUpdaterState({
      ...state,
      ...patch,
      lastUpdatedAtMs: Date.now(),
    });
    listeners.forEach((listener) => listener(state));
    return state;
  };

  if (!updater) {
    logger(`[updater] update checks blocked on channel ${channel}: updater_module_unavailable`);
  } else if (!checkDecision.allowed) {
    logger(`[updater] update checks blocked on channel ${channel}: ${checkDecision.reason}`);
  }

  if (updater) {
    updater.autoDownload = false;
    updater.allowPrerelease = channel === 'prerelease';

    updater.on('checking-for-update', () => {
      if (!checkDecision.allowed) {
        return;
      }
      emitState({
        status: 'checking',
        message: 'Checking for updates...',
        reason: null,
        progressPercent: null,
        transferredBytes: null,
        totalBytes: null,
      });
    });

    updater.on('update-not-available', (info: unknown) => {
      if (!checkDecision.allowed) {
        return;
      }

      const details = info && typeof info === 'object' ? (info as Record<string, unknown>) : {};
      emitState({
        status: 'up-to-date',
        availableVersion: null,
        progressPercent: null,
        transferredBytes: null,
        totalBytes: null,
        message: `You are up to date${details.version ? ` (${String(details.version)})` : ''}.`,
        reason: null,
      });
    });

    updater.on('update-available', (info: unknown) => {
      if (!checkDecision.allowed) {
        return;
      }

      const details = info && typeof info === 'object' ? (info as Record<string, unknown>) : {};
      const candidateVersion = String(details.version || '').trim();
      const decision = evaluateUpdateCandidate({
        appVersion: options.appVersion,
        explicitChannel: options.explicitChannel,
        candidateVersion,
        rollbackPolicy,
      });

      if (!decision.allowed) {
        logger(
          `[updater] blocked update candidate ${candidateVersion || '(unknown)'} on channel ${decision.channel}: ${decision.reason}`,
        );
        emitState({
          supported: false,
          status: 'blocked',
          availableVersion: candidateVersion || null,
          progressPercent: null,
          transferredBytes: null,
          totalBytes: null,
          message: `Updates blocked: ${decision.reason}`,
          reason: decision.reason,
        });
        return;
      }

      logger(`[updater] update available on channel ${decision.channel}: ${candidateVersion || '(unknown)'}`);
      emitState({
        status: 'available',
        availableVersion: candidateVersion || null,
        progressPercent: null,
        transferredBytes: null,
        totalBytes: null,
        message: `Update ${candidateVersion || 'available'} is ready to download.`,
        reason: null,
      });
    });

    updater.on('download-progress', (info: unknown) => {
      const details = info && typeof info === 'object' ? (info as Record<string, unknown>) : {};
      const percentValue = Number(details.percent);
      const transferredValue = Number(details.transferred);
      const totalValue = Number(details.total);
      emitState({
        status: 'downloading',
        progressPercent: Number.isFinite(percentValue) ? percentValue : state.progressPercent,
        transferredBytes: Number.isFinite(transferredValue) ? transferredValue : state.transferredBytes,
        totalBytes: Number.isFinite(totalValue) ? totalValue : state.totalBytes,
        message: `Downloading update${state.availableVersion ? ` ${state.availableVersion}` : ''}...`,
        reason: null,
      });
    });

    updater.on('update-downloaded', (info: unknown) => {
      const details = info && typeof info === 'object' ? (info as Record<string, unknown>) : {};
      const downloadedVersion = String(details.version || state.availableVersion || '').trim() || null;
      emitState({
        status: 'downloaded',
        availableVersion: downloadedVersion,
        progressPercent: 100,
        message: `Update ${downloadedVersion || ''} is ready to install.`.trim(),
        reason: null,
      });
    });

    updater.on('error', (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      logger(`[updater] error: ${message}`);
      emitState({
        status: 'error',
        message,
        reason: 'updater_error',
      });
    });
  }

  return {
    channel,
    getState: (): UpdaterState => state,
    subscribe: (listener: UpdaterStateListener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    checkForUpdates: async () => {
      if (!checkDecision.allowed || !updater) {
        return state;
      }

      emitState({
        status: 'checking',
        message: 'Checking for updates...',
        reason: null,
      });

      try {
        const checkForUpdates = updater.checkForUpdates || updater.checkForUpdatesAndNotify;
        await checkForUpdates.call(updater);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger(`[updater] error: ${message}`);
        emitState({
          status: 'error',
          message,
          reason: 'updater_error',
        });
      }

      return state;
    },
    downloadUpdate: async () => {
      if (!updater || !checkDecision.allowed || typeof updater.downloadUpdate !== 'function') {
        return state;
      }

      emitState({
        status: 'downloading',
        progressPercent: state.progressPercent ?? 0,
        transferredBytes: state.transferredBytes ?? 0,
        totalBytes: state.totalBytes,
        message: `Downloading update${state.availableVersion ? ` ${state.availableVersion}` : ''}...`,
        reason: null,
      });

      try {
        await updater.downloadUpdate();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger(`[updater] error: ${message}`);
        emitState({
          status: 'error',
          message,
          reason: 'updater_error',
        });
      }

      return state;
    },
    restartToUpdate: async () => {
      if (!updater || typeof updater.quitAndInstall !== 'function' || state.status !== 'downloaded') {
        return false;
      }

      updater.quitAndInstall(false, true);
      return true;
    },
  };
}
