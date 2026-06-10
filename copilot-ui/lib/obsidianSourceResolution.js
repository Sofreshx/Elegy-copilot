'use strict';

const {
  canonicalizeSyncedNoteSourceLocator,
  normalizeSyncedNoteSourceId,
} = require('@elegy-copilot/contracts');

const obsidianRemoteSync = require('./obsidianRemoteSync');

const OBSIDIAN_SOURCE_FIELDS = ['sourceId', 'provider', 'host', 'owner', 'repo', 'branch', 'notesPath'];

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function buildError(message, statusCode, code) {
  return Object.assign(new Error(message), {
    statusCode,
    code,
    reason: code,
  });
}

function normalizeTrackerSourceRecord(value) {
  try {
    const id = normalizeSyncedNoteSourceId(value && value.id);
    const locator = canonicalizeSyncedNoteSourceLocator(value);
    return {
      id,
      provider: locator.provider,
      host: locator.host,
      owner: locator.owner,
      repo: locator.repo,
      branch: locator.branch,
      notesPath: locator.notesPath,
    };
  } catch {
    return null;
  }
}

function normalizeTrackerSourceList(value) {
  const deduped = new Map();
  for (const entry of Array.isArray(value) ? value : []) {
    const normalized = normalizeTrackerSourceRecord(entry);
    if (normalized && !deduped.has(normalized.id)) {
      deduped.set(normalized.id, normalized);
    }
  }
  return Array.from(deduped.values()).sort((left, right) => left.id.localeCompare(right.id));
}

function buildTrackerUnavailableResult(message, code = 'tracker_synced_note_sources_unavailable') {
  return {
    sources: [],
    error: {
      code,
      message,
    },
  };
}

function buildExplicitSelectionRequiredResult(availableSources, requiresSource) {
  const hasSingleSource = availableSources.length === 1;
  return {
    availableSources,
    activeSourceConfigured: false,
    activeSourceId: undefined,
    activeSourceMatched: false,
    effectiveSource: null,
    requiresSource,
    resolved: false,
    reason: 'explicit_source_selection_required',
    message: hasSingleSource
      ? 'A tracker synced-note source is available, but this repo must explicitly select it before an effective source is resolved.'
      : 'Tracker synced-note sources are available, but this repo must explicitly select one before an effective source is resolved.',
  };
}

function remoteSyncUrlRequiresSource(remoteSyncUrl) {
  const normalized = normalizeString(remoteSyncUrl);
  if (!normalized) {
    return false;
  }
  return OBSIDIAN_SOURCE_FIELDS.some((field) => normalized.includes(`{${field}}`));
}

class ObsidianSourceResolver {
  constructor(deps = {}) {
    this._obsidianRemoteSync = deps.obsidianRemoteSync || obsidianRemoteSync;
    this._fetch = deps.fetch || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    this._trackerUrl = normalizeString(deps.trackerUrl);
    this._trackerToken = normalizeString(deps.trackerToken);
    this._listTrackerSyncedNoteSources =
      typeof deps.listTrackerSyncedNoteSources === 'function'
        ? deps.listTrackerSyncedNoteSources
        : null;
  }

  _readPersistedSelection(options = {}) {
    const state = this._obsidianRemoteSync.readRepoSyncState({
      elegyHomeAbs: options.elegyHomeAbs,
      repo: options.repo,
      config: options.config,
    });
    const record = state && state.sourceSelection && typeof state.sourceSelection === 'object'
      ? state.sourceSelection
      : {};

    let activeSourceId = '';
    try {
      activeSourceId = record.activeSourceId ? normalizeSyncedNoteSourceId(record.activeSourceId) : '';
    } catch {
      activeSourceId = '';
    }

    return {
      activeSourceId,
      updatedAt: normalizeString(record.updatedAt) || undefined,
    };
  }

  _writePersistedSelection(options = {}, activeSourceId = '') {
    const current = this._obsidianRemoteSync.readRepoSyncState({
      elegyHomeAbs: options.elegyHomeAbs,
      repo: options.repo,
      config: options.config,
    });
    const nextState = {
      ...current,
    };

    if (activeSourceId) {
      nextState.sourceSelection = {
        activeSourceId,
        updatedAt: new Date().toISOString(),
      };
    } else {
      delete nextState.sourceSelection;
    }

    this._obsidianRemoteSync.writeRepoSyncState({
      elegyHomeAbs: options.elegyHomeAbs,
      repo: options.repo,
      state: nextState,
    });
  }

