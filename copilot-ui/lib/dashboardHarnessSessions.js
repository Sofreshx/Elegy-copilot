'use strict';

const fs = require('fs');
const path = require('path');

const sessionAggregationLib = require('./sessionAggregation');
const { GLOBAL_HARNESSES } = require('./harnessCatalog');

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
  const homePath = normalizeString(options.copilotHome);
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

  // Prefer index file
  if (indexExists) {
    const indexText = safeReadText(indexPath, options.fsImpl);
    if (indexText != null) {
      const sessionsById = new Map();
      for (const line of indexText.split(/\r?\n/)) {
        if (!line.trim()) continue;
        let parsed;
        try { parsed = JSON.parse(line); } catch { continue; }
        const sessionId = normalizeString(parsed && parsed.id);
        if (!sessionId) continue;
        const updatedAtMs = parseTime(parsed && parsed.updated_at);
        const existing = sessionsById.get(sessionId);
        if (existing && (existing.updatedAtMs || 0) >= (updatedAtMs || 0)) continue;
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
      const sessions = Array.from(sessionsById.values()).sort(sortSessionsByUpdatedDesc);
      return buildHarnessRow(harness, {
        homePath,
        inventoryAvailable: true,
        sessionCount: sessions.length,
        latestUpdatedAtMs: sessions[0]?.updatedAtMs || null,
        sessions,
      });
    }
  }

  // Fallback: list session directories
  if (sessionsDirExists) {
    const sessionDirs = safeReadDir(sessionsDir, options.fsImpl)
      .filter((entry) => entry && entry.isDirectory());

    if (sessionDirs.length > 0) {
      const sessions = sessionDirs
        .map((entry) => {
          const sessionId = entry.name;
          const dirPath = path.join(sessionsDir, sessionId);
          const dirStat = safeStat(dirPath, options.fsImpl);
          let latestMtime = null;
          try {
            const contents = options.fsImpl.readdirSync(dirPath, { withFileTypes: true });
            for (const child of contents) {
              if (!child || !child.isFile()) continue;
              const childStat = safeStat(path.join(dirPath, child.name), options.fsImpl);
              if (childStat && childStat.mtimeMs > (latestMtime || 0)) {
                latestMtime = childStat.mtimeMs;
              }
            }
            if (latestMtime == null && dirStat) latestMtime = dirStat.mtimeMs;
          } catch {
            if (dirStat) latestMtime = dirStat.mtimeMs;
          }
          return {
            harnessId: 'codex',
            sessionId,
            title: sessionId,
            status: 'unknown',
            startedAtMs: null,
            updatedAtMs: latestMtime,
            elapsedMs: null,
            repoLabel: null,
            projectName: null,
            source: 'codex',
            storageKind: 'session-directory',
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
  }

  // No sessions at all
  if (!indexExists && !sessionsDirExists) {
    return buildHarnessRow(harness, {
      homePath,
      inventoryAvailable: false,
      inventoryReason: 'inventory_missing',
    });
  }

  return buildHarnessRow(harness, {
    homePath,
    inventoryAvailable: false,
    inventoryReason: 'inventory_read_failed',
  });
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

  const opencodeLogReader = options.opencodeLogReader || require('./opencodeLogReader');
  const fsImpl = options.fsImpl || fs;

  // Read log entries with session IDs
  let entries = [];
  try {
    const logOpts = { limit: 2000 };
    if (options.opencodeLogDir) {
      logOpts.logDir = options.opencodeLogDir;
    }
    const logResult = opencodeLogReader.readRequestLogs(logOpts);
    entries = Array.isArray(logResult.requests) ? logResult.requests : [];
  } catch {
    return buildHarnessRow(harness, {
      homePath,
      inventoryAvailable: false,
      inventoryReason: 'inventory_read_failed',
    });
  }

  // Filter entries that have a sessionId
  const entriesWithSession = entries.filter((entry) => entry.sessionId && String(entry.sessionId).trim());

  if (entriesWithSession.length === 0) {
    return buildHarnessRow(harness, {
      homePath,
      inventoryAvailable: false,
      inventoryReason: 'inventory_missing',
    });
  }

  // Group by sessionId, keeping latest entry per session
  const sessionsById = new Map();
  for (const entry of entriesWithSession) {
    const sessionId = String(entry.sessionId).trim();
    const existing = sessionsById.get(sessionId);
    const entryTimestamp = parseTime(entry.timestamp);

    if (existing && (existing.updatedAtMs || 0) >= (entryTimestamp || 0)) {
      continue;
    }

    sessionsById.set(sessionId, {
      harnessId: 'opencode',
      sessionId,
      title: entry.agent ? `${entry.agent}-${sessionId.slice(0, 8)}` : sessionId,
      status: 'unknown',
      startedAtMs: null,
      updatedAtMs: entryTimestamp,
      elapsedMs: null,
      repoLabel: null,
      projectName: null,
      source: 'opencode',
      storageKind: 'opencode-log',
      canOpen: false,
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
      copilotHome: options.copilotHome,
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
      opencodeLogReader: options.opencodeLogReader,
      opencodeLogDir: options.opencodeLogDir,
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
