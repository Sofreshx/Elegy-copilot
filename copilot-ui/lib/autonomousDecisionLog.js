'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const AUTONOMOUS_DECISION_LOG_CONTRACT_VERSION = '1';
const AUTONOMOUS_DECISION_LOG_DIRECTORY = 'runtime';
const AUTONOMOUS_DECISION_LOG_FILENAME = 'autonomous-decisions.jsonl';
const MAX_SUMMARY_LINES = 8;
const MAX_TAIL_BYTES = 128 * 1024;

function safeStat(filePath, fsImpl = fs) {
  try {
    return fsImpl.statSync(filePath);
  } catch {
    return null;
  }
}

function resolveAutonomousDecisionLogPath(elegyHomeAbs, pathImpl = path) {
  return pathImpl.join(
    pathImpl.resolve(elegyHomeAbs),
    AUTONOMOUS_DECISION_LOG_DIRECTORY,
    AUTONOMOUS_DECISION_LOG_FILENAME,
  );
}

function createEventId(cryptoImpl = crypto) {
  if (typeof cryptoImpl.randomUUID === 'function') {
    return cryptoImpl.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function tailJsonlLines(filePath, limit, fsImpl = fs) {
  const stat = safeStat(filePath, fsImpl);
  if (!stat || !stat.isFile() || stat.size <= 0) {
    return [];
  }

  const fd = fsImpl.openSync(filePath, 'r');
  try {
    const chunkSize = 64 * 1024;
    const chunks = [];
    let bytesReadTotal = 0;
    let position = stat.size;
    let newlineCount = 0;
    const targetNewlines = Math.max(1, limit) + 4;

    while (position > 0 && newlineCount < targetNewlines && bytesReadTotal < MAX_TAIL_BYTES) {
      const readSize = Math.min(chunkSize, position);
      position -= readSize;
      const buffer = Buffer.allocUnsafe(readSize);
      fsImpl.readSync(fd, buffer, 0, readSize, position);
      chunks.unshift(buffer);
      bytesReadTotal += readSize;

      for (let index = 0; index < buffer.length; index += 1) {
        if (buffer[index] === 10) {
          newlineCount += 1;
        }
      }
    }

    return Buffer.concat(chunks)
      .toString('utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-limit);
  } finally {
    try {
      fsImpl.closeSync(fd);
    } catch {
      // ignore cleanup failures
    }
  }
}

function countJsonlEntries(filePath, fsImpl = fs) {
  const stat = safeStat(filePath, fsImpl);
  if (!stat || !stat.isFile() || stat.size <= 0) {
    return 0;
  }

  const fd = fsImpl.openSync(filePath, 'r');
  try {
    const bufferSize = 64 * 1024;
    const buffer = Buffer.allocUnsafe(bufferSize);
    let offset = 0;
    let newlineCount = 0;
    let bytesRead = 0;

    do {
      bytesRead = fsImpl.readSync(fd, buffer, 0, bufferSize, offset);
      offset += bytesRead;
      for (let index = 0; index < bytesRead; index += 1) {
        if (buffer[index] === 10) {
          newlineCount += 1;
        }
      }
    } while (bytesRead === bufferSize);

    if (stat.size > 0) {
      const lastByte = Buffer.allocUnsafe(1);
      fsImpl.readSync(fd, lastByte, 0, 1, stat.size - 1);
      if (lastByte[0] !== 10) {
        newlineCount += 1;
      }
    }

    return newlineCount;
  } finally {
    try {
      fsImpl.closeSync(fd);
    } catch {
      // ignore cleanup failures
    }
  }
}

function parseRecentEvents(filePath, fsImpl = fs) {
  return tailJsonlLines(filePath, MAX_SUMMARY_LINES, fsImpl)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function normalizeEvent(input = {}, cryptoImpl = crypto) {
  const source = input && typeof input === 'object' ? input : {};
  const occurredAt = typeof source.occurredAt === 'string' && source.occurredAt.trim()
    ? source.occurredAt.trim()
    : new Date().toISOString();
  const details = source.details && typeof source.details === 'object' ? source.details : null;

  return {
    id: typeof source.id === 'string' && source.id.trim() ? source.id.trim() : createEventId(cryptoImpl),
    occurredAt,
    kind: typeof source.kind === 'string' && source.kind.trim() ? source.kind.trim() : 'autonomous.decision',
    source: typeof source.source === 'string' && source.source.trim() ? source.source.trim() : 'copilot-ui',
    outcome: typeof source.outcome === 'string' && source.outcome.trim() ? source.outcome.trim() : 'recorded',
    summary: typeof source.summary === 'string' && source.summary.trim() ? source.summary.trim() : 'Autonomous decision recorded.',
    details,
  };
}

function buildSummary(logPath, state) {
  const hasEvents = state.eventCount > 0;
  return {
    contractVersion: AUTONOMOUS_DECISION_LOG_CONTRACT_VERSION,
    status: state.lastError ? 'degraded' : hasEvents ? 'healthy' : 'ready',
    path: logPath,
    exists: state.exists,
    eventCount: state.eventCount,
    lastError: state.lastError,
    lastEventId: state.lastEvent && typeof state.lastEvent.id === 'string' ? state.lastEvent.id : null,
    lastEventAt: state.lastEvent && typeof state.lastEvent.occurredAt === 'string' ? state.lastEvent.occurredAt : null,
    lastEventKind: state.lastEvent && typeof state.lastEvent.kind === 'string' ? state.lastEvent.kind : null,
    lastEventOutcome: state.lastEvent && typeof state.lastEvent.outcome === 'string' ? state.lastEvent.outcome : null,
    lastEventSummary: state.lastEvent && typeof state.lastEvent.summary === 'string' ? state.lastEvent.summary : null,
  };
}

function loadSummary(logPath, fsImpl = fs) {
  const stat = safeStat(logPath, fsImpl);
  const recentEvents = parseRecentEvents(logPath, fsImpl);
  const lastEvent = recentEvents.length > 0 ? recentEvents[recentEvents.length - 1] : null;

  return {
    exists: Boolean(stat && stat.isFile()),
    eventCount: stat && stat.isFile() ? countJsonlEntries(logPath, fsImpl) : 0,
    lastEvent,
    lastError: null,
  };
}

function createAutonomousDecisionLog(elegyHomeAbs, deps = {}) {
  const fsImpl = deps.fs || fs;
  const pathImpl = deps.path || path;
  const cryptoImpl = deps.crypto || crypto;
  const logPath = resolveAutonomousDecisionLogPath(elegyHomeAbs, pathImpl);
  let state = loadSummary(logPath, fsImpl);

  return {
    path: logPath,
    getSummary() {
      return buildSummary(logPath, state);
    },
    record(input) {
      const event = normalizeEvent(input, cryptoImpl);

      try {
        fsImpl.mkdirSync(pathImpl.dirname(logPath), { recursive: true });
        fsImpl.appendFileSync(logPath, `${JSON.stringify(event)}\n`, 'utf8');
        state = {
          exists: true,
          eventCount: state.eventCount + 1,
          lastEvent: event,
          lastError: null,
        };
        return {
          ok: true,
          event,
          summary: buildSummary(logPath, state),
        };
      } catch (error) {
        const detail = String(error && error.message ? error.message : error);
        state = {
          ...state,
          lastError: detail,
        };
        return {
          ok: false,
          error: detail,
          summary: buildSummary(logPath, state),
        };
      }
    },
  };
}

module.exports = {
  AUTONOMOUS_DECISION_LOG_CONTRACT_VERSION,
  createAutonomousDecisionLog,
  resolveAutonomousDecisionLogPath,
};