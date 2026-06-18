'use strict';

/**
 * Log reader for Kimaki log files.
 * Reads the last N lines of a log file.
 */

const fs = require('fs');

/**
 * Tail the last N lines of a log file.
 * @param {string} logPath - Path to log file
 * @param {number} [maxLines=50] - Maximum lines to read
 * @returns {string[]} Last N lines
 */
function tailLog(logPath, maxLines = 50) {
  if (!fs.existsSync(logPath)) {
    return [];
  }

  try {
    const content = fs.readFileSync(logPath, 'utf8');
    const lines = content.split('\n').filter(Boolean);
    return lines.slice(-maxLines);
  } catch {
    return [];
  }
}

module.exports = { tailLog };
