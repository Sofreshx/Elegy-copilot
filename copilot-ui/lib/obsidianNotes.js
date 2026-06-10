'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_OBSIDIAN_CONFIG_FILENAME = 'obsidian-planning.json';
const DEFAULT_NOTES_PATH_TEMPLATE = 'Planning/{repoId}';
const DEFAULT_OBSIDIAN_REMOTE_POLL_INTERVAL_MS = 60_000;
const DEFAULT_OBSIDIAN_SYNC_TIMEOUT_MS = 15_000;
const OBSIDIAN_NOTE_ID_PREFIX = 'obsnote';
const OBSIDIAN_PLANNING_REPRESENTATION_KIND = 'planning-obsidian-representation';
const OBSIDIAN_TOOL_MANAGED_ROOT = '_instruction-engine';
const OBSIDIAN_PLANNING_MIRROR_DIRECTORY = '_instruction-engine/planning-mirrors';

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => normalizeString(entry))
    .filter(Boolean);
}

function normalizeRelativePath(value, fallback = '') {
  const raw = normalizeString(value).replace(/\\/g, '/');
  if (!raw) {
    return fallback;
  }

  const segments = raw
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0 && segment !== '.');

  if (segments.some((segment) => segment === '..')) {
    throw new Error('Obsidian notesPathTemplate must not contain parent-directory traversal');
  }

  return segments.join('/');
}

function hasPathPrefix(notePath, prefix) {
  const normalizedPath = normalizeRelativePath(notePath, '');
  const normalizedPrefix = normalizeRelativePath(prefix, '');
  if (!normalizedPath || !normalizedPrefix) {
    return false;
  }
  return normalizedPath === normalizedPrefix || normalizedPath.startsWith(`${normalizedPrefix}/`);
}

function isPlanningMirrorNotePath(notePath) {
  return hasPathPrefix(notePath, OBSIDIAN_PLANNING_MIRROR_DIRECTORY);
}

function isToolManagedNotePath(notePath) {
  return hasPathPrefix(notePath, OBSIDIAN_TOOL_MANAGED_ROOT);
}

function normalizeCommand(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => normalizeString(entry))
    .filter(Boolean);
}

