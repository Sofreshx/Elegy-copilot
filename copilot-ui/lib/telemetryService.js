'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const opencodeLogReader = require('./opencodeLogReader');
const opencodeConfig = require('./opencodeConfig');

const DEFAULT_EVENT_LIMIT = 200;
const MAX_EVENT_LIMIT = 500;
const MAX_LOG_FILES = 20;
const MAX_LINE_LENGTH = 500;

function asNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clampLimit(value) {
  return Math.min(Math.max(1, asNumber(value, DEFAULT_EVENT_LIMIT)), MAX_EVENT_LIMIT);
}

function safeStat(filePath, fsImpl = fs) {
  try {
    return fsImpl.statSync(filePath);
  } catch {
    return null;
  }
}

function truncate(value, max = MAX_LINE_LENGTH) {
  const text = typeof value === 'string' ? value : String(value || '');
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function increment(map, key) {
  const normalized = key || 'unknown';
  map.set(normalized, (map.get(normalized) || 0) + 1);
}

function toCountList(map, limit = 10) {
  return Array.from(map.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit);
}

function buildProviderUsageFromRequests(requests) {
  const providers = new Map();
  const models = new Map();
  const agents = new Map();

  for (const entry of requests || []) {
    increment(providers, entry.provider || 'unknown');
    increment(models, entry.model || 'unknown');
    increment(agents, entry.agent || 'unknown');
  }

  return {
    providers: toCountList(providers),
    topModels: toCountList(models).map((item) => {
      const match = (requests || []).find((entry) => entry.model === item.name);
      return { ...item, provider: match ? match.provider : 'unknown' };
    }),
    topAgents: toCountList(agents),
  };
}

function readCodexSessionCount(codexHome, options = {}) {
  const fsImpl = options.fs || fs;
  const indexPath = path.join(codexHome, 'session_index.jsonl');
  try {
    if (!fsImpl.existsSync(indexPath)) return { count: 0, sessions: [] };
    const raw = fsImpl.readFileSync(indexPath, 'utf8');
    const seen = new Set();
    const sessions = [];
    for (const line of raw.split(/\r?\n/).filter(Boolean)) {
      try {
        const entry = JSON.parse(line);
        if (entry && entry.id && !seen.has(entry.id)) {
          seen.add(entry.id);
          sessions.push({
            id: entry.id,
            updatedAt: entry.updated_at || entry.updatedAt || null,
            name: entry.thread_name || entry.name || null,
          });
        }
      } catch {
        // skip malformed records
      }
    }
    sessions.sort((a, b) => {
      const at = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const bt = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      return bt - at;
    });
    return { count: sessions.length, sessions: sessions.slice(0, 20) };
  } catch {
    return { count: 0, sessions: [] };
  }
}

function normalizeErrorType(line) {
  const lower = line.toLowerCase();
  if (lower.includes('permission')) return 'permission';
  if (lower.includes('timeout') || lower.includes('timed out')) return 'timeout';
  if (lower.includes('rate limit') || lower.includes('429')) return 'rate-limit';
  if (lower.includes('network') || lower.includes('econn') || lower.includes('fetch')) return 'network';
  if (lower.includes('tool')) return 'tool';
  if (lower.includes('json') || lower.includes('parse')) return 'parse';
  if (lower.includes('auth') || lower.includes('unauthorized') || lower.includes('401')) return 'auth';
  return 'error';
}

function extractTimestamp(line, fallback) {
  const iso = line.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?/);
  if (iso) return iso[0];
  const tokens = line.trim().split(/\s+/);
  if (tokens[1] && /\d{2}:\d{2}|\d{4}-\d{2}-\d{2}/.test(tokens[1])) return tokens[1];
  return fallback || '';
}

