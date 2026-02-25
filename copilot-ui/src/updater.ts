/// <reference path="./electron-externals.d.ts" />

import { autoUpdater } from 'electron-updater';

import { resolveRollbackPolicy, RollbackPolicyResolution } from './rollbackPolicy';
import { evaluateUpdateCandidate, evaluateUpdateCheck, resolveUpdateChannel } from './updatePolicy';

interface UpdaterClient {
  autoDownload: boolean;
  allowPrerelease: boolean;
  checkForUpdatesAndNotify: () => Promise<unknown>;
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
  const updater = (options.updaterClient || (autoUpdater as unknown as UpdaterClient)) as UpdaterClient;
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

  updater.autoDownload = false;
  updater.allowPrerelease = channel === 'prerelease';

  if (!checkDecision.allowed) {
    logger(`[updater] update checks blocked on channel ${channel}: ${checkDecision.reason}`);
  }

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
      return;
    }

    logger(`[updater] update available on channel ${decision.channel}: ${candidateVersion || '(unknown)'}`);
  });

  updater.on('error', (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    logger(`[updater] error: ${message}`);
  });

  return {
    channel,
    checkForUpdates: async () => {
      if (!checkDecision.allowed) {
        return;
      }
      await updater.checkForUpdatesAndNotify();
    },
  };
}