function normalizePositiveInteger(value, fallback) {
  const numeric = Number.parseInt(String(value || '').trim(), 10);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function slugifySegment(value, fallback) {
  const normalized = normalizeString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

function buildConfigPath(options = {}) {
  const configuredPath = normalizeString(
    options.process
    && options.process.env
    && (options.process.env.IE_OBSIDIAN_CONFIG_PATH || options.process.env.INSTRUCTION_ENGINE_OBSIDIAN_CONFIG_PATH)
  );

  if (configuredPath) {
    return path.resolve(configuredPath);
  }

  return path.join(path.resolve(options.elegyHomeAbs || options.elegyHome || '.'), DEFAULT_OBSIDIAN_CONFIG_FILENAME);
}

function readConfigFile(configPath) {
  if (!fs.existsSync(configPath)) {
    return { exists: false, value: {} };
  }

  const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Obsidian planning config must be a JSON object');
  }

  return { exists: true, value: parsed };
}

function resolveObsidianConfig(options = {}) {
  const configPath = buildConfigPath(options);
  const { exists, value } = readConfigFile(configPath);
  const env = options.process && options.process.env ? options.process.env : {};
  const vaultPath = normalizeString(env.IE_OBSIDIAN_VAULT_PATH || env.INSTRUCTION_ENGINE_OBSIDIAN_VAULT_PATH || value.vaultPath);
  const notesPathTemplate = normalizeRelativePath(
    env.IE_OBSIDIAN_NOTES_PATH_TEMPLATE
    || env.INSTRUCTION_ENGINE_OBSIDIAN_NOTES_PATH_TEMPLATE
    || value.notesPathTemplate,
    DEFAULT_NOTES_PATH_TEMPLATE,
  ) || DEFAULT_NOTES_PATH_TEMPLATE;
  const cliPath = normalizeString(env.IE_OBSIDIAN_CLI_PATH || env.INSTRUCTION_ENGINE_OBSIDIAN_CLI_PATH || value.cliPath);
  const cliCommands = value && typeof value.cliCommands === 'object' && !Array.isArray(value.cliCommands)
    ? value.cliCommands
    : {};
  const manualSyncCommand = normalizeCommand(
    cliCommands.manualSync
    || cliCommands.manualSyncCommand
    || value.syncCommand
  );
  const remoteSyncPollIntervalMs = normalizePositiveInteger(
    env.IE_OBSIDIAN_REMOTE_SYNC_POLL_INTERVAL_MS
    || value.remoteSyncPollIntervalMs,
    DEFAULT_OBSIDIAN_REMOTE_POLL_INTERVAL_MS,
  );
  const remoteSyncTimeoutMs = normalizePositiveInteger(
    env.IE_OBSIDIAN_REMOTE_SYNC_TIMEOUT_MS
    || value.remoteSyncTimeoutMs,
    DEFAULT_OBSIDIAN_SYNC_TIMEOUT_MS,
  );

  return {
    configPath,
    exists,
    vaultPath,
    notesPathTemplate,
    cliPath,
    cliCommands: {
      probe: normalizeCommand(cliCommands.probe || cliCommands.probeCommand),
      refreshInventory: normalizeCommand(cliCommands.refreshInventory || cliCommands.refreshInventoryCommand),
      syncStatus: normalizeCommand(cliCommands.syncStatus || cliCommands.syncStatusCommand),
      manualSync: manualSyncCommand,
    },
    syncCommand: manualSyncCommand,
    remoteSyncUrl: normalizeString(env.IE_OBSIDIAN_REMOTE_SYNC_URL || value.remoteSyncUrl),
    remoteSyncPollIntervalMs,
    remoteSyncTimeoutMs,
    remoteSyncAuthTokenEnv: normalizeString(
      env.IE_OBSIDIAN_REMOTE_SYNC_TOKEN_ENV
      || value.remoteSyncAuthTokenEnv
    ),
  };
}

function resolveNotesDirectory(config, repo) {
  const repoId = slugifySegment(repo && repo.repoId, 'selected-repo');
  const repoLabel = slugifySegment(repo && repo.repoLabel, repoId);
  const relative = normalizeRelativePath(
    String(config.notesPathTemplate || DEFAULT_NOTES_PATH_TEMPLATE)
      .replace(/\{repoId\}/g, repoId)
      .replace(/\{repoLabel\}/g, repoLabel),
    DEFAULT_NOTES_PATH_TEMPLATE.replace('{repoId}', repoId),
  );
  return {
    relative,
    absolute: path.join(path.resolve(config.vaultPath || '.'), ...relative.split('/')),
  };
}

function buildCliStatus(config, cliStatus) {
  const fallback = {
    state: config.cliPath || config.cliCommands.probe.length > 0 || config.cliCommands.syncStatus.length > 0 || config.cliCommands.refreshInventory.length > 0 || config.cliCommands.manualSync.length > 0
      ? 'configured'
      : 'not-configured',
    message: config.cliPath || config.cliCommands.manualSync.length > 0
      ? 'Obsidian CLI commands are configured.'
      : 'No Obsidian CLI command contract is configured.',
    checkedAt: undefined,
    probeConfigured: config.cliCommands.probe.length > 0,
    syncStatusConfigured: config.cliCommands.syncStatus.length > 0,
    refreshInventoryConfigured: config.cliCommands.refreshInventory.length > 0,
    manualSyncConfigured: config.cliCommands.manualSync.length > 0,
    lastError: undefined,
  };

  if (!cliStatus || typeof cliStatus !== 'object') {
    return fallback;
  }

  return {
    ...fallback,
    ...cliStatus,
    checkedAt: normalizeString(cliStatus.checkedAt) || fallback.checkedAt,
    lastError: normalizeString(cliStatus.lastError) || undefined,
  };
}

function buildRemoteSyncStatus(config, remoteSyncStatus) {
  const configured = Boolean(config.vaultPath && config.remoteSyncUrl);
  const fallback = {
    state: configured ? 'idle' : 'disabled',
    configured,
    pollEnabled: configured,
    pollIntervalMs: configured ? config.remoteSyncPollIntervalMs : undefined,
    message: configured
      ? 'Remote pull sync is configured and waiting for the next poll.'
      : 'Remote pull sync is not configured.',
    lastAttemptAt: undefined,
    lastSuccessAt: undefined,
    lastManualSyncAt: undefined,
    lastError: undefined,
    conflictCount: 0,
    appliedCount: 0,
    deletedCount: 0,
    skippedCount: 0,
    cursor: undefined,
    reason: undefined,
    nextAttemptAt: undefined,
    cooldownUntil: undefined,
    retryCount: 0,
    retryLimit: undefined,
    lastFailureAt: undefined,
    lastFailureReason: undefined,
    leaseAcquiredAt: undefined,
    leaseExpiresAt: undefined,
    leaseTrigger: undefined,
    lastStaleLeaseRecoveredAt: undefined,
    updatedAt: undefined,
    syncing: false,
  };

  if (!configured) {
    return fallback;
  }

  if (!remoteSyncStatus || typeof remoteSyncStatus !== 'object') {
    return fallback;
  }

  return {
    ...fallback,
    ...remoteSyncStatus,
    configured: fallback.configured,
    pollEnabled: fallback.pollEnabled,
    pollIntervalMs: Number.isFinite(remoteSyncStatus.pollIntervalMs) ? remoteSyncStatus.pollIntervalMs : fallback.pollIntervalMs,
    message: normalizeString(remoteSyncStatus.message) || fallback.message,
    lastAttemptAt: normalizeString(remoteSyncStatus.lastAttemptAt) || undefined,
    lastSuccessAt: normalizeString(remoteSyncStatus.lastSuccessAt) || undefined,
    lastManualSyncAt: normalizeString(remoteSyncStatus.lastManualSyncAt) || undefined,
    lastError: normalizeString(remoteSyncStatus.lastError) || undefined,
    cursor: normalizeString(remoteSyncStatus.cursor) || undefined,
    reason: normalizeString(remoteSyncStatus.reason) || undefined,
    nextAttemptAt: normalizeString(remoteSyncStatus.nextAttemptAt) || undefined,
    cooldownUntil: normalizeString(remoteSyncStatus.cooldownUntil) || undefined,
    retryCount: Number.isFinite(remoteSyncStatus.retryCount) ? remoteSyncStatus.retryCount : fallback.retryCount,
    retryLimit: Number.isFinite(remoteSyncStatus.retryLimit) ? remoteSyncStatus.retryLimit : fallback.retryLimit,
    lastFailureAt: normalizeString(remoteSyncStatus.lastFailureAt) || undefined,
    lastFailureReason: normalizeString(remoteSyncStatus.lastFailureReason) || undefined,
    leaseAcquiredAt: normalizeString(remoteSyncStatus.leaseAcquiredAt) || undefined,
    leaseExpiresAt: normalizeString(remoteSyncStatus.leaseExpiresAt) || undefined,
    leaseTrigger: normalizeString(remoteSyncStatus.leaseTrigger) || undefined,
    lastStaleLeaseRecoveredAt: normalizeString(remoteSyncStatus.lastStaleLeaseRecoveredAt) || undefined,
    updatedAt: normalizeString(remoteSyncStatus.updatedAt) || undefined,
    conflictCount: Number.isFinite(remoteSyncStatus.conflictCount) ? remoteSyncStatus.conflictCount : fallback.conflictCount,
    appliedCount: Number.isFinite(remoteSyncStatus.appliedCount) ? remoteSyncStatus.appliedCount : fallback.appliedCount,
    deletedCount: Number.isFinite(remoteSyncStatus.deletedCount) ? remoteSyncStatus.deletedCount : fallback.deletedCount,
    skippedCount: Number.isFinite(remoteSyncStatus.skippedCount) ? remoteSyncStatus.skippedCount : fallback.skippedCount,
    syncing: remoteSyncStatus.syncing === true,
  };
}

function buildSourceResolutionStatus(sourceResolution) {
  const record = sourceResolution && typeof sourceResolution === 'object' ? sourceResolution : {};
  const availableSources = Array.isArray(record.availableSources)
    ? record.availableSources
      .map((entry) => ({
        id: normalizeString(entry && entry.id),
        provider: normalizeString(entry && entry.provider),
        host: normalizeString(entry && entry.host),
        owner: normalizeString(entry && entry.owner),
        repo: normalizeString(entry && entry.repo),
        branch: normalizeString(entry && entry.branch),
        notesPath: normalizeString(entry && entry.notesPath),
      }))
      .filter((entry) => entry.id && entry.provider && entry.host && entry.owner && entry.repo && entry.branch && entry.notesPath)
    : [];
  const effectiveSource = record.effectiveSource && typeof record.effectiveSource === 'object'
    ? availableSources.find((entry) => entry.id === normalizeString(record.effectiveSource.id)) || null
    : null;

  return {
    availableSources,
    activeSourceConfigured: record.activeSourceConfigured === true,
    activeSourceId: normalizeString(record.activeSourceId) || undefined,
    activeSourceMatched: record.activeSourceMatched === true,
    effectiveSource,
    requiresSource: record.requiresSource === true,
    resolved: record.resolved === true,
    reason: normalizeString(record.reason) || undefined,
    message: normalizeString(record.message)
      || (effectiveSource
        ? 'A synced-note source is resolved for the selected repo.'
        : 'No synced-note source is resolved for the selected repo.'),
  };
}

function resolveSyncAvailability(config, sourceResolution) {
  if (!config.vaultPath) {
    return false;
  }

  if (sourceResolution && sourceResolution.requiresSource && !sourceResolution.effectiveSource) {
    return false;
  }

  return Boolean(
    config.remoteSyncUrl
    || config.cliCommands.manualSync.length > 0
  );
}

function withStatusExtensions(baseStatus, config, annotations = {}) {
  const sourceResolution = buildSourceResolutionStatus(annotations.sourceResolution);
  return {
    ...baseStatus,
    syncAvailable: resolveSyncAvailability(config, sourceResolution),
    cli: buildCliStatus(config, annotations.cli),
    remoteSync: buildRemoteSyncStatus(config, annotations.remoteSync),
    sourceResolution,
  };
}

function resolveObsidianStatus(options = {}, annotations = {}) {
  const repo = options.repo || null;
  const config = resolveObsidianConfig(options);
  const configured = Boolean(
    config.exists
    || config.vaultPath
    || config.cliPath
    || config.cliCommands.probe.length > 0
    || config.cliCommands.syncStatus.length > 0
    || config.cliCommands.refreshInventory.length > 0
    || config.cliCommands.manualSync.length > 0
    || config.remoteSyncUrl
  );

  if (!config.vaultPath) {
    return withStatusExtensions({
      state: 'not-configured',
      configured,
      readAvailable: false,
      syncAvailable: false,
      external: true,
      canonicalAuthority: false,
      code: 'obsidian_not_configured',
      message: `External Obsidian notes are not configured. Add ${DEFAULT_OBSIDIAN_CONFIG_FILENAME} or IE_OBSIDIAN_VAULT_PATH to enable the non-canonical note surface.`,
      configPath: config.configPath,
      notesPathTemplate: config.notesPathTemplate,
      cliPath: config.cliPath || undefined,
      syncCommand: config.syncCommand.length > 0 ? config.syncCommand : undefined,
    }, config, annotations);
  }

  const vaultPath = path.resolve(config.vaultPath);
  const vaultName = path.basename(vaultPath);

  if (!fs.existsSync(vaultPath) || !fs.statSync(vaultPath).isDirectory()) {
    return withStatusExtensions({
      state: 'vault-unavailable',
      configured: true,
      readAvailable: false,
      syncAvailable: false,
      external: true,
      canonicalAuthority: false,
      code: 'obsidian_vault_unavailable',
      message: 'External Obsidian vault path is configured but unavailable.',
      configPath: config.configPath,
      vaultName,
      vaultPath,
      notesPathTemplate: config.notesPathTemplate,
      cliPath: config.cliPath || undefined,
      syncCommand: config.syncCommand.length > 0 ? config.syncCommand : undefined,
    }, config, annotations);
  }

  const notesDirectory = resolveNotesDirectory(config, repo);
  if (!fs.existsSync(notesDirectory.absolute) || !fs.statSync(notesDirectory.absolute).isDirectory()) {
    return withStatusExtensions({
      state: 'notes-unavailable',
      configured: true,
      readAvailable: false,
      syncAvailable: resolveSyncAvailability(config),
      external: true,
      canonicalAuthority: false,
      code: 'obsidian_notes_unavailable',
      message: 'External Obsidian notes folder is configured for the selected Catalog repo but not present yet.',
      configPath: config.configPath,
      vaultName,
      vaultPath,
      notesPathTemplate: config.notesPathTemplate,
      notesDirectoryPath: notesDirectory.absolute,
      cliPath: config.cliPath || undefined,
      syncCommand: config.syncCommand.length > 0 ? config.syncCommand : undefined,
    }, config, annotations);
  }

  return withStatusExtensions({
    state: 'ready',
    configured: true,
    readAvailable: true,
    syncAvailable: resolveSyncAvailability(config),
    external: true,
    canonicalAuthority: false,
    message: 'External Obsidian notes are available for the selected Catalog repo. Repo docs and session plan.md remain canonical.',
    configPath: config.configPath,
    vaultName,
    vaultPath,
    notesPathTemplate: config.notesPathTemplate,
    notesDirectoryPath: notesDirectory.absolute,
    cliPath: config.cliPath || undefined,
    syncCommand: config.syncCommand.length > 0 ? config.syncCommand : undefined,
  }, config, annotations);
}

function listMarkdownFiles(rootDirectory) {
  const results = [];
  const pending = [rootDirectory];

  while (pending.length > 0) {
    const current = pending.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true })
      .slice()
      .sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(absolutePath);
        continue;
      }
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        results.push(absolutePath);
      }
    }
  }

  return results.sort((left, right) => left.localeCompare(right));
}

