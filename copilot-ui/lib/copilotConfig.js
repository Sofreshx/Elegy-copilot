'use strict';

/**
 * Read/write ~/.elegy/config.json — the CLI's native config file.
 * Supports atomic read-modify-write with unknown-key preservation.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULT_ELEGY_HOME = path.join(os.homedir(), '.elegy');
const CONFIG_FILENAME = 'config.json';

function resolveConfigPath(elegyHome) {
  const home = elegyHome || DEFAULT_ELEGY_HOME;
  return path.join(home, CONFIG_FILENAME);
}

/**
 * Read the entire config.json, returning a plain object.
 * Returns {} if the file doesn't exist or is invalid JSON.
 */
function readConfig(elegyHome) {
  const configPath = resolveConfigPath(elegyHome);
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Atomically merge fields into config.json, preserving unknown keys.
 * Writes to a temp file then renames for atomicity on supported platforms.
 */
function writeConfigFields(elegyHome, fields) {
  const configPath = resolveConfigPath(elegyHome);
  const dir = path.dirname(configPath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const existing = readConfig(elegyHome);
  const merged = { ...existing, ...fields };
  const json = JSON.stringify(merged, null, 2) + '\n';

  const tmpPath = configPath + '.tmp.' + process.pid;
  try {
    fs.writeFileSync(tmpPath, json, 'utf8');
    fs.renameSync(tmpPath, configPath);
  } catch (err) {
    // Clean up temp file on failure
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    throw err;
  }
}

/**
 * Get the remoteSessions preference from config.json.
 * @returns {boolean}
 */
function getRemoteSessions(elegyHome) {
  const config = readConfig(elegyHome);
  return config.remoteSessions === true;
}

/**
 * Set the remoteSessions preference in config.json.
 * @param {string|undefined} elegyHome
 * @param {boolean} enabled
 */
function setRemoteSessions(elegyHome, enabled) {
  writeConfigFields(elegyHome, { remoteSessions: Boolean(enabled) });
}

module.exports = {
  resolveConfigPath,
  readConfig,
  writeConfigFields,
  getRemoteSessions,
  setRemoteSessions,
};