  async _loadTrackerSources(options = {}) {
    if (this._listTrackerSyncedNoteSources) {
      try {
        const payload = await this._listTrackerSyncedNoteSources(options);
        return {
          sources: normalizeTrackerSourceList(payload),
          error: null,
        };
      } catch (error) {
        return buildTrackerUnavailableResult(
          normalizeString(error && error.message) || 'Tracker synced-note source registry is unavailable.',
        );
      }
    }

    if (!this._trackerUrl || !this._trackerToken) {
      return buildTrackerUnavailableResult(
        'Tracker synced-note source registry is unavailable because tracker access is not configured.',
      );
    }

    if (!this._fetch) {
      return buildTrackerUnavailableResult(
        'Tracker synced-note source registry is unavailable because fetch is not configured.',
      );
    }

    try {
      const response = await this._fetch(new URL('/api/synced-notes/sources', this._trackerUrl).toString(), {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${this._trackerToken}`,
        },
      });

      if (!response.ok) {
        return buildTrackerUnavailableResult(
          `Tracker synced-note source registry is unavailable (HTTP ${response.status}).`,
        );
      }

      const payload = await response.json();
      if (!Array.isArray(payload)) {
        return buildTrackerUnavailableResult(
          'Tracker synced-note source registry returned an invalid payload.',
        );
      }

      return {
        sources: normalizeTrackerSourceList(payload),
        error: null,
      };
    } catch (error) {
      return buildTrackerUnavailableResult(
        normalizeString(error && error.message) || 'Tracker synced-note source registry is unavailable.',
      );
    }
  }

  async resolveSourceSelection(options = {}) {
    const selection = this._readPersistedSelection(options);
    const tracker = await this._loadTrackerSources(options);
    const availableSources = tracker.sources;
    const effectiveFromActive = selection.activeSourceId
      ? availableSources.find((entry) => entry.id === selection.activeSourceId) || null
      : null;
    const requiresSource = remoteSyncUrlRequiresSource(options.config && options.config.remoteSyncUrl);
    const activeSourceConfigured = Boolean(selection.activeSourceId);

    if (tracker.error) {
      return {
        availableSources,
        activeSourceConfigured,
        activeSourceId: selection.activeSourceId || undefined,
        activeSourceMatched: false,
        effectiveSource: null,
        requiresSource,
        resolved: false,
        reason: tracker.error.code,
        message: tracker.error.message,
      };
    }

    if (effectiveFromActive) {
      return {
        availableSources,
        activeSourceConfigured,
        activeSourceId: selection.activeSourceId || undefined,
        activeSourceMatched: true,
        effectiveSource: effectiveFromActive,
        requiresSource,
        resolved: true,
        reason: 'active_source_selected',
        message: 'Using the tracker synced-note source selected for this repo.',
      };
    }

    if (activeSourceConfigured) {
      return {
        availableSources,
        activeSourceConfigured,
        activeSourceId: selection.activeSourceId || undefined,
        activeSourceMatched: false,
        effectiveSource: null,
        requiresSource,
        resolved: false,
        reason: 'active_source_missing',
        message: 'The persisted synced-note source selection no longer exists in tracker.',
      };
    }

    if (availableSources.length === 0) {
      return {
        availableSources,
        activeSourceConfigured: false,
        activeSourceId: undefined,
        activeSourceMatched: false,
        effectiveSource: null,
        requiresSource,
        resolved: false,
        reason: 'no_tracker_sources',
        message: 'No tracker synced-note sources are available for this repo.',
      };
    }

    return buildExplicitSelectionRequiredResult(availableSources, requiresSource);
  }

  async setActiveSourceSelection(options = {}, sourceId) {
    const normalizedSourceId = normalizeString(sourceId);
    if (!normalizedSourceId) {
      this._writePersistedSelection(options, '');
      return this.resolveSourceSelection(options);
    }

    let safeSourceId;
    try {
      safeSourceId = normalizeSyncedNoteSourceId(normalizedSourceId);
    } catch (error) {
      throw buildError(
        normalizeString(error && error.message) || 'Invalid synced-note source id',
        400,
        normalizeString(error && error.code) || 'invalid_synced_note_source_id',
      );
    }

    const tracker = await this._loadTrackerSources(options);
    if (tracker.error) {
      throw buildError(
        'Tracker synced-note source registry is unavailable; cannot validate the requested active source selection.',
        502,
        tracker.error.code,
      );
    }

    if (!tracker.sources.some((entry) => entry.id === safeSourceId)) {
      throw buildError(
        'Requested synced-note source is not present in the tracker registry.',
        409,
        'obsidian_synced_note_source_not_found',
      );
    }

    this._writePersistedSelection(options, safeSourceId);
    return this.resolveSourceSelection(options);
  }
}

function createObsidianSourceResolver(deps = {}) {
  return new ObsidianSourceResolver(deps);
}

module.exports = {
  OBSIDIAN_SOURCE_FIELDS,
  ObsidianSourceResolver,
  createObsidianSourceResolver,
  remoteSyncUrlRequiresSource,
};