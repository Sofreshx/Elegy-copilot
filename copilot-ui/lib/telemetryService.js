'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const opencodeLogReader = require('./opencodeLogReader');
const opencodeConfig = require('./opencodeConfig');
let BetterSqlite3 = null;
try {
  BetterSqlite3 = require('better-sqlite3');
} catch {
  BetterSqlite3 = null;
}

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

function readJsonLines(filePath, options = {}) {
  const fsImpl = options.fs || fs;
  try {
    if (!filePath || !fsImpl.existsSync(filePath)) return [];
    return fsImpl.readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function getAny(obj, keys) {
  for (const key of keys) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, key)) return obj[key];
  }
  return undefined;
}

function extractRolloutPayload(event) {
  if (!event || typeof event !== 'object') return {};
  const payload = event.payload || event.msg || event.event || event.item || event;
  return payload && typeof payload === 'object' ? payload : {};
}

function extractRolloutType(event) {
  return String(getAny(event, ['type', 'event_type', 'name']) || getAny(extractRolloutPayload(event), ['type', 'event_type', 'name']) || '');
}

function extractTokenUsage(payload) {
  const usage = payload.last_token_usage || payload.total_token_usage || payload.usage || payload.token_usage || null;
  if (!usage || typeof usage !== 'object') return null;
  return {
    inputTokens: asNumber(usage.input_tokens ?? usage.inputTokens, 0),
    cachedInputTokens: asNumber(usage.cached_input_tokens ?? usage.cachedInputTokens, 0),
    outputTokens: asNumber(usage.output_tokens ?? usage.outputTokens, 0),
    reasoningOutputTokens: asNumber(usage.reasoning_output_tokens ?? usage.reasoningOutputTokens, 0),
    totalTokens: asNumber(usage.total_tokens ?? usage.totalTokens, 0),
  };
}

function summarizeRollout(rolloutPath, options = {}) {
  const tools = new Map();
  let toolEvents = 0;
  let errors = 0;
  let completed = false;
  let tokens = {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0,
  };

  for (const event of readJsonLines(rolloutPath, options)) {
    const type = extractRolloutType(event);
    const payload = extractRolloutPayload(event);
    if (type === 'token_count' || payload.last_token_usage || payload.total_token_usage) {
      const usage = extractTokenUsage(payload);
      if (usage) tokens = usage;
    }
    if (type === 'function_call' || type === 'tool_call') {
      toolEvents += 1;
      increment(tools, String(payload.name || payload.tool_name || payload.toolName || 'unknown'));
    }
    if (type === 'function_call_output' && /error|failed|denied/i.test(JSON.stringify(payload).slice(0, 500))) {
      errors += 1;
    }
    if (type === 'task_complete' || type === 'completed') completed = true;
  }

  return {
    tokens,
    toolEvents,
    errors,
    completed,
    topTools: toCountList(tools, 20),
  };
}

function openReadonlySqlite(dbPath) {
  if (!BetterSqlite3) return null;
  try {
    if (!fs.existsSync(dbPath)) return null;
    return new BetterSqlite3(dbPath, { readonly: true, fileMustExist: true });
  } catch {
    return null;
  }
}

function hasTable(db, tableName) {
  try {
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName);
    return Boolean(row);
  } catch {
    return false;
  }
}

function getTableColumns(db, tableName) {
  try {
    return new Set(db.prepare(`PRAGMA table_info(${tableName})`).all().map((row) => row.name));
  } catch {
    return new Set();
  }
}

