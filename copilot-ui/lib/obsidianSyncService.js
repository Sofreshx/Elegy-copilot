'use strict';

const obsidianCli = require('./obsidianCli');
const obsidianNotes = require('./obsidianNotes');
const obsidianRemoteSync = require('./obsidianRemoteSync');
const { createObsidianSourceResolver, remoteSyncUrlRequiresSource } = require('./obsidianSourceResolution');

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

class ObsidianSyncService {
  constructor(deps = {}) {
    this._obsidianNotes = deps.obsidianNotes || obsidianNotes;
    this._obsidianCli = deps.obsidianCli || obsidianCli;
    this._obsidianRemoteSync = deps.obsidianRemoteSync || obsidianRemoteSync;
    this._obsidianSourceResolver = deps.obsidianSourceResolver || createObsidianSourceResolver({
      obsidianRemoteSync: this._obsidianRemoteSync,
      trackerUrl: deps.trackerUrl,
      trackerToken: deps.trackerToken,
      listTrackerSyncedNoteSources: deps.listTrackerSyncedNoteSources,
      fetch: deps.fetch,
    });
    this._childProcess = deps.childProcess || require('child_process');
    this._process = deps.process || process;
    this._fetch = deps.fetch || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    this._setTimeout = deps.setTimeout || setTimeout;
    this._clearTimeout = deps.clearTimeout || clearTimeout;
    this._cliProbeCache = new Map();
    this._inventoryRefreshState = new Map();
    this._syncInflight = new Map();
    this._pollers = new Map();
    this._contexts = new Map();
  }

  _readRepoSyncState(context) {
    return this._obsidianRemoteSync.readRepoSyncState({
      copilotHomeAbs: context.copilotHomeAbs,
      repo: context.repo,
      config: context.config,
    });
  }

  _buildRemoteSyncMetadata(summary = {}) {
    return {
      reason: normalizeString(summary.reason) || undefined,
      nextAttemptAt: normalizeString(summary.nextAttemptAt) || undefined,
      cooldownUntil: normalizeString(summary.cooldownUntil) || undefined,
      retryCount: Number.isFinite(summary.retryCount) ? summary.retryCount : 0,
      retryLimit: Number.isFinite(summary.retryLimit) ? summary.retryLimit : 0,
      lastFailureAt: normalizeString(summary.lastFailureAt) || undefined,
      lastFailureReason: normalizeString(summary.lastFailureReason) || undefined,
      leaseAcquiredAt: normalizeString(summary.leaseAcquiredAt) || undefined,
      leaseExpiresAt: normalizeString(summary.leaseExpiresAt) || undefined,
      leaseTrigger: normalizeString(summary.leaseTrigger) || undefined,
      lastStaleLeaseRecoveredAt: normalizeString(summary.lastStaleLeaseRecoveredAt) || undefined,
    };
  }

  _decorateSyncResult(result, summary = {}) {
    const metadata = this._buildRemoteSyncMetadata(summary);
    const decorated = {
      ...metadata,
      ...result,
    };

    Object.keys(metadata).forEach((key) => {
      if (decorated[key] === undefined && metadata[key] !== undefined) {
        decorated[key] = metadata[key];
      }
    });

    return decorated;
  }

  _resolvePollDelay(context) {
    const repoState = this._readRepoSyncState(context);
    const nextAttemptAt = normalizeString(repoState.summary && repoState.summary.nextAttemptAt);
    const nextAttemptMs = nextAttemptAt ? Date.parse(nextAttemptAt) : NaN;
    if (Number.isFinite(nextAttemptMs) && nextAttemptMs > Date.now()) {
      return Math.max(250, nextAttemptMs - Date.now());
    }

    if (normalizeString(repoState.summary && repoState.summary.lastAttemptAt)) {
      return context.config.remoteSyncPollIntervalMs;
    }

    return Math.min(context.config.remoteSyncPollIntervalMs, 1_000);
  }

  _computeNextAttemptAt(context, retryCount = 0) {
    const baseIntervalMs = Number.isFinite(context.config.remoteSyncPollIntervalMs)
      && context.config.remoteSyncPollIntervalMs > 0
      ? context.config.remoteSyncPollIntervalMs
      : 60_000;
    const retryLimit = Number.isFinite(this._obsidianRemoteSync.DEFAULT_TIMER_RETRY_LIMIT)
      ? this._obsidianRemoteSync.DEFAULT_TIMER_RETRY_LIMIT
      : 4;
    const boundedRetryCount = Math.max(0, Math.min(Number.isFinite(retryCount) ? retryCount : 0, retryLimit));
    const exponent = boundedRetryCount > 0 ? boundedRetryCount - 1 : 0;
    return new Date(Date.now() + (baseIntervalMs * (2 ** exponent))).toISOString();
  }