function stripFrontmatter(content) {
  const normalized = String(content || '').replace(/\r\n?/g, '\n');
  if (!normalized.startsWith('---\n')) {
    return normalized;
  }
  const endIndex = normalized.indexOf('\n---\n', 4);
  return endIndex >= 0 ? normalized.slice(endIndex + 5) : normalized;
}

function parseFrontmatterAttributes(content) {
  const normalized = String(content || '').replace(/\r\n?/g, '\n');
  if (!normalized.startsWith('---\n')) {
    return {};
  }
  const endIndex = normalized.indexOf('\n---\n', 4);
  if (endIndex < 0) {
    return {};
  }

  const attributes = {};
  normalized.slice(4, endIndex).split('\n').forEach((line) => {
    const separatorIndex = line.indexOf(':');
    if (separatorIndex <= 0) {
      return;
    }
    const key = normalizeString(line.slice(0, separatorIndex));
    const value = normalizeString(line.slice(separatorIndex + 1));
    if (key) {
      attributes[key] = value;
    }
  });
  return attributes;
}

function isPlanningRepresentationContent(content) {
  return normalizeString(parseFrontmatterAttributes(content).ie_kind) === OBSIDIAN_PLANNING_REPRESENTATION_KIND;
}

function deriveNoteTitle(content, fallbackTitle) {
  const normalized = stripFrontmatter(content);
  const heading = normalized
    .split('\n')
    .map((line) => line.trim())
    .find((line) => /^#\s+/.test(line));
  return heading ? heading.replace(/^#\s+/, '').trim() : fallbackTitle;
}

function deriveNoteSummary(content) {
  const normalized = stripFrontmatter(content);
  const line = normalized
    .split('\n')
    .map((entry) => entry.trim())
    .find((entry) => entry && !entry.startsWith('#') && !entry.startsWith('>') && !entry.startsWith('```'));
  return line || 'External Obsidian planning context.';
}

function deriveHeadings(content) {
  return stripFrontmatter(content)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^#{1,6}\s+/.test(line))
    .map((line) => line.replace(/^#{1,6}\s+/, '').trim());
}

function deriveObsidianNoteId(input) {
  const repoId = normalizeString(input.repoId) || '_';
  const vaultName = normalizeString(input.vaultName) || 'vault';
  const notePath = normalizeRelativePath(input.notePath, 'note.md');
  return `${OBSIDIAN_NOTE_ID_PREFIX}_${
    crypto.createHash('sha256').update([
      'provider=obsidian',
      `repoId=${repoId}`,
      `vaultName=${vaultName}`,
      `notePath=${notePath}`,
    ].join('\n'), 'utf8').digest('hex').slice(0, 32)
  }`;
}

function hashContent(content) {
  return crypto.createHash('sha256').update(String(content || ''), 'utf8').digest('hex');
}

function buildNoteSummary(filePath, repo, status, contentInput) {
  const content = typeof contentInput === 'string' ? contentInput : fs.readFileSync(filePath, 'utf8');
  const relativeToVault = path.relative(status.vaultPath, filePath).replace(/\\/g, '/');
  const titleFallback = path.basename(filePath, path.extname(filePath));
  const stat = fs.statSync(filePath);

  return {
    kind: 'synced-note',
    provider: 'obsidian',
    id: deriveObsidianNoteId({
      repoId: repo && repo.repoId,
      vaultName: status.vaultName,
      notePath: relativeToVault,
    }),
    title: deriveNoteTitle(content, titleFallback),
    summary: deriveNoteSummary(content),
    repoId: normalizeString(repo && repo.repoId) || undefined,
    targetRepoIds: normalizeString(repo && repo.repoId) ? [repo.repoId] : [],
    vaultName: status.vaultName,
    notePath: relativeToVault,
    filePath,
    lastModifiedAt: stat.mtime.toISOString(),
    contentHash: hashContent(content),
    external: true,
    canonicalAuthority: false,
  };
}

function resolveNotePathRelativeToNotesDirectory(status, filePath) {
  if (!status || !status.notesDirectoryPath || !filePath) {
    return '';
  }
  return normalizeRelativePath(path.relative(status.notesDirectoryPath, filePath).replace(/\\/g, '/'), '');
}

function listLocalObsidianNotes(options = {}, explicitStatus) {
  const status = explicitStatus || resolveObsidianStatus(options);
  if (!status.readAvailable) {
    return { status, notes: [] };
  }

  const files = listMarkdownFiles(status.notesDirectoryPath);
  const notes = files
    .map((filePath) => {
      const notePathRelativeToNotesDirectory = resolveNotePathRelativeToNotesDirectory(status, filePath);
      if (isPlanningMirrorNotePath(notePathRelativeToNotesDirectory)) {
        return null;
      }
      const content = fs.readFileSync(filePath, 'utf8');
      if (isPlanningRepresentationContent(content)) {
        return null;
      }
      return buildNoteSummary(filePath, options.repo, status, content);
    })
    .filter(Boolean);
  return { status, notes };
}

function readLocalObsidianNote(options = {}, noteId, explicitStatus) {
  const { status, notes } = listLocalObsidianNotes(options, explicitStatus);
  if (!status.readAvailable) {
    return { status, note: null };
  }

  const summary = notes.find((entry) => entry.id === normalizeString(noteId));
  if (!summary) {
    return { status, note: null };
  }

  const content = fs.readFileSync(summary.filePath, 'utf8');
  return {
    status,
    note: {
      ...summary,
      content,
      headings: deriveHeadings(content),
    },
  };
}

module.exports = {
  DEFAULT_OBSIDIAN_CONFIG_FILENAME,
  DEFAULT_NOTES_PATH_TEMPLATE,
  DEFAULT_OBSIDIAN_REMOTE_POLL_INTERVAL_MS,
  DEFAULT_OBSIDIAN_SYNC_TIMEOUT_MS,
  OBSIDIAN_NOTE_ID_PREFIX,
  OBSIDIAN_TOOL_MANAGED_ROOT,
  OBSIDIAN_PLANNING_MIRROR_DIRECTORY,
  normalizeRelativePath,
  resolveObsidianConfig,
  resolveNotesDirectory,
  resolveObsidianStatus,
  deriveObsidianNoteId,
  hashContent,
  hasPathPrefix,
  isPlanningMirrorNotePath,
  isToolManagedNotePath,
  parseFrontmatterAttributes,
  isPlanningRepresentationContent,
  listObsidianNotes: listLocalObsidianNotes,
  listLocalObsidianNotes,
  readObsidianNote: readLocalObsidianNote,
  readLocalObsidianNote,
  buildSourceResolutionStatus,
};
