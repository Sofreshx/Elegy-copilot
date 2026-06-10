'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const sessionAggregationLib = require('./sessionAggregation');
const { GLOBAL_HARNESSES } = require('./harnessCatalog');

const DEFAULT_OPENCODE_DATA_HOME = path.join(os.homedir(), '.local', 'share', 'opencode');
const OPENCODE_LOG_DIR = 'log';
const OPENCODE_PROJECT_STATE_DIR = 'project';
const OPENCODE_PLUGIN_STATE_DIR = 'plugins/worktree';
const SESSION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{4,}$/;

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function parseTime(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function safeStat(targetPath, fsImpl = fs) {
  try {
    return fsImpl.statSync(targetPath);
  } catch {
    return null;
  }
}

function safeReadDir(targetPath, fsImpl = fs) {
  try {
    return fsImpl.readdirSync(targetPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

function safeReadText(targetPath, fsImpl = fs) {
  try {
    return fsImpl.readFileSync(targetPath, 'utf8');
  } catch {
    return null;
  }
}

function safeReadJson(targetPath, fsImpl = fs) {
  const text = safeReadText(targetPath, fsImpl);
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function normalizeSessionStatus(value) {
  const normalized = normalizeString(value).toLowerCase();
  if (!normalized) {
    return 'unknown';
  }
  if (normalized === 'running') {
    return 'active';
  }
  if (normalized === 'paused') {
    return 'idle';
  }
  return normalized;
}

function sortSessionsByUpdatedDesc(left, right) {
  const timestampDelta = (right.updatedAtMs || right.startedAtMs || 0) - (left.updatedAtMs || left.startedAtMs || 0);
  if (timestampDelta !== 0) {
    return timestampDelta;
  }
  return String(left.title || left.sessionId || '').localeCompare(String(right.title || right.sessionId || ''));
}

function buildHarnessRow(harness, extra = {}) {
  return {
    harnessId: harness.id,
    title: harness.title,
    homePath: normalizeString(extra.homePath) || null,
    inventoryAvailable: extra.inventoryAvailable === true,
    inventoryReason: normalizeString(extra.inventoryReason) || null,
    sessionCount: Number.isFinite(Number(extra.sessionCount)) ? Number(extra.sessionCount) : 0,
    latestUpdatedAtMs: Number.isFinite(Number(extra.latestUpdatedAtMs)) ? Number(extra.latestUpdatedAtMs) : null,
    sessions: Array.isArray(extra.sessions) ? extra.sessions : [],
  };
}

function buildCopilotHarnessSessions(options = {}) {
  const harness = GLOBAL_HARNESSES.find((entry) => entry.id === 'copilot');
  const homePath = normalizeString(options.elegyHome);
  if (!homePath) {
    return buildHarnessRow(harness, {
      inventoryAvailable: false,
      inventoryReason: 'home_not_configured',
    });
  }

  let unified = [];
  try {
    unified = options.sessionAggregation.buildUnifiedSessions(homePath, {
      sandboxesHome: options.sandboxesHome,
    });
  } catch {
    return buildHarnessRow(harness, {
      homePath,
      inventoryAvailable: false,
      inventoryReason: 'inventory_read_failed',
    });
  }

  const sessions = (Array.isArray(unified) ? unified : [])
    .map((session) => ({
      harnessId: 'copilot',
      sessionId: normalizeString(session && session.sessionId) || null,
      title:
        normalizeString(session && session.objective)
        || normalizeString(session && session.repoLabel)
        || normalizeString(session && session.sessionId)
        || 'Untitled',
      status: normalizeSessionStatus(session && session.status),
      startedAtMs: parseTime(session && session.startedAtMs),
      updatedAtMs: parseTime(session && session.updatedAtMs),
      elapsedMs: typeof session?.elapsedMs === 'number' && Number.isFinite(session.elapsedMs) ? session.elapsedMs : null,
      repoLabel: normalizeString(session && session.repoLabel) || null,
      projectName: null,
      source: normalizeString(session && session.source) || null,
      storageKind: 'session-state',
      canOpen: true,
    }))
    .filter((session) => session.sessionId);

  sessions.sort(sortSessionsByUpdatedDesc);

  return buildHarnessRow(harness, {
    homePath,
    inventoryAvailable: true,
    sessionCount: sessions.length,
    latestUpdatedAtMs: sessions[0]?.updatedAtMs || sessions[0]?.startedAtMs || null,
    sessions,
  });
}

function buildCodexHarnessSessions(options = {}) {
  const harness = GLOBAL_HARNESSES.find((entry) => entry.id === 'codex');
  const homePath = normalizeString(options.codexHome);
  if (!homePath) {
    return buildHarnessRow(harness, {
      inventoryAvailable: false,
      inventoryReason: 'home_not_configured',
    });
  }

  const indexPath = path.join(homePath, 'session_index.jsonl');
  const sessionsDir = path.join(homePath, 'sessions');
  const indexExists = !!safeStat(indexPath, options.fsImpl);
  const sessionsDirExists = !!safeStat(sessionsDir, options.fsImpl);
  if (!indexExists && !sessionsDirExists) {
    return buildHarnessRow(harness, {
      homePath,
      inventoryAvailable: false,
      inventoryReason: 'inventory_missing',
    });
  }

  const indexText = indexExists ? safeReadText(indexPath, options.fsImpl) : null;
  if (indexExists && indexText == null) {
    return buildHarnessRow(harness, {
      homePath,
      inventoryAvailable: false,
      inventoryReason: 'inventory_read_failed',
    });
  }

  const sessionsById = new Map();
  if (indexText != null) {
    for (const line of indexText.split(/\r?\n/)) {
      if (!line.trim()) {
        continue;
      }
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      const sessionId = normalizeString(parsed && parsed.id);
      if (!sessionId) {
        continue;
      }
      const updatedAtMs = parseTime(parsed && parsed.updated_at);
      const existing = sessionsById.get(sessionId);
      if (existing && (existing.updatedAtMs || 0) >= (updatedAtMs || 0)) {
        continue;
      }
      sessionsById.set(sessionId, {
        harnessId: 'codex',
        sessionId,
        title: normalizeString(parsed && parsed.thread_name) || sessionId,
        status: 'unknown',
        startedAtMs: null,
        updatedAtMs,
        elapsedMs: null,
        repoLabel: null,
        projectName: null,
        source: 'codex',
        storageKind: 'session-index',
        canOpen: false,
      });
    }
  }

  // Fallback: if session_index.jsonl is missing or empty, derive sessions from
  // on-disk session folders under ~/.codex/sessions/<YYYY-MM-DD>/<id>/.
  if (sessionsById.size === 0 && sessionsDirExists) {
    const sessionEntries = safeReadDir(sessionsDir, options.fsImpl);
    for (const dateEntry of sessionEntries) {
      if (!dateEntry || !dateEntry.isDirectory()) {
        continue;
      }
      const dateDir = path.join(sessionsDir, dateEntry.name);
      const stat = safeStat(dateDir, options.fsImpl);
      if (!stat) {
        continue;
      }
      const dayMs = stat.mtimeMs || null;
      for (const idEntry of safeReadDir(dateDir, options.fsImpl)) {
        if (!idEntry || !idEntry.isDirectory()) {
          continue;
        }
        const idPath = path.join(dateDir, idEntry.name);
        const idStat = safeStat(idPath, options.fsImpl);
        if (!idStat) {
          continue;
        }
        const sessionId = idEntry.name;
        if (!sessionId) {
          continue;
        }
        const existing = sessionsById.get(sessionId);
        if (existing) {
          continue;
        }
        sessionsById.set(sessionId, {
          harnessId: 'codex',
          sessionId,
          title: sessionId,
          status: 'unknown',
          startedAtMs: null,
          updatedAtMs: idStat.mtimeMs || dayMs,
          elapsedMs: null,
          repoLabel: null,
          projectName: null,
          source: 'codex',
          storageKind: 'session-folder',
          canOpen: false,
        });
      }
    }
  }

  if (sessionsById.size === 0) {
    return buildHarnessRow(harness, {
      homePath,
      inventoryAvailable: false,
      inventoryReason: 'inventory_read_failed',
    });
  }

  const sessions = Array.from(sessionsById.values()).sort(sortSessionsByUpdatedDesc);
  return buildHarnessRow(harness, {
    homePath,
    inventoryAvailable: true,
    sessionCount: sessions.length,
    latestUpdatedAtMs: sessions[0]?.updatedAtMs || null,
    sessions,
  });
}

function resolveOpenCodeDataHome(explicit) {
  if (typeof explicit === 'string' && explicit.trim()) {
    return path.resolve(explicit);
  }
  return DEFAULT_OPENCODE_DATA_HOME;
}

function resolveOpenCodeLogDir(dataHome) {
  return path.join(dataHome, OPENCODE_LOG_DIR);
}

function parseOpenCodeLogTimestamp(token) {
  if (!token) {
    return null;
  }
  let normalized = String(token).trim();
  if (normalized.startsWith('[') && normalized.endsWith(']')) {
    normalized = normalized.slice(1, -1);
  }
  const numeric = Number(normalized);
  if (Number.isFinite(numeric)) {
    return numeric > 1e12 ? numeric : numeric * 1000;
  }
  return parseTime(normalized);
}

function readOpenCodeSessionEvidenceFromLogs(logDir, fsImpl) {
  let dirEntries;
  try {
    dirEntries = fsImpl.readdirSync(logDir, { withFileTypes: true });
  } catch (error) {
    const wrapped = new Error(`Failed to read OpenCode log directory ${logDir}: ${error.message}`);
    wrapped.cause = error;
    wrapped.code = 'opencode_log_read_failed';
    throw wrapped;
  }
  const files = dirEntries
    .filter((entry) => entry && entry.isFile() && entry.name.endsWith('.log'))
    .map((entry) => entry.name)
    .sort();
  if (files.length === 0) {
    return { sessions: new Map(), logFiles: 0 };
  }

  const sessions = new Map();
  let logFiles = 0;
  for (const fileName of files) {
    const filePath = path.join(logDir, fileName);
    const stat = safeStat(filePath, fsImpl);
    if (!stat || !stat.isFile() || stat.size <= 0) {
      continue;
    }
    logFiles += 1;
    const text = safeReadText(filePath, fsImpl);
    if (!text) {
      continue;
    }
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) {
        continue;
      }
      const tokens = line.split(/\s+/);
      const sessionIdIndex = tokens.findIndex((token, idx) => idx >= 2 && token.startsWith('session.id='));
      if (sessionIdIndex === -1) {
        continue;
      }
      const sessionToken = tokens[sessionIdIndex];
      const sessionId = sessionToken.slice('session.id='.length);
      if (!sessionId || !SESSION_ID_RE.test(sessionId)) {
        continue;
      }
      const timestampMs = parseOpenCodeLogTimestamp(tokens[0]);
      let agent = '';
      let model = '';
      let provider = '';
      for (let i = 0; i < tokens.length; i += 1) {
        if (i === sessionIdIndex) continue;
        const token = tokens[i];
        const eq = token.indexOf('=');
        if (eq === -1) continue;
        const key = token.slice(0, eq);
        const value = token.slice(eq + 1);
        if (key === 'agent' && !agent) agent = value;
        if (key === 'modelID' && !model) model = value;
        if (key === 'providerID' && !provider) provider = value;
      }
      const existing = sessions.get(sessionId) || {
        harnessId: 'opencode',
        sessionId,
        agent,
        model,
        provider,
        firstSeenAtMs: timestampMs,
        lastSeenAtMs: timestampMs,
        evidence: 0,
      };
      existing.evidence += 1;
      if (!existing.agent && agent) existing.agent = agent;
      if (!existing.model && model) existing.model = model;
      if (!existing.provider && provider) existing.provider = provider;
      if (timestampMs != null) {
        if (existing.firstSeenAtMs == null || timestampMs < existing.firstSeenAtMs) {
          existing.firstSeenAtMs = timestampMs;
        }
        if (existing.lastSeenAtMs == null || timestampMs > existing.lastSeenAtMs) {
          existing.lastSeenAtMs = timestampMs;
        }
      }
      sessions.set(sessionId, existing);
    }
  }
  return { sessions, logFiles };
}

function readOpenCodeSessionEvidenceFromProjectState(dataHome, fsImpl) {
  const projectDir = path.join(dataHome, OPENCODE_PROJECT_STATE_DIR);
  const stat = safeStat(projectDir, fsImpl);
  if (!stat || !stat.isDirectory()) {
    return [];
  }
  const sessions = [];
  for (const entry of safeReadDir(projectDir, fsImpl)) {
    if (!entry || !entry.isFile()) {
      continue;
    }
    if (!entry.name.endsWith('.json')) {
      continue;
    }
    const filePath = path.join(projectDir, entry.name);
    const data = safeReadJson(filePath, fsImpl);
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      continue;
    }
    const projectName = normalizeString(data.projectName) || null;
    const activeWorktreeBranch = normalizeString(data.activeWorktreeBranch) || null;
    const lastCreatedAt = parseTime(data.lastCreatedAt);

    const candidateIds = new Set();
    if (normalizeString(data.sessionId)) {
      candidateIds.add(normalizeString(data.sessionId));
    }
    if (data.sessions && typeof data.sessions === 'object' && !Array.isArray(data.sessions)) {
      for (const key of Object.keys(data.sessions)) {
        if (normalizeString(key) && SESSION_ID_RE.test(key)) {
          candidateIds.add(key);
        }
      }
    }
    for (const sessionId of candidateIds) {
      sessions.push({
        sessionId,
        projectName,
        activeWorktreeBranch,
        lastCreatedAt,
      });
    }
  }
  return sessions;
}

function readOpenCodeSessionEvidenceFromPluginState(dataHome, fsImpl) {
  const stateFile = path.join(dataHome, OPENCODE_PLUGIN_STATE_DIR, '.state');
  const stat = safeStat(stateFile, fsImpl);
  if (!stat || !stat.isFile()) {
    return new Map();
  }
  const text = safeReadText(stateFile, fsImpl);
  const sessions = new Map();
  if (!text) {
    return sessions;
  }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed;
    try { parsed = JSON.parse(trimmed); } catch { continue; }
    const sessionId = normalizeString(parsed && parsed.sessionId);
    if (!sessionId) continue;
    sessions.set(sessionId, {
      worktreePath: normalizeString(parsed && parsed.worktreePath) || null,
      branch: normalizeString(parsed && parsed.branch) || null,
      repoId: normalizeString(parsed && parsed.repoId) || null,
    });
  }
  return sessions;
}

function buildOpenCodeHarnessSessions(options = {}) {
  const harness = GLOBAL_HARNESSES.find((entry) => entry.id === 'opencode');
  const homePath = normalizeString(options.opencodeHome);
  if (!homePath) {
    return buildHarnessRow(harness, {
      inventoryAvailable: false,
      inventoryReason: 'home_not_configured',
    });
  }

  const dataHome = resolveOpenCodeDataHome(options.opencodeDataHome);
  const logDir = resolveOpenCodeLogDir(dataHome);
  const logDirStat = safeStat(logDir, options.fsImpl);
  const dataHomeStat = safeStat(dataHome, options.fsImpl);

  if (!dataHomeStat || !dataHomeStat.isDirectory()) {
    return buildHarnessRow(harness, {
      homePath,
      inventoryAvailable: false,
      inventoryReason: 'inventory_missing',
    });
  }

  if (!logDirStat || !logDirStat.isDirectory()) {
    return buildHarnessRow(harness, {
      homePath,
      inventoryAvailable: false,
      inventoryReason: 'inventory_missing',
    });
  }

  let logEvidence;
  try {
    logEvidence = readOpenCodeSessionEvidenceFromLogs(logDir, options.fsImpl);
  } catch {
    return buildHarnessRow(harness, {
      homePath,
      inventoryAvailable: false,
      inventoryReason: 'inventory_read_failed',
    });
  }
  const projectState = readOpenCodeSessionEvidenceFromProjectState(dataHome, options.fsImpl);
  const pluginState = readOpenCodeSessionEvidenceFromPluginState(dataHome, options.fsImpl);

  const projectById = new Map();
  for (const entry of projectState) {
    if (!projectById.has(entry.sessionId)) {
      projectById.set(entry.sessionId, entry);
    }
  }

  const sessionIds = new Set([
    ...logEvidence.sessions.keys(),
    ...projectById.keys(),
    ...pluginState.keys(),
  ]);

  if (sessionIds.size === 0) {
    return buildHarnessRow(harness, {
      homePath,
      inventoryAvailable: false,
      inventoryReason: 'inventory_missing',
    });
  }

  const sessions = [];
  for (const sessionId of sessionIds) {
    const logEntry = logEvidence.sessions.get(sessionId) || null;
    const projectEntry = projectById.get(sessionId) || null;
    const pluginEntry = pluginState.get(sessionId) || null;

    const updatedAtMs = (() => {
      if (logEntry && logEntry.lastSeenAtMs) return logEntry.lastSeenAtMs;
      if (projectEntry && projectEntry.lastCreatedAt) return projectEntry.lastCreatedAt;
      return null;
    })();
    const startedAtMs = logEntry && logEntry.firstSeenAtMs
      ? logEntry.firstSeenAtMs
      : (projectEntry && projectEntry.lastCreatedAt) || updatedAtMs;

    const agentName = (logEntry && logEntry.agent) || (projectEntry && projectEntry.activeWorktreeBranch) || null;
    const titleParts = [];
    if (agentName) titleParts.push(agentName);
    if (logEntry && logEntry.model) titleParts.push(logEntry.model);
    if (!titleParts.length) titleParts.push(sessionId);

    sessions.push({
      harnessId: 'opencode',
      sessionId,
      title: titleParts.join(' · '),
      status: 'unknown',
      startedAtMs,
      updatedAtMs,
      elapsedMs: null,
      repoLabel: null,
      projectName: projectEntry ? projectEntry.projectName : null,
      branch: pluginEntry ? pluginEntry.branch : (projectEntry ? projectEntry.activeWorktreeBranch : null),
      worktreePath: pluginEntry ? pluginEntry.worktreePath : null,
      agent: agentName,
      model: logEntry ? logEntry.model : null,
      provider: logEntry ? logEntry.provider : null,
      source: 'opencode',
      storageKind: logEntry ? 'log-evidence' : (projectEntry ? 'project-state' : 'plugin-state'),
      canOpen: false,
    });
  }

  sessions.sort(sortSessionsByUpdatedDesc);
  return buildHarnessRow(harness, {
    homePath,
    inventoryAvailable: true,
    sessionCount: sessions.length,
    latestUpdatedAtMs: sessions[0]?.updatedAtMs || sessions[0]?.startedAtMs || null,
    sessions,
  });
}

function buildAntigravityHarnessSessions(options = {}) {
  const harness = GLOBAL_HARNESSES.find((entry) => entry.id === 'antigravity');
  const homePath = normalizeString(options.antigravityHome);
  if (!homePath) {
    return buildHarnessRow(harness, {
      inventoryAvailable: false,
      inventoryReason: 'home_not_configured',
    });
  }

  const conversationsDir = path.join(homePath, 'conversations');
  const stat = safeStat(conversationsDir, options.fsImpl);
  if (!stat || !stat.isDirectory()) {
    return buildHarnessRow(harness, {
      homePath,
      inventoryAvailable: false,
      inventoryReason: 'inventory_missing',
    });
  }

  const sessions = safeReadDir(conversationsDir, options.fsImpl)
    .filter((entry) => entry && entry.isFile() && /\.pb$/i.test(entry.name))
    .map((entry) => {
      const filePath = path.join(conversationsDir, entry.name);
      const fileStat = safeStat(filePath, options.fsImpl);
      const sessionId = entry.name.replace(/\.pb$/i, '');
      return {
        harnessId: 'antigravity',
        sessionId,
        title: sessionId,
        status: 'unknown',
        startedAtMs: null,
        updatedAtMs: fileStat && Number.isFinite(fileStat.mtimeMs) ? fileStat.mtimeMs : null,
        elapsedMs: null,
        repoLabel: null,
        projectName: null,
        source: 'antigravity',
        storageKind: 'conversation-file',
        canOpen: false,
      };
    })
    .sort(sortSessionsByUpdatedDesc);

  return buildHarnessRow(harness, {
    homePath,
    inventoryAvailable: true,
    sessionCount: sessions.length,
    latestUpdatedAtMs: sessions[0]?.updatedAtMs || null,
    sessions,
  });
}

function buildGeminiCliHarnessSessions(options = {}) {
  const harness = GLOBAL_HARNESSES.find((entry) => entry.id === 'gemini-cli');
  const homePath = normalizeString(options.geminiHome);
  if (!homePath) {
    return buildHarnessRow(harness, {
      inventoryAvailable: false,
      inventoryReason: 'home_not_configured',
    });
  }

  const historyDir = path.join(homePath, 'history');
  const stat = safeStat(historyDir, options.fsImpl);
  if (!stat || !stat.isDirectory()) {
    return buildHarnessRow(harness, {
      homePath,
      inventoryAvailable: false,
      inventoryReason: 'inventory_missing',
    });
  }

  const hasSupportedEntries = safeReadDir(historyDir, options.fsImpl).some((entry) => {
    if (!entry || !entry.isDirectory()) {
      return false;
    }
    return safeReadDir(path.join(historyDir, entry.name), options.fsImpl)
      .some((child) => child && child.isFile() && child.name !== '.project_root');
  });

  return buildHarnessRow(harness, {
    homePath,
    inventoryAvailable: hasSupportedEntries,
    inventoryReason: hasSupportedEntries ? null : 'inventory_not_supported',
    sessionCount: 0,
    latestUpdatedAtMs: null,
    sessions: [],
  });
}

function listHarnessSessions(options = {}) {
  const sessionAggregation = options.sessionAggregation || sessionAggregationLib;
  const fsImpl = options.fsImpl || fs;

  const harnesses = [
    buildCopilotHarnessSessions({
      elegyHome: options.elegyHome,
      sandboxesHome: options.sandboxesHome,
      sessionAggregation,
      fsImpl,
    }),
    buildCodexHarnessSessions({
      codexHome: options.codexHome,
      fsImpl,
    }),
    buildOpenCodeHarnessSessions({
      opencodeHome: options.opencodeHome,
      opencodeDataHome: options.opencodeDataHome,
      fsImpl,
    }),
    buildAntigravityHarnessSessions({
      antigravityHome: options.antigravityHome,
      fsImpl,
    }),
    buildGeminiCliHarnessSessions({
      geminiHome: options.geminiHome,
      fsImpl,
    }),
  ];

  return {
    totalSessionCount: harnesses.reduce((sum, harness) => sum + (Number(harness.sessionCount) || 0), 0),
    harnesses,
    inventorySummary: {
      availableHarnessCount: harnesses.filter((harness) => harness.inventoryAvailable).length,
      unavailableHarnessCount: harnesses.filter((harness) => !harness.inventoryAvailable).length,
    },
  };
}

module.exports = {
  listHarnessSessions,
};