  _finalizeSyncAttempt(context, trigger, lease, outcome) {
    const repoState = this._readRepoSyncState(context);
    const currentSummary = repoState.summary || {};
    const retryLimit = Number.isFinite(this._obsidianRemoteSync.DEFAULT_TIMER_RETRY_LIMIT)
      ? this._obsidianRemoteSync.DEFAULT_TIMER_RETRY_LIMIT
      : 4;
    const nowIso = new Date().toISOString();
    const isTransientFailure = outcome.state === 'error';
    const isConflict = outcome.state === 'conflict';
    const isSuccess = outcome.state === 'success';
    const previousRetryCount = Number.isFinite(currentSummary.retryCount) ? currentSummary.retryCount : 0;
    const retryCount = (isSuccess || isConflict)
      ? 0
      : (trigger === 'timer' && isTransientFailure
        ? Math.min(previousRetryCount + 1, retryLimit)
        : previousRetryCount);
    const nextAttemptAt = context.config.remoteSyncUrl && context.config.vaultPath
      ? this._computeNextAttemptAt(context, trigger === 'timer' && isTransientFailure ? retryCount : 0)
      : undefined;
    const summaryPatch = {
      state: outcome.state,
      appliedCount: outcome.appliedCount,
      deletedCount: outcome.deletedCount,
      skippedCount: outcome.skippedCount,
      conflictCount: outcome.conflictCount,
      cursor: outcome.cursor,
      message: outcome.message,
      nextAttemptAt,
      cooldownUntil: nextAttemptAt,
      retryCount,
      retryLimit,
    };

    if (trigger === 'manual') {
      summaryPatch.lastManualSyncAt = nowIso;
    }

    if (isSuccess) {
      summaryPatch.lastSuccessAt = nowIso;
      summaryPatch.lastError = undefined;
      summaryPatch.reason = undefined;
      summaryPatch.lastFailureAt = undefined;
      summaryPatch.lastFailureReason = undefined;
    } else if (isConflict) {
      summaryPatch.lastError = normalizeString(outcome.lastError) || outcome.message;
      summaryPatch.reason = normalizeString(outcome.reason) || undefined;
      summaryPatch.lastFailureAt = nowIso;
      summaryPatch.lastFailureReason = normalizeString(outcome.reason)
        || normalizeString(outcome.lastError)
        || outcome.state;
    } else if (isTransientFailure) {
      summaryPatch.lastError = normalizeString(outcome.lastError) || outcome.message;
      summaryPatch.reason = trigger === 'timer'
        ? 'timer_backoff_scheduled'
        : (normalizeString(outcome.reason) || undefined);
      summaryPatch.lastFailureAt = nowIso;
      summaryPatch.lastFailureReason = normalizeString(outcome.reason)
        || normalizeString(outcome.lastError)
        || outcome.state;
    }

    const releasedState = this._obsidianRemoteSync.releaseRepoSyncLease({
      copilotHomeAbs: context.copilotHomeAbs,
      repo: context.repo,
      config: context.config,
      leaseToken: lease && lease.token,
      summaryPatch,
    });

    return this._decorateSyncResult({
      trigger,
      ...outcome,
    }, releasedState.summary);
  }

  _retirePoller(repoKey) {
    const active = this._pollers.get(repoKey);
    if (active && active.timer) {
      this._clearTimeout(active.timer);
    }
    this._pollers.delete(repoKey);
    this._contexts.delete(repoKey);
  }

  _retireInactivePollers(activeRepoKey) {
    for (const repoKey of this._pollers.keys()) {
      if (repoKey !== activeRepoKey) {
        this._retirePoller(repoKey);
      }
    }
  }

  _resolveContext(options = {}) {
    const repo = options.repo || null;
    const copilotHomeAbs = options.copilotHomeAbs || options.copilotHome;
    const config = this._obsidianNotes.resolveObsidianConfig({
      ...options,
      repo,
      copilotHomeAbs,
      copilotHome: copilotHomeAbs,
      process: options.process || this._process,
    });
    const repoKey = this._obsidianRemoteSync.deriveRepoSyncKey(repo);
    return {
      ...options,
      repo,
      repoKey,
      copilotHomeAbs,
      copilotHome: copilotHomeAbs,
      config,
    };
  }