function extractToolName(line) {
  const patterns = [
    /\btool(?:\.name|Name|_name)?=([^\s,]+)/i,
    /\btool_call(?:\.name|Name|_name)?=([^\s,]+)/i,
    /\btoolCall(?:\.name|Name)?=([^\s,]+)/i,
    /\bname=([A-Za-z0-9_.:-]+).*?\bservice=tool/i,
    /\bservice=tool\b.*?\bname=([A-Za-z0-9_.:-]+)/i,
  ];
  for (const pattern of patterns) {
    const match = line.match(pattern);
    if (match && match[1]) return match[1].replace(/^["']|["']$/g, '');
  }
  return null;
}

function isErrorLine(line) {
  return /\b(ERROR|ERR|WARN)\b/i.test(line) || /\b(error|exception|failed|failure|denied|timeout)\b/i.test(line);
}

function isToolLine(line) {
  return /\b(tool|tool_call|toolCall|service=tool)\b/i.test(line);
}

function readLogLines(logDir, options = {}) {
  const fsImpl = options.fs || fs;
  const pathImpl = options.path || path;
  const maxFiles = Math.max(1, asNumber(options.maxFiles, MAX_LOG_FILES));
  const maxLinesPerFile = Math.max(1, asNumber(options.maxLinesPerFile, 1000));
  let files = [];
  try {
    files = fsImpl.readdirSync(logDir)
      .filter((name) => name.endsWith('.log'))
      .sort()
      .reverse()
      .slice(0, maxFiles);
  } catch {
    return { lines: [], logFiles: 0 };
  }

  const lines = [];
  for (const file of files) {
    const filePath = pathImpl.join(logDir, file);
    const stat = safeStat(filePath, fsImpl);
    if (!stat || !stat.isFile() || stat.size <= 0) continue;
    let fileLines = [];
    try {
      fileLines = opencodeLogReader.tailTextLines
        ? opencodeLogReader.tailTextLines(filePath, maxLinesPerFile)
        : fsImpl.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean).slice(-maxLinesPerFile);
    } catch {
      fileLines = [];
    }
    for (const line of fileLines) {
      lines.push({ file, line });
    }
  }
  return { lines, logFiles: files.length };
}

function buildOpenCodeTelemetry(options = {}) {
  const limit = clampLimit(options.limit);
  const logDir = options.logDir || opencodeLogReader.resolveLogDir();
  const opencodeHome = options.opencodeHome || path.join(os.homedir(), '.config', 'opencode');
  const { lines, logFiles } = readLogLines(logDir, options);
  const requestLogs = opencodeLogReader.readRequestLogs({ limit, logDir });
  let experimentalOpenTelemetry = null;
  try {
    const config = opencodeConfig.readConfig(opencodeHome);
    experimentalOpenTelemetry = Boolean(
      config
      && config.experimental
      && config.experimental.openTelemetry === true,
    );
  } catch {
    experimentalOpenTelemetry = null;
  }

  const tools = new Map();
  const errors = new Map();
  const recentErrors = [];
  const recentEvents = [];
  let toolEvents = 0;
  let errorEvents = 0;

  for (const request of requestLogs.requests || []) {
    recentEvents.push({
      timestamp: request.timestamp || '',
      type: 'request',
      source: 'opencode-llm-log',
      label: request.agent || 'unknown',
      message: `${request.provider || 'unknown'}/${request.model || 'unknown'} (${request.mode || 'unknown'})`,
    });
  }

  for (const item of lines) {
    const toolName = extractToolName(item.line);
    if (toolName || isToolLine(item.line)) {
      toolEvents += 1;
      increment(tools, toolName || 'unknown');
      recentEvents.push({
        timestamp: extractTimestamp(item.line),
        type: 'tool',
        source: item.file,
        label: toolName || 'unknown',
        message: truncate(item.line),
      });
    }
    if (isErrorLine(item.line)) {
      const errorType = normalizeErrorType(item.line);
      errorEvents += 1;
      increment(errors, errorType);
      recentErrors.push({
        timestamp: extractTimestamp(item.line),
        type: errorType,
        source: item.file,
        message: truncate(item.line),
      });
      recentEvents.push({
        timestamp: extractTimestamp(item.line),
        type: 'error',
        source: item.file,
        label: errorType,
        message: truncate(item.line),
      });
    }
  }

  const usage = buildProviderUsageFromRequests(requestLogs.requests || []);
  return {
    id: 'opencode',
    label: 'OpenCode',
    source: {
      kind: 'log-files',
      path: logDir,
      openTelemetry: experimentalOpenTelemetry,
    },
    coverage: logFiles > 0 ? 'sampled-log-files' : 'no-logs-found',
    sample: {
      limit,
      logFiles,
      sampledLines: lines.length,
      deterministic: true,
    },
    summary: {
      requests: requestLogs.total || 0,
      sampledRequests: (requestLogs.requests || []).length,
      errors: errorEvents,
      toolEvents,
      sessions: null,
    },
    providerUsage: {
      providers: usage.providers || [],
      topModels: usage.topModels || [],
      topAgents: usage.topAgents || [],
    },
    topTools: toCountList(tools),
    errorsByType: toCountList(errors),
    recentErrors: recentErrors.slice(-limit).reverse(),
    recentEvents: recentEvents.slice(-limit).reverse(),
  };
}

function buildCodexTelemetry(options = {}) {
  const codexHome = options.codexHome || path.join(os.homedir(), '.codex');
  const sessions = readCodexSessionCount(codexHome, options);
  const logsPath = path.join(codexHome, 'logs_2.sqlite');
  const logStat = safeStat(logsPath, options.fs || fs);
  return {
    id: 'codex',
    label: 'Codex',
    source: {
      kind: 'session-index',
      path: path.join(codexHome, 'session_index.jsonl'),
      logsPath,
    },
    coverage: logStat && logStat.isFile() ? 'session-index-plus-unparsed-sqlite' : 'session-index-only',
    sample: {
      limit: clampLimit(options.limit),
      logFiles: logStat && logStat.isFile() ? 1 : 0,
      sampledLines: 0,
      deterministic: true,
    },
    summary: {
      requests: null,
      sampledRequests: null,
      errors: 0,
      toolEvents: 0,
      sessions: sessions.count,
    },
    providerUsage: {
      providers: [],
      topModels: [],
      topAgents: [],
    },
    topTools: [],
    errorsByType: [],
    recentErrors: [],
    recentEvents: sessions.sessions.map((session) => ({
      timestamp: session.updatedAt || '',
      type: 'session',
      source: 'session_index.jsonl',
      label: session.name || session.id,
      message: session.id,
    })),
  };
}

function buildHarnessTelemetry(options = {}) {
  return {
    generatedAt: new Date().toISOString(),
    harnesses: {
      opencode: buildOpenCodeTelemetry(options.opencode || options),
      codex: buildCodexTelemetry(options.codex || options),
    },
  };
}

module.exports = {
  buildHarnessTelemetry,
  buildOpenCodeTelemetry,
  buildCodexTelemetry,
  extractToolName,
  normalizeErrorType,
  _testing: {
    readLogLines,
    isErrorLine,
    isToolLine,
  },
};
