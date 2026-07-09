'use strict';

const { createGitHubReleaseUpdaterClient } = require('./desktop-shell/githubReleaseUpdaterClient');
const { resolveRollbackPolicy } = require('./desktop-shell/rollbackPolicy');
const {
  evaluateUpdateCandidate,
  evaluateUpdateCheck,
  resolveDesktopReleaseChannelContract,
} = require('./desktop-shell/updatePolicy');

function finalizeUpdaterState(state) {
  const canCheckForUpdates = state.supported && state.status !== 'checking' && state.status !== 'downloading';
  return {
    ...state,
    canCheckForUpdates,
    canDownload: state.supported && state.status === 'available',
    canRestartToUpdate: state.supported && state.status === 'downloaded',
  };
}

function createUnavailableUpdaterState(appVersion, reason, channel = 'stable', message = null) {
  return finalizeUpdaterState({
    supported: false,
    status: 'blocked',
    channel,
    currentVersion: appVersion,
    availableVersion: null,
    progressPercent: null,
    transferredBytes: null,
    totalBytes: null,
    message: message || reason,
    reason,
    lastUpdatedAtMs: Date.now(),
  });
}

function parseBooleanOverride(input) {
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

function resolveEffectiveRollbackPolicy(options) {
  const disableOverride = parseBooleanOverride(options.disableUpdates);
  const disableOverrideIsMalformed = options.disableUpdates !== undefined
    && options.disableUpdates !== null
    && disableOverride === null;
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

  const configuredPolicy = String(options.rollbackPolicyJson || '').trim();
  if (configuredPolicy) {
    return resolveRollbackPolicy(configuredPolicy);
  }

  return resolveRollbackPolicy(options.defaultRollbackPolicyJson);
}

function createDesktopUpdaterController(options = {}) {
  const logger = typeof options.logger === 'function' ? options.logger : () => {};
  const releaseContract = resolveDesktopReleaseChannelContract({
    appVersion: options.appVersion,
    explicitChannel: options.explicitChannel,
  });
  const channel = releaseContract.contract.channel;
  const rollbackPolicy = resolveEffectiveRollbackPolicy(options);
  const checkDecision = evaluateUpdateCheck({
    appVersion: options.appVersion,
    explicitChannel: options.explicitChannel,
    rollbackPolicy,
  });

  let client = options.client || null;
  if (!client && options.publishRepository) {
    try {
      client = createGitHubReleaseUpdaterClient({
        publishRepository: options.publishRepository,
        fetch: options.fetch,
        logger,
        platform: options.platform,
        downloadRoot: options.downloadRoot,
      });
    } catch (error) {
      logger(`[desktop-updater] client init failed: ${String(error && error.message ? error.message : error)}`);
      client = null;
    }
  }

  let state = finalizeUpdaterState({
    supported: Boolean(client) && checkDecision.allowed,
    status: client && checkDecision.allowed ? 'idle' : 'blocked',
    channel,
    currentVersion: options.appVersion,
    availableVersion: null,
    progressPercent: null,
    transferredBytes: null,
    totalBytes: null,
    message: client
      ? (checkDecision.allowed
        ? 'Automatic update checks are enabled. Installer download and apply stay manual.'
        : `Updates blocked: ${checkDecision.reason}`)
      : 'Desktop updater client unavailable.',
    reason: client ? (checkDecision.allowed ? null : checkDecision.reason) : 'desktop_updater_client_unavailable',
    lastUpdatedAtMs: Date.now(),
  });
  let currentCandidate = null;
  let downloadedInstaller = null;
  const listeners = new Set();

  function emitState(patch) {
    state = finalizeUpdaterState({
      ...state,
      ...patch,
      lastUpdatedAtMs: Date.now(),
    });
    for (const listener of listeners) {
      listener(state);
    }
    return state;
  }

  async function checkForUpdates() {
    if (!client || !checkDecision.allowed) {
      return state;
    }

    emitState({
      supported: true,
      status: 'checking',
      message: 'Checking GitHub releases for desktop updates...',
      reason: null,
      availableVersion: null,
      progressPercent: null,
      transferredBytes: null,
      totalBytes: null,
    });

    try {
      const result = await client.findLatestReleaseCandidate({
        channel,
        currentVersion: options.appVersion,
        isCandidateAllowed: (candidateVersion) => evaluateUpdateCandidate({
          appVersion: options.appVersion,
          explicitChannel: options.explicitChannel,
          candidateVersion,
          rollbackPolicy,
        }),
      });

      if (!result || result.outcome === 'blocked') {
        currentCandidate = null;
        downloadedInstaller = null;
        return emitState({
          supported: false,
          status: 'blocked',
          availableVersion: result && result.availableVersion ? result.availableVersion : null,
          message: result && result.message
            ? result.message
            : 'Desktop updates are blocked by release metadata or channel policy.',
          reason: result && result.reason ? result.reason : 'update_candidate_blocked',
        });
      }

      if (result.outcome === 'up-to-date') {
        currentCandidate = null;
        downloadedInstaller = null;
        return emitState({
          supported: true,
          status: 'up-to-date',
          availableVersion: null,
          message: options.appVersion
            ? `You are up to date on ${options.appVersion}.`
            : 'You are on the latest published desktop version.',
          reason: null,
        });
      }

      currentCandidate = result.candidate;
      downloadedInstaller = null;
      return emitState({
        supported: true,
        status: 'available',
        availableVersion: result.candidate.version,
        progressPercent: null,
        transferredBytes: null,
        totalBytes: null,
        message: `Signed update ${result.candidate.version} is available.`,
        reason: null,
      });
    } catch (error) {
      currentCandidate = null;
      downloadedInstaller = null;
      const message = error instanceof Error ? error.message : String(error);
      logger(`[desktop-updater] check failed: ${message}`);
      return emitState({
        supported: false,
        status: 'error',
        message,
        reason: 'updater_error',
      });
    }
  }

  async function downloadUpdate() {
    if (!client || !checkDecision.allowed || !currentCandidate || state.status !== 'available') {
      return state;
    }

    emitState({
      supported: true,
      status: 'downloading',
      progressPercent: 0,
      transferredBytes: 0,
      totalBytes: currentCandidate.artifact.size,
      message: `Downloading signed update artifact for ${currentCandidate.version}...`,
      reason: null,
    });

    try {
      downloadedInstaller = await client.downloadInstaller(currentCandidate, {
        onProgress: (progress) => {
          emitState({
            supported: true,
            status: 'downloading',
            progressPercent: progress.progressPercent,
            transferredBytes: progress.transferredBytes,
            totalBytes: progress.totalBytes,
            message: `Downloading signed update artifact for ${currentCandidate.version}...`,
            reason: null,
          });
        },
      });

      return emitState({
        supported: true,
        status: 'downloaded',
        availableVersion: currentCandidate.version,
        progressPercent: 100,
        transferredBytes: downloadedInstaller.totalBytes,
        totalBytes: downloadedInstaller.totalBytes,
        message: `Signed update artifact for ${currentCandidate.version} is ready.`,
        reason: null,
      });
    } catch (error) {
      downloadedInstaller = null;
      const message = error instanceof Error ? error.message : String(error);
      logger(`[desktop-updater] download failed: ${message}`);
      return emitState({
        supported: false,
        status: 'error',
        message,
        reason: 'updater_error',
      });
    }
  }

  async function restartToUpdate() {
    if (!client || !downloadedInstaller || state.status !== 'downloaded') {
      return false;
    }

    try {
      await client.launchInstaller(downloadedInstaller);
      logger(`[desktop-updater] launched installer ${downloadedInstaller.installerPath}`);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger(`[desktop-updater] installer launch failed: ${message}`);
      emitState({
        supported: false,
        status: 'error',
        message,
        reason: 'updater_error',
      });
      return false;
    }
  }

  return {
    channel,
    getState() {
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    checkForUpdates,
    downloadUpdate,
    restartToUpdate,
    close() {
      listeners.clear();
    },
  };
}

module.exports = {
  createDesktopUpdaterController,
  createUnavailableUpdaterState,
  finalizeUpdaterState,
};