function buildCodexSubagentUsage(options = {}) {
  const codexHome = options.codexHome || path.join(os.homedir(), '.codex');
  const limit = clampLimit(options.limit);
  const statePath = options.statePath || path.join(codexHome, 'state_5.sqlite');
  const db = openReadonlySqlite(statePath);
  if (!db) {
    return {
      generatedAt: new Date().toISOString(),
      source: { kind: 'codex-state', path: statePath },
      coverage: 'no-readable-state',
      runs: [],
      byAgent: [],
      summary: {
        runs: 0,
        tokens: 0,
        toolEvents: 0,
        errors: 0,
      },
    };
  }

  try {
    if (!hasTable(db, 'threads') || !hasTable(db, 'thread_spawn_edges')) {
      return {
        generatedAt: new Date().toISOString(),
        source: { kind: 'codex-state', path: statePath },
        coverage: 'unsupported-state-schema',
        runs: [],
        byAgent: [],
        summary: { runs: 0, tokens: 0, toolEvents: 0, errors: 0 },
      };
    }

    const columns = getTableColumns(db, 'threads');
    const selectColumns = [
      'id',
      columns.has('agent_role') ? 'agent_role' : 'NULL AS agent_role',
      columns.has('agent_nickname') ? 'agent_nickname' : 'NULL AS agent_nickname',
      columns.has('model') ? 'model' : 'NULL AS model',
      columns.has('reasoning_effort') ? 'reasoning_effort' : 'NULL AS reasoning_effort',
      columns.has('sandbox_mode') ? 'sandbox_mode' : 'NULL AS sandbox_mode',
      columns.has('rollout_path') ? 'rollout_path' : 'NULL AS rollout_path',
      columns.has('tokens_used') ? 'tokens_used' : 'NULL AS tokens_used',
      columns.has('created_at') ? 'created_at' : 'NULL AS created_at',
      columns.has('updated_at') ? 'updated_at' : 'NULL AS updated_at',
    ].join(', ');
    const rows = db.prepare(`
      SELECT e.parent_thread_id, e.child_thread_id, e.status AS edge_status, ${selectColumns}
      FROM thread_spawn_edges e
      JOIN threads t ON t.id = e.child_thread_id
      ORDER BY COALESCE(t.updated_at, t.created_at, '') DESC
      LIMIT ?
    `).all(limit);

    const byAgentMap = new Map();
    const runs = rows.map((row) => {
      const rollout = summarizeRollout(row.rollout_path, options);
      const totalTokens = rollout.tokens.totalTokens || asNumber(row.tokens_used, 0);
      const agentName = row.agent_role || 'unknown';
      const run = {
        parentThreadId: row.parent_thread_id,
        threadId: row.child_thread_id,
        status: row.edge_status || null,
        agent: agentName,
        nickname: row.agent_nickname || null,
        model: row.model || null,
        reasoningEffort: row.reasoning_effort || null,
        sandboxMode: row.sandbox_mode || null,
        rolloutPath: row.rollout_path || null,
        createdAt: row.created_at || null,
        updatedAt: row.updated_at || null,
        tokens: {
          ...rollout.tokens,
          totalTokens,
        },
        toolEvents: rollout.toolEvents,
        topTools: rollout.topTools,
        errors: rollout.errors,
        completed: rollout.completed,
        flags: [],
      };
      if (run.toolEvents > 0 && run.toolEvents < 5) run.flags.push('low-tool-count');
      if (run.errors > 0) run.flags.push('tool-errors');
      if (!run.completed && run.status !== 'closed') run.flags.push('possibly-stale');

      const aggregate = byAgentMap.get(agentName) || {
        name: agentName,
        count: 0,
        tokens: 0,
        toolEvents: 0,
        errors: 0,
        models: new Map(),
        tools: new Map(),
        topTools: [],
      };
      aggregate.count += 1;
      aggregate.tokens += totalTokens;
      aggregate.toolEvents += run.toolEvents;
      aggregate.errors += run.errors;
      increment(aggregate.models, run.model || 'unknown');
      for (const tool of run.topTools) {
        aggregate.tools.set(tool.name, (aggregate.tools.get(tool.name) || 0) + tool.count);
      }
      byAgentMap.set(agentName, aggregate);
      return run;
    });

    const byAgent = Array.from(byAgentMap.values()).map((row) => ({
      name: row.name,
      count: row.count,
      tokens: row.tokens,
      toolEvents: row.toolEvents,
      errors: row.errors,
      topModels: toCountList(row.models),
      topTools: toCountList(row.tools),
    })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

    return {
      generatedAt: new Date().toISOString(),
      source: { kind: 'codex-state', path: statePath },
      coverage: 'codex-state-plus-rollouts',
      runs,
      byAgent,
      summary: {
        runs: runs.length,
        tokens: runs.reduce((sum, run) => sum + run.tokens.totalTokens, 0),
        toolEvents: runs.reduce((sum, run) => sum + run.toolEvents, 0),
        errors: runs.reduce((sum, run) => sum + run.errors, 0),
      },
    };
  } catch (error) {
    return {
      generatedAt: new Date().toISOString(),
      source: { kind: 'codex-state', path: statePath },
      coverage: 'state-read-error',
      error: error.message,
      runs: [],
      byAgent: [],
      summary: { runs: 0, tokens: 0, toolEvents: 0, errors: 0 },
    };
  } finally {
    try {
      db.close();
    } catch {
      // ignore
    }
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
  const logsPath = path.join(codexHome, 'state_5.sqlite');
  const logStat = safeStat(logsPath, options.fs || fs);
  const subagents = buildCodexSubagentUsage({ ...options, codexHome, limit: options.limit || DEFAULT_EVENT_LIMIT });
  const subagentTools = new Map();
  for (const agent of subagents.byAgent || []) {
    for (const tool of agent.topTools || []) {
      subagentTools.set(tool.name, (subagentTools.get(tool.name) || 0) + tool.count);
    }
  }
  return {
    id: 'codex',
    label: 'Codex',
    source: {
      kind: 'session-index',
      path: path.join(codexHome, 'session_index.jsonl'),
      logsPath,
    },
    coverage: logStat && logStat.isFile() ? subagents.coverage : 'session-index-only',
    sample: {
      limit: clampLimit(options.limit),
      logFiles: logStat && logStat.isFile() ? 1 : 0,
      sampledLines: 0,
      deterministic: true,
    },
    summary: {
      requests: null,
      sampledRequests: null,
      errors: subagents.summary.errors,
      toolEvents: subagents.summary.toolEvents,
      sessions: sessions.count,
    },
    providerUsage: {
      providers: [],
      topModels: [],
      topAgents: subagents.byAgent.map((agent) => ({ name: agent.name, count: agent.count })),
    },
    topTools: toCountList(subagentTools),
    errorsByType: [],
    recentErrors: [],
    recentEvents: [
      ...subagents.runs.map((run) => ({
        timestamp: run.updatedAt || run.createdAt || '',
        type: 'subagent',
        source: 'state_5.sqlite',
        label: run.agent,
        message: `${run.model || 'unknown'} · ${run.tokens.totalTokens} tokens · ${run.toolEvents} tools`,
      })),
      ...sessions.sessions.map((session) => ({
      timestamp: session.updatedAt || '',
      type: 'session',
      source: 'session_index.jsonl',
      label: session.name || session.id,
      message: session.id,
      })),
    ].slice(0, clampLimit(options.limit)),
    subagents,
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
  buildCodexSubagentUsage,
  extractToolName,
  normalizeErrorType,
  _testing: {
    readLogLines,
    isErrorLine,
    isToolLine,
  },
};