  async _probeCli(context, force = false) {
    const cacheKey = context.repoKey;
    const current = this._cliProbeCache.get(cacheKey);
    if (!force && current && (Date.now() - current.timestamp) < 30_000) {
      return current.value;
    }

    const value = await this._obsidianCli.probeCli(context.config, {
      childProcess: this._childProcess,
      env: this._process.env,
      cwd: normalizeString(context.config.vaultPath) || undefined,
      timeoutMs: context.config.remoteSyncTimeoutMs,
    });
    this._cliProbeCache.set(cacheKey, { timestamp: Date.now(), value });
    return value;
  }

  _readRemoteSyncStatus(context) {
    return this._readRepoSyncState(context).summary;
  }

  async _resolveSourceSelection(context, options = {}) {
    if (options.sourceResolution && typeof options.sourceResolution === 'object') {
      return options.sourceResolution;
    }
    return this._obsidianSourceResolver.resolveSourceSelection({
      repo: context.repo,
      config: context.config,
      copilotHomeAbs: context.copilotHomeAbs,
    });
  }

  async _buildStatus(context, options = {}) {
    const [cli, sourceResolution] = await Promise.all([
      this._probeCli(context, options.forceCliProbe === true),
      this._resolveSourceSelection(context, options),
    ]);
    const remoteSync = this._readRemoteSyncStatus(context);
    return this._obsidianNotes.resolveObsidianStatus({
      ...context,
      process: this._process,
    }, {
      cli,
      remoteSync,
      sourceResolution,
    });
  }

  _ensurePolling(context) {
    this._retireInactivePollers(context.repoKey);

    if (!context.config.remoteSyncUrl || !context.config.vaultPath) {
      this._retirePoller(context.repoKey);
      return;
    }

    this._contexts.set(context.repoKey, context);
    if (this._pollers.has(context.repoKey)) {
      return;
    }

    const run = async () => {
      const latestContext = this._contexts.get(context.repoKey);
      if (!latestContext) {
        return;
      }

      try {
        await this.syncNow({
          ...latestContext,
          skipEnsurePolling: true,
        }, 'timer');
      } catch {
        // best-effort background loop
      } finally {
        const active = this._pollers.get(context.repoKey);
        if (!active) {
          return;
        }
        active.timer = this._setTimeout(run, this._resolvePollDelay(latestContext));
        if (active.timer && typeof active.timer.unref === 'function') {
          active.timer.unref();
        }
      }
    };

    const timer = this._setTimeout(run, this._resolvePollDelay(context));
    if (timer && typeof timer.unref === 'function') {
      timer.unref();
    }
    this._pollers.set(context.repoKey, { timer });
  }

  async _refreshInventory(context, force = false) {
    const command = this._obsidianCli.resolveCommand(context.config, 'refreshInventory');
    if (command.length === 0) {
      return null;
    }

    const refreshState = this._inventoryRefreshState.get(context.repoKey);
    if (!force && refreshState && (Date.now() - refreshState.timestamp) < 10_000) {
      return refreshState.result;
    }

    const result = await this._obsidianCli.runConfiguredCommand(context.config, 'refreshInventory', {
      childProcess: this._childProcess,
      env: this._process.env,
      cwd: normalizeString(context.config.vaultPath) || undefined,
      timeoutMs: context.config.remoteSyncTimeoutMs,
    });
    this._inventoryRefreshState.set(context.repoKey, { timestamp: Date.now(), result });
    this._cliProbeCache.delete(context.repoKey);
    return result;
  }

  async getStatus(options = {}) {
    const context = this._resolveContext(options);
    this._ensurePolling(context);
    return this._buildStatus(context);
  }

  async setActiveSourceSelection(options = {}, sourceId) {
    const context = this._resolveContext(options);
    const sourceResolution = await this._obsidianSourceResolver.setActiveSourceSelection({
      repo: context.repo,
      config: context.config,
      copilotHomeAbs: context.copilotHomeAbs,
    }, sourceId);
    return this._buildStatus(context, { sourceResolution });
  }

  async listNotes(options = {}) {
    const context = this._resolveContext(options);
    this._ensurePolling(context);
    try {
      await this._refreshInventory(context, false);
    } catch {
      // Preserve the local note surface even if a refresh hook fails.
    }
    const status = await this._buildStatus(context);
    return this._obsidianNotes.listLocalObsidianNotes({
      ...context,
      process: this._process,
    }, status);
  }

  async readNote(options = {}, noteId) {
    const context = this._resolveContext(options);
    this._ensurePolling(context);
    try {
      await this._refreshInventory(context, false);
    } catch {
      // Preserve the local note surface even if a refresh hook fails.
    }
    const status = await this._buildStatus(context);
    return this._obsidianNotes.readLocalObsidianNote({
      ...context,
      process: this._process,
    }, noteId, status);
  }

