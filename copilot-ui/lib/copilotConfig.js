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

// --- Collaboration Profile Defaults ---

const COLLABORATION_PROFILE_VERSION = 1;
const DEFAULT_PRESET_ID = 'constructive-coworker';
const MAX_CUSTOM_INSTRUCTIONS_LENGTH = 8000;

const COLLABORATION_DEFAULTS = {
  collaborationProfile: {
    version: COLLABORATION_PROFILE_VERSION,
    enabled: true,
    presetId: DEFAULT_PRESET_ID,
    customInstructions: '',
  },
};

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
 * Uses deep merge for the collaborationProfile object to avoid
 * losing sub-keys when updating individual fields.
 * Writes to a temp file then renames for atomicity on supported platforms.
 */
function writeConfigFields(elegyHome, fields) {
  const configPath = resolveConfigPath(elegyHome);
  const dir = path.dirname(configPath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const existing = readConfig(elegyHome);

  // Deep merge: if both existing and fields have collaborationProfile,
  // merge the nested objects instead of replacing
  const merged = { ...existing };
  for (const key of Object.keys(fields)) {
    if (key === 'collaborationProfile' &&
        existing.collaborationProfile &&
        typeof existing.collaborationProfile === 'object' &&
        typeof fields.collaborationProfile === 'object') {
      merged.collaborationProfile = {
        ...existing.collaborationProfile,
        ...fields.collaborationProfile,
      };
    } else {
      merged[key] = fields[key];
    }
  }

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

// --- Collaboration Profile ---

/**
 * Validate a collaboration profile object.
 * Returns { valid: boolean, error?: string }.
 */
function validateCollaborationProfile(profile) {
  if (!profile || typeof profile !== 'object') {
    return { valid: false, error: 'Profile must be an object' };
  }

  // version
  if (profile.version !== undefined && profile.version !== COLLABORATION_PROFILE_VERSION) {
    return { valid: false, error: `Unsupported profile version: ${profile.version}` };
  }

  // enabled
  if (profile.enabled !== undefined && typeof profile.enabled !== 'boolean') {
    return { valid: false, error: 'enabled must be a boolean' };
  }

  // presetId
  if (profile.presetId !== undefined) {
    if (typeof profile.presetId !== 'string') {
      return { valid: false, error: 'presetId must be a string' };
    }
    if (profile.presetId !== DEFAULT_PRESET_ID) {
      return { valid: false, error: `Unknown preset ID: ${profile.presetId}` };
    }
  }

  // customInstructions
  if (profile.customInstructions !== undefined) {
    if (typeof profile.customInstructions !== 'string') {
      return { valid: false, error: 'customInstructions must be a string' };
    }
    if (profile.customInstructions.includes('\0')) {
      return { valid: false, error: 'customInstructions must not contain NUL characters' };
    }
    if (profile.customInstructions.length > MAX_CUSTOM_INSTRUCTIONS_LENGTH) {
      return { valid: false, error: `customInstructions exceeds maximum length of ${MAX_CUSTOM_INSTRUCTIONS_LENGTH} characters` };
    }
  }

  return { valid: true };
}

/**
 * Get the effective collaboration profile with defaults applied.
 * When the config key is absent, returns the default profile (enabled, constructive-coworker, no custom).
 * Invalid persisted data falls back to defaults without corrupting the config.
 *
 * @param {string|undefined} elegyHome
 * @returns {{ version: number, enabled: boolean, presetId: string, customInstructions: string }}
 */
function getCollaborationProfile(elegyHome) {
  const config = readConfig(elegyHome);
  const persisted = config.collaborationProfile;

  if (!persisted || typeof persisted !== 'object') {
    return { ...COLLABORATION_DEFAULTS.collaborationProfile };
  }

  // Build effective profile with defaults for missing/invalid fields
  const effective = { ...COLLABORATION_DEFAULTS.collaborationProfile };

  if (persisted.version === COLLABORATION_PROFILE_VERSION) {
    effective.version = COLLABORATION_PROFILE_VERSION;
  }

  if (typeof persisted.enabled === 'boolean') {
    effective.enabled = persisted.enabled;
  }

  if (typeof persisted.presetId === 'string' && persisted.presetId === DEFAULT_PRESET_ID) {
    effective.presetId = persisted.presetId;
  }

  if (typeof persisted.customInstructions === 'string') {
    const trimmed = persisted.customInstructions.trim();
    if (!trimmed.includes('\0') && trimmed.length <= MAX_CUSTOM_INSTRUCTIONS_LENGTH) {
      effective.customInstructions = trimmed;
    }
  }

  return effective;
}

/**
 * Validate and persist a collaboration profile update.
 * Returns { saved: boolean, error?: string }.
 *
 * @param {string|undefined} elegyHome
 * @param {{ enabled?: boolean, presetId?: string, customInstructions?: string }} update
 * @returns {{ saved: boolean, error?: string }}
 */
function setCollaborationProfile(elegyHome, update) {
  // Build the full profile to validate
  const current = getCollaborationProfile(elegyHome);
  const candidate = { ...current, ...update };

  const validation = validateCollaborationProfile(candidate);
  if (!validation.valid) {
    return { saved: false, error: validation.error };
  }

  writeConfigFields(elegyHome, { collaborationProfile: candidate });
  return { saved: true };
}

module.exports = {
  resolveConfigPath,
  readConfig,
  writeConfigFields,
  getRemoteSessions,
  setRemoteSessions,
  // Collaboration profile
  COLLABORATION_DEFAULTS,
  COLLABORATION_PROFILE_VERSION,
  DEFAULT_PRESET_ID,
  MAX_CUSTOM_INSTRUCTIONS_LENGTH,
  getCollaborationProfile,
  setCollaborationProfile,
  validateCollaborationProfile,
};
