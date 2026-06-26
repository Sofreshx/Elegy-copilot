'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const LOG_DIR = path.join(os.homedir(), '.elegy', 'logs');
const LOG_RETENTION_DAYS = 7;
const MAX_LOG_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

let cleanupTimer = null;

function getLogFilePath(date) {
  const d = date || new Date();
  const dateStr = d.toISOString().slice(0, 10);
  return path.join(LOG_DIR, `install-${dateStr}.log`);
}

function ensureLogDir() {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  } catch {
    // best-effort
  }
}

function formatTimestamp(date) {
  return (date || new Date()).toISOString();
}

function appendLog(level, operation, message, details) {
  ensureLogDir();
  const logFile = getLogFilePath();
  const timestamp = formatTimestamp();
  const detailStr = details ? ` ${JSON.stringify(details)}` : '';
  const line = `[${timestamp}] [${level}] [${operation}] ${message}${detailStr}\n`;

  try {
    // Truncate if file exceeds max size (keep last half)
    try {
      const stat = fs.statSync(logFile);
      if (stat.size > MAX_LOG_FILE_SIZE_BYTES) {
        const content = fs.readFileSync(logFile, 'utf8');
        const lines = content.split('\n');
        const half = Math.floor(lines.length / 2);
        fs.writeFileSync(logFile, lines.slice(half).join('\n'), 'utf8');
      }
    } catch {
      // file doesn't exist yet or read error — proceed with append
    }
    fs.appendFileSync(logFile, line, 'utf8');
  } catch {
    // best-effort — don't fail the operation if logging fails
  }
}

function logInfo(operation, message, details) {
  appendLog('INFO', operation, message, details);
}

function logWarn(operation, message, details) {
  appendLog('WARN', operation, message, details);
}

function logError(operation, message, details) {
  appendLog('ERROR', operation, message, details);
}

function cleanupOldLogs() {
  ensureLogDir();
  try {
    const cutoff = Date.now() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const files = fs.readdirSync(LOG_DIR);
    for (const file of files) {
      if (!file.startsWith('install-') || !file.endsWith('.log')) continue;
      const filePath = path.join(LOG_DIR, file);
      try {
        const stat = fs.statSync(filePath);
        if (stat.mtimeMs < cutoff) {
          fs.unlinkSync(filePath);
        }
      } catch {
        // best-effort
      }
    }
  } catch {
    // best-effort
  }
}

function startPeriodicCleanup() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    cleanupOldLogs();
  }, CLEANUP_INTERVAL_MS);
  // Allow process to exit even if timer is running
  if (cleanupTimer.unref) {
    cleanupTimer.unref();
  }
}

function stopPeriodicCleanup() {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}

function getLogDir() {
  return LOG_DIR;
}

function readLog(date) {
  const logFile = getLogFilePath(date);
  try {
    return fs.readFileSync(logFile, 'utf8');
  } catch {
    return null;
  }
}

module.exports = {
  logInfo,
  logWarn,
  logError,
  cleanupOldLogs,
  startPeriodicCleanup,
  stopPeriodicCleanup,
  getLogDir,
  readLog,
  getLogFilePath,
};