  async syncNow(options = {}, trigger = 'manual') {
    const context = this._resolveContext(options);
    if (!options.skipEnsurePolling) {
      this._ensurePolling(context);
    }

    if (!context.config.vaultPath) {
      return {
        trigger,
        state: 'disabled',
        appliedCount: 0,
        deletedCount: 0,
        skippedCount: 0,
        conflictCount: 0,
        conflicts: [],
        message: 'Configure IE_OBSIDIAN_VAULT_PATH before running Obsidian sync.',
      };
    }

    if (!context.config.remoteSyncUrl && this._obsidianCli.resolveCommand(context.config, 'manualSync').length === 0) {
      return {
        trigger,
        state: 'disabled',
        appliedCount: 0,
        deletedCount: 0,
        skippedCount: 0,
        conflictCount: 0,
        conflicts: [],
        message: 'No Obsidian pull-sync contract is configured for this repo.',
      };
    }

    const existing = this._syncInflight.get(context.repoKey);
    if (existing) {
      return existing;
    }

    const repoState = this._readRepoSyncState(context);
    const nextAttemptAt = normalizeString(repoState.summary && repoState.summary.nextAttemptAt);
    const nextAttemptMs = nextAttemptAt ? Date.parse(nextAttemptAt) : NaN;
    if (trigger === 'timer' && Number.isFinite(nextAttemptMs) && nextAttemptMs > Date.now()) {
      const summary = repoState.summary || {};
      const persistedState = normalizeString(summary.state).toLowerCase();
      return this._decorateSyncResult({
        trigger,
        state:
          persistedState === 'success'
          || persistedState === 'error'
          || persistedState === 'conflict'
          || persistedState === 'syncing'
          || persistedState === 'disabled'
            ? persistedState
            : 'idle',
        appliedCount: Number.isFinite(summary.appliedCount) ? summary.appliedCount : 0,
        deletedCount: Number.isFinite(summary.deletedCount) ? summary.deletedCount : 0,
        skippedCount: Number.isFinite(summary.skippedCount) ? summary.skippedCount : 0,
        conflictCount: Number.isFinite(summary.conflictCount) ? summary.conflictCount : 0,
        conflicts: [],
        cursor: normalizeString(repoState.cursor) || normalizeString(summary.cursor) || undefined,
        message: `Timer-based Obsidian sync is cooling down until ${nextAttemptAt}.`,
        reason: 'cooldown_active',
      }, summary);
    }

    const lease = this._obsidianRemoteSync.acquireRepoSyncLease({
      copilotHomeAbs: context.copilotHomeAbs,
      repo: context.repo,
      config: context.config,
      trigger,
    });

    if (!lease.acquired) {
      const summary = lease.state && lease.state.summary ? lease.state.summary : {};
      return this._decorateSyncResult({
        trigger,
        state: 'syncing',
        appliedCount: Number.isFinite(summary.appliedCount) ? summary.appliedCount : 0,
        deletedCount: Number.isFinite(summary.deletedCount) ? summary.deletedCount : 0,
        skippedCount: Number.isFinite(summary.skippedCount) ? summary.skippedCount : 0,
        conflictCount: Number.isFinite(summary.conflictCount) ? summary.conflictCount : 0,
        conflicts: [],
        cursor: normalizeString(lease.state && lease.state.cursor) || normalizeString(summary.cursor) || undefined,
        message: 'Another Obsidian sync is already running for this repo.',
        reason: 'lease_active',
      }, summary);
    }

    let sourceResolution;
    try {
      sourceResolution = await this._resolveSourceSelection(context);
    } catch (error) {
      const message = normalizeString(error && error.message) || 'Obsidian sync failed before it could start.';
      return this._finalizeSyncAttempt(context, trigger, lease.activeLease, {
        state: 'error',
        appliedCount: 0,
        deletedCount: 0,
        skippedCount: 0,
        conflictCount: 0,
        conflicts: [],
        cursor: normalizeString(this._readRepoSyncState(context).cursor) || undefined,
        message,
        reason: 'sync_prerequisite_failed',
        lastError: message,
      });
    }

    if (context.config.remoteSyncUrl && remoteSyncUrlRequiresSource(context.config.remoteSyncUrl) && !sourceResolution.effectiveSource) {
      const message = `Remote Obsidian sync requires a resolved synced-note source. ${sourceResolution.message}`;
      return this._finalizeSyncAttempt(context, trigger, lease.activeLease, {
        state: 'error',
        appliedCount: 0,
        deletedCount: 0,
        skippedCount: 0,
        conflictCount: 0,
        conflicts: [],
        cursor: normalizeString(this._readRepoSyncState(context).cursor) || undefined,
        message,
        reason: normalizeString(sourceResolution.reason) || 'obsidian_source_unresolved',
        lastError: message,
      });
    }

    const promise = this._runSync(context, trigger, sourceResolution, lease.activeLease)
      .finally(() => {
        this._syncInflight.delete(context.repoKey);
      });
    this._syncInflight.set(context.repoKey, promise);
    return promise;
  }

