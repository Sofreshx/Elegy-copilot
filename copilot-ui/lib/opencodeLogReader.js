'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const OPENCODE_DATA_HOME = path.join(os.homedir(), '.local', 'share', 'opencode');
const LOG_DIR = 'log';
const MAX_TAIL_BYTES = 512 * 1024;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function resolveLogDir() {
  return path.join(OPENCODE_DATA_HOME, LOG_DIR);
}

function safeStat(filePath) {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}

function listLogFiles(logDir) {
  try {
    return fs.readdirSync(logDir)
      .filter((name) => name.endsWith('.log'))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

function tailTextLines(filePath, maxLines, maxBytes) {
  const stat = safeStat(filePath);
  if (!stat || !stat.isFile() || stat.size <= 0) {
    return [];
  }

  const byteLimit = maxBytes || MAX_TAIL_BYTES;
  const fd = fs.openSync(filePath, 'r');
  try {
    const chunkSize = 64 * 1024;
    const chunks = [];
    let bytesReadTotal = 0;
    let position = stat.size;
    let newlineCount = 0;
    const targetNewlines = Math.max(1, maxLines) + 4;

    while (position > 0 && newlineCount < targetNewlines && bytesReadTotal < byteLimit) {
      const readSize = Math.min(chunkSize, position);
      position -= readSize;
      const buffer = Buffer.allocUnsafe(readSize);
      fs.readSync(fd, buffer, 0, readSize, position);
      chunks.unshift(buffer);
      bytesReadTotal += readSize;

      for (let i = 0; i < buffer.length; i += 1) {
        if (buffer[i] === 10) {
          newlineCount += 1;
        }
      }
    }

    return Buffer.concat(chunks)
      .toString('utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-maxLines);
  } finally {
    try {
      fs.closeSync(fd);
    } catch {
      // ignore cleanup failures
    }
  }
}

function tailTextAll(filePath, maxBytes) {
  const stat = safeStat(filePath);
  if (!stat || !stat.isFile() || stat.size <= 0) {
    return [];
  }

  const byteLimit = maxBytes || MAX_TAIL_BYTES;
  const readSize = Math.min(byteLimit, stat.size);

  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.allocUnsafe(readSize);
    fs.readSync(fd, buffer, 0, readSize, stat.size - readSize);
    return buffer.toString('utf8').split(/\r?\n/).filter(Boolean);
  } finally {
    try {
      fs.closeSync(fd);
    } catch {
      // ignore cleanup failures
    }
  }
}

function parseLlmEntry(line) {
  if (!line.includes('service=llm')) return null;

  const tokens = line.trim().split(/\s+/);

  if (tokens.length < 8) return null;

  const entry = {
    timestamp: tokens[1] || '',
    level: tokens[0] || 'INFO',
    provider: '',
    model: '',
    agent: '',
    mode: '',
    sessionId: '',
    small: false,
  };

  for (let i = 3; i < tokens.length; i += 1) {
    const eqIndex = tokens[i].indexOf('=');
    if (eqIndex === -1) continue;
    const key = tokens[i].slice(0, eqIndex);
    const value = tokens[i].slice(eqIndex + 1);
    switch (key) {
      case 'providerID':
        entry.provider = value;
        break;
      case 'modelID':
        entry.model = value;
        break;
      case 'agent':
        entry.agent = value;
        break;
      case 'mode':
        entry.mode = value;
        break;
      case 'session.id':
        entry.sessionId = value;
        break;
      case 'small':
        entry.small = value === 'true';
        break;
      default:
        break;
    }
  }

  if (!entry.provider || !entry.model || !entry.agent) return null;

  return entry;
}

function countLlmEntries(logDir) {
  const files = listLogFiles(logDir);
  let total = 0;

  for (const filename of files) {
    const filePath = path.join(logDir, filename);
    const stat = safeStat(filePath);
    if (!stat || !stat.isFile() || stat.size <= 0) continue;

    const fd = fs.openSync(filePath, 'r');
    try {
      const bufferSize = 64 * 1024;
      const buffer = Buffer.allocUnsafe(bufferSize);
      let offset = 0;
      let bytesRead = 0;
      let remainder = '';

      do {
        bytesRead = fs.readSync(fd, buffer, 0, bufferSize, offset);
        offset += bytesRead;
        const chunk = remainder + buffer.toString('utf8', 0, bytesRead);
        const lines = chunk.split(/\r?\n/);
        remainder = lines.pop() || '';

        for (const line of lines) {
          if (line.includes('service=llm')) {
            total += 1;
          }
        }
      } while (bytesRead === bufferSize);

      if (remainder.includes('service=llm')) {
        total += 1;
      }
    } finally {
      try {
        fs.closeSync(fd);
      } catch {
        // ignore cleanup failures
      }
    }
  }

  return total;
}

function readRequestLogs(options = {}) {
  const logDir = typeof options.logDir === 'string' && options.logDir ? options.logDir : resolveLogDir();
  const limit = Math.min(
    Math.max(1, typeof options.limit === 'number' ? options.limit : DEFAULT_LIMIT),
    MAX_LIMIT,
  );
  const since = typeof options.since === 'string' && options.since ? options.since : null;

  const files = listLogFiles(logDir);
  if (files.length === 0) {
    return { requests: [], total: 0, logFiles: 0 };
  }

  const requests = [];

  for (const filename of files) {
    if (requests.length >= limit) break;

    const filePath = path.join(logDir, filename);
    const stat = safeStat(filePath);
    if (!stat || !stat.isFile() || stat.size <= 0) continue;

    const readSize = Math.min(MAX_TAIL_BYTES, stat.size);
    const lines = tailTextAll(filePath, readSize);

    const rawEntries = [];
    for (const line of lines) {
      if (!line.includes('service=llm')) continue;
      const entry = parseLlmEntry(line);
      if (!entry) continue;
      rawEntries.push(entry);
    }

    if (since) {
      rawEntries.reverse();
      for (const entry of rawEntries) {
        if (requests.length >= limit) break;
        if (entry.timestamp <= since) continue;
        requests.unshift(entry);
      }
    } else {
      const needed = limit - requests.length;
      const toAdd = rawEntries.slice(-needed);
      for (const entry of toAdd) {
        requests.push(entry);
      }
    }
  }

  const total = countLlmEntries(logDir);

  return {
    requests: requests.slice(-limit),
    total,
    logFiles: files.length,
  };
}

module.exports = {
  resolveLogDir,
  listLogFiles,
  parseLlmEntry,
  countLlmEntries,
  readRequestLogs,
  DEFAULT_LIMIT,
  MAX_LIMIT,
};
