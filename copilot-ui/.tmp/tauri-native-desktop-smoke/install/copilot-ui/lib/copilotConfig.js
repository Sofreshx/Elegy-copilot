'use strict';

/**
 * Read/write ~/.copilot/config.json — the CLI's native config file.
 * Supports atomic read-modify-write with unknown-key preservation.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULT_COPILOT_HOME = path.join(os.homedir(), '.copilot');
const CONFIG_FILENAME = 'config.json';

function resolveConfigPath(copilotHome) {
  const home = copilotHome || DEFAULT_COPILOT_HOME;
  return path.join(home, CONFIG_FILENAME);
}

/**
 * Read the entire config.json, returning a plain object.
 * Returns {} if the file doesn't exist or is invalid JSON.
 */
function readConfig(copilotHome) {
  const configPath = resolveConfigPath(copilotHome);
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
function writeConfigFields(copilotHome, fields) {
  const configPath = resolveConfigPath(copilotHome);
  const dir = path.dirname(configPath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const existing = readConfig(copilotHome);
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
function getRemoteSessions(copilotHome) {
  const config = readConfig(copilotHome);
  return config.remoteSessions === true;
}

/**
 * Set the remoteSessions preference in config.json.
 * @param {string|undefined} copilotHome
 * @param {boolean} enabled
 */
function setRemoteSessions(copilotHome, enabled) {
  writeConfigFields(copilotHome, { remoteSessions: Boolean(enabled) });
}

module.exports = {
  resolveConfigPath,
  readConfig,
  writeConfigFields,
  getRemoteSessions,
  setRemoteSessions,
};