  async _runSync(context, trigger, sourceResolution, lease) {
    let cliManualResult = null;
    let remoteResult = {
      state: 'success',
      appliedCount: 0,
      deletedCount: 0,
      skippedCount: 0,
      conflictCount: 0,
      conflicts: [],
      cursor: undefined,
      message: 'No remote feed configured.',
    };

    try {
      if (trigger === 'manual' && this._obsidianCli.resolveCommand(context.config, 'manualSync').length > 0) {
        cliManualResult = await this._obsidianCli.runConfiguredCommand(context.config, 'manualSync', {
          childProcess: this._childProcess,
          env: this._process.env,
          cwd: normalizeString(context.config.vaultPath) || undefined,
          timeoutMs: context.config.remoteSyncTimeoutMs,
        });
      }

      if (context.config.remoteSyncUrl) {
        const repoState = this._obsidianRemoteSync.readRepoSyncState({
          copilotHomeAbs: context.copilotHomeAbs,
          repo: context.repo,
          config: context.config,
        });
        if (!this._fetch) {
          throw new Error('Global fetch is unavailable; remote Obsidian pull sync cannot run.');
        }
        const feed = await this._obsidianRemoteSync.pullRemoteFeed({
          config: context.config,
          repo: context.repo,
          cursor: repoState.cursor,
          effectiveSource: sourceResolution && sourceResolution.effectiveSource,
          fetchImpl: this._fetch,
          processImpl: this._process,
          });
        remoteResult = this._obsidianRemoteSync.applyRemoteFeed({
          copilotHomeAbs: context.copilotHomeAbs,
          repo: context.repo,
          config: context.config,
          feed,
        });
      }

      try {
        await this._refreshInventory(context, true);
      } catch (error) {
        remoteResult = {
          ...remoteResult,
          message: `${remoteResult.message} Inventory refresh hook failed: ${normalizeString(error && error.message) || 'unknown error'}`,
        };
      }

      this._cliProbeCache.delete(context.repoKey);
      const finalized = this._finalizeSyncAttempt(context, trigger, lease, {
        state: remoteResult.conflictCount > 0 ? 'conflict' : 'success',
        appliedCount: remoteResult.appliedCount,
        deletedCount: remoteResult.deletedCount,
        skippedCount: remoteResult.skippedCount,
        conflictCount: remoteResult.conflictCount,
        conflicts: remoteResult.conflicts,
        cursor: remoteResult.cursor,
        message: remoteResult.message,
        reason: remoteResult.conflictCount > 0 ? 'conflict_detected' : undefined,
        lastError: remoteResult.conflictCount > 0 ? remoteResult.message : undefined,
      });

      return {
        ...finalized,
        cliManualCommand: cliManualResult ? {
          exitCode: cliManualResult.exitCode,
          durationMs: cliManualResult.durationMs,
        } : null,
      };
    } catch (error) {
      const conflicts = Array.isArray(error && error.conflicts) ? error.conflicts : [];
      const appliedCount = Number.isFinite(error && error.appliedCount) ? error.appliedCount : 0;
      const deletedCount = Number.isFinite(error && error.deletedCount) ? error.deletedCount : 0;
      const skippedCount = Number.isFinite(error && error.skippedCount) ? error.skippedCount : 0;
      const cursor = normalizeString(error && error.cursor) || undefined;
      const state = error && error.code === 'obsidian_sync_conflict' ? 'conflict' : 'error';
      const message = normalizeString(error && error.message) || 'Obsidian sync failed.';
      return this._finalizeSyncAttempt(context, trigger, lease, {
        state,
        appliedCount,
        deletedCount,
        skippedCount,
        conflictCount: conflicts.length,
        conflicts,
        cursor,
        message,
        reason: normalizeString(error && error.code) || undefined,
        lastError: message,
      });
    }
  }
}

function createObsidianSyncService(deps = {}) {
  return new ObsidianSyncService(deps);
}

module.exports = {
  ObsidianSyncService,
  createObsidianSyncService,
};
