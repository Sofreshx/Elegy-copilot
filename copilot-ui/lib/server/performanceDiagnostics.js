'use strict';

const { sendJson: defaultSendJson } = require('../../routes/_helpers');

const MAX_RECENT_DURATIONS = 256;
const SAFE_API_AREAS = new Set([
  'assets', 'catalog', 'checks', 'config', 'dashboard', 'diagnostics', 'execution', 'executor',
  'git', 'health', 'notes', 'opencode', 'planning', 'remote', 'repo-operations',
  'sessions', 'telemetry', 'tooling', 'tooling-updates', 'workspace',
]);

function classifyPath(pathname) {
  const segments = String(pathname || '').split('/').filter(Boolean);
  if (segments[0] !== 'api') return 'static';
  const area = SAFE_API_AREAS.has(segments[1]) ? segments[1] : 'other';
  return `api.${area}`;
}

function percentile(values, percentileValue) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * percentileValue) - 1));
  return Number(sorted[index].toFixed(1));
}

function createPerformanceDiagnostics(options = {}) {
  const processService = options.processService || null;
  const startedAt = Date.now();
  const requestStats = {
    total: 0,
    active: 0,
    totalDurationMs: 0,
    byArea: Object.create(null),
    byStatusClass: Object.create(null),
    recentDurations: [],
  };

  function beginRequest(req, res, pathname) {
    const requestStartedAt = process.hrtime.bigint();
    const area = classifyPath(pathname);
    requestStats.active += 1;
    let timingWritten = false;
    let finished = false;

    const writeTiming = () => {
      if (timingWritten || res.headersSent) return;
      timingWritten = true;
      const durationMs = Number(process.hrtime.bigint() - requestStartedAt) / 1e6;
      // Only a fixed metric name and duration are emitted. Paths, commands,
      // arguments, repository names, and query values never enter the header.
      if (typeof res.setHeader === 'function') {
        res.setHeader('Server-Timing', `app;dur=${durationMs.toFixed(1)}`);
      }
    };

    const originalWriteHead = res.writeHead;
    res.writeHead = function writeHeadWithTiming(...args) {
      writeTiming();
      return originalWriteHead.apply(this, args);
    };
    const originalEnd = res.end;
    res.end = function endWithTiming(...args) {
      writeTiming();
      return originalEnd.apply(this, args);
    };

    const finish = () => {
      if (finished) return;
      finished = true;
      requestStats.active = Math.max(0, requestStats.active - 1);
      const durationMs = Number(process.hrtime.bigint() - requestStartedAt) / 1e6;
      requestStats.total += 1;
      requestStats.totalDurationMs += durationMs;
      requestStats.byArea[area] = (requestStats.byArea[area] || 0) + 1;
      const statusClass = `${Math.floor(Number(res.statusCode || 0) / 100)}xx`;
      requestStats.byStatusClass[statusClass] = (requestStats.byStatusClass[statusClass] || 0) + 1;
      requestStats.recentDurations.push(durationMs);
      if (requestStats.recentDurations.length > MAX_RECENT_DURATIONS) requestStats.recentDurations.shift();
    };
    res.once('finish', finish);
    res.once('close', finish);
  }

  function getSnapshot() {
    const completed = requestStats.total;
    return {
      schemaVersion: 'performance-diagnostics/v1',
      generatedAt: new Date().toISOString(),
      uptimeSeconds: Number(((Date.now() - startedAt) / 1000).toFixed(1)),
      requests: {
        total: completed,
        active: requestStats.active,
        averageDurationMs: completed > 0
          ? Number((requestStats.totalDurationMs / completed).toFixed(1))
          : 0,
        p95DurationMs: percentile(requestStats.recentDurations, 0.95),
        byArea: { ...requestStats.byArea },
        byStatusClass: { ...requestStats.byStatusClass },
      },
      processes: processService && typeof processService.getDiagnostics === 'function'
        ? processService.getDiagnostics()
        : null,
      redaction: {
        paths: true,
        queryValues: true,
        commandsAndArguments: true,
      },
    };
  }

  function register(context = {}) {
    const sendJson = context.sendJson || defaultSendJson;
    return [{
      method: 'GET',
      path: '/api/diagnostics/performance',
      handler: (ctx) => sendJson(ctx.res, 200, getSnapshot()),
    }];
  }

  return { beginRequest, getSnapshot, register };
}

module.exports = { createPerformanceDiagnostics, classifyPath };
