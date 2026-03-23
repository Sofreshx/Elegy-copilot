'use strict';

const obsidianCli = require('./obsidianCli');
const obsidianNotes = require('./obsidianNotes');
const obsidianRemoteSync = require('./obsidianRemoteSync');

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

class ObsidianSyncService {
  constructor(deps = {}) {
    this._obsidianNotes = deps.obsidianNotes || obsidianNotes;
    this._obsidianCli = deps.obsidianCli || obsidianCli;
    this._obsidianRemoteSync = deps.obsidianRemoteSync || obsidianRemoteSync;
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
    const state = this._obsidianRemoteSync.readRepoSyncState({
      copilotHomeAbs: context.copilotHomeAbs,
      repo: context.repo,
      config: context.config,
    });
    return state.summary;
  }

  async _buildStatus(context, options = {}) {
    const cli = await this._probeCli(context, options.forceCliProbe === true);
    const remoteSync = this._readRemoteSyncStatus(context);
    return this._obsidianNotes.resolveObsidianStatus({
      ...context,
      process: this._process,
    }, {
      cli,
      remoteSync,
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
        active.timer = this._setTimeout(run, latestContext.config.remoteSyncPollIntervalMs);
        if (active.timer && typeof active.timer.unref === 'function') {
          active.timer.unref();
        }
      }
    };

    const timer = this._setTimeout(run, Math.min(context.config.remoteSyncPollIntervalMs, 1_000));
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

    const promise = this._runSync(context, trigger)
      .finally(() => {
        this._syncInflight.delete(context.repoKey);
      });
    this._syncInflight.set(context.repoKey, promise);
    return promise;
  }

  async _runSync(context, trigger) {
    const startedAt = new Date().toISOString();
    this._obsidianRemoteSync.persistRepoSummary({
      copilotHomeAbs: context.copilotHomeAbs,
      repo: context.repo,
      config: context.config,
      summaryPatch: {
        state: 'syncing',
        syncing: true,
        lastAttemptAt: startedAt,
        message: trigger === 'manual'
          ? 'Manual Obsidian sync is running.'
          : 'Timer-based Obsidian sync poll is running.',
      },
    });

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
      this._obsidianRemoteSync.persistRepoSummary({
        copilotHomeAbs: context.copilotHomeAbs,
        repo: context.repo,
        config: context.config,
        summaryPatch: {
          state: remoteResult.conflictCount > 0 ? 'conflict' : 'success',
          syncing: false,
          lastSuccessAt: remoteResult.conflictCount > 0 ? undefined : new Date().toISOString(),
          lastManualSyncAt: trigger === 'manual' ? new Date().toISOString() : undefined,
          appliedCount: remoteResult.appliedCount,
          deletedCount: remoteResult.deletedCount,
          skippedCount: remoteResult.skippedCount,
          conflictCount: remoteResult.conflictCount,
          cursor: remoteResult.cursor,
          lastError: remoteResult.conflictCount > 0 ? 'conflict_detected' : undefined,
          message: remoteResult.message,
        },
      });

      return {
        trigger,
        ...remoteResult,
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
      this._obsidianRemoteSync.persistRepoSummary({
        copilotHomeAbs: context.copilotHomeAbs,
        repo: context.repo,
        config: context.config,
        summaryPatch: {
          state,
          syncing: false,
          lastManualSyncAt: trigger === 'manual' ? new Date().toISOString() : undefined,
          appliedCount,
          deletedCount,
          skippedCount,
          conflictCount: conflicts.length,
          cursor,
          lastError: message,
          message,
        },
      });
      return {
        trigger,
        state,
        appliedCount,
        deletedCount,
        skippedCount,
        conflictCount: conflicts.length,
        conflicts,
        cursor,
        message,
      };
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
