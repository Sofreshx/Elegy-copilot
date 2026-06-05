'use strict';

const fs = require('fs');
const path = require('path');

const SESSION_OVERRIDE_ENV_VAR = 'INSTRUCTION_ENGINE_ELEGY_PLANNING_SESSION_PATH';
const SESSION_FILENAME = 'planning-session.json';

/**
 * Determine if a given value is a non-empty string.
 */
function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Resolve the effective planning session sidecar file path.
 *
 * Priority order (first non-null wins):
 *   1. env.INSTRUCTION_ENGINE_ELEGY_PLANNING_SESSION_PATH (if set and non-empty)
 *   2. path.join(path.dirname(dbPath), 'planning-session.json') (if dbPath provided)
 *   3. path.join(homedir, '.elegy', 'planning-session.json') (legacy default)
 *
 * Returns a single string path.
 */
function resolveSessionSidecarPath(env, homedir, dbPath) {
  const source = env && typeof env === 'object' ? env : {};

  // Priority 1: Environment variable override
  const envOverride = source[SESSION_OVERRIDE_ENV_VAR];
  if (isNonEmptyString(envOverride)) {
    return path.resolve(envOverride.trim());
  }

  // Priority 2: DB-adjacent path
  if (isNonEmptyString(dbPath)) {
    const dbDir = path.dirname(dbPath);
    return path.join(dbDir, SESSION_FILENAME);
  }

  // Priority 3: Legacy fallback under ~/.elegy
  const home = isNonEmptyString(homedir) ? homedir.trim() : '';
  if (home) {
    return path.join(home, '.elegy', SESSION_FILENAME);
  }

  // Absolute last resort — homedir from os.homedir() would be used by callers
  return path.join('.elegy', SESSION_FILENAME);
}

/**
 * Build a candidate path entry for the result.
 */
function buildCandidatePath(filePath, priority, exists) {
  return {
    path: filePath,
    exists: Boolean(exists),
    priority: String(priority),
  };
}

/**
 * Check whether a file path exists on disk.
 */
function pathExists(absPath) {
  try {
    return fs.existsSync(absPath);
  } catch {
    return false;
  }
}

/**
 * Read and parse the planning session sidecar file.
 *
 * opts = { homedir, dbPath }
 *
 * Returns { sidecarPath, exists, sidecar, candidatePaths }.
 * - sidecarPath: the resolved effective path
 * - exists: true if the resolved file exists and was parsed
 * - sidecar: the parsed JSON object, or null
 * - candidatePaths: array of ALL paths considered, in priority order,
 *   each with { path, exists, priority }
 */
function readPlanningSession(env, opts) {
  const options = opts && typeof opts === 'object' ? opts : {};
  const homedir = isNonEmptyString(options.homedir) ? options.homedir.trim() : '';
  const dbPath = isNonEmptyString(options.dbPath) ? options.dbPath.trim() : '';
  const source = env && typeof env === 'object' ? env : {};

  const candidatePaths = [];

  // Priority 1: Environment override
  const envOverride = isNonEmptyString(source[SESSION_OVERRIDE_ENV_VAR])
    ? path.resolve(source[SESSION_OVERRIDE_ENV_VAR].trim())
    : null;
  if (envOverride) {
    candidatePaths.push(buildCandidatePath(envOverride, 1, pathExists(envOverride)));
  }

  // Priority 2: DB-adjacent
  let dbAdjacentPath = null;
  if (dbPath) {
    dbAdjacentPath = path.join(path.dirname(dbPath), SESSION_FILENAME);
    candidatePaths.push(buildCandidatePath(dbAdjacentPath, 2, pathExists(dbAdjacentPath)));
  }

  // Priority 3: Legacy ~/.elegy
  let legacyPath = null;
  if (homedir) {
    legacyPath = path.join(homedir, '.elegy', SESSION_FILENAME);
    candidatePaths.push(buildCandidatePath(legacyPath, 3, pathExists(legacyPath)));
  }

  // Resolve the effective path (first priority that exists, or the highest priority candidate)
  let effectivePath = null;
  for (const candidate of candidatePaths) {
    if (candidate.exists) {
      effectivePath = candidate.path;
      break;
    }
  }

  if (!effectivePath && candidatePaths.length > 0) {
    effectivePath = candidatePaths[0].path;
  }

  if (!effectivePath) {
    return {
      sidecarPath: '',
      exists: false,
      sidecar: null,
      candidatePaths,
    };
  }

  // Try to read and parse the sidecar file
  let sidecar = null;
  let exists = false;
  try {
    const stat = fs.statSync(effectivePath);
    if (stat.isFile()) {
      exists = true;
      const content = fs.readFileSync(effectivePath, 'utf8');
      sidecar = JSON.parse(content);
    }
  } catch {
    sidecar = null;
    exists = false;
  }

  return {
    sidecarPath: effectivePath,
    exists,
    sidecar: sidecar && typeof sidecar === 'object' ? sidecar : null,
    candidatePaths,
  };
}

/**
 * Mirror a planning session sidecar from a default source path to the
 * resolved path, creating the target directory if it does not exist.
 *
 * This is useful for bootstrapping: when a default session file exists
 * but the resolved session path does not, copy it over so that the
 * resolved path becomes the active one.
 *
 * @param {object} options
 * @param {string} options.resolvedPath - The target (resolved) path
 * @param {string} options.defaultSourcePath - The source (default) path
 * @param {string} options.homedir - The user home directory (used if parent dir check fails)
 * @returns {object|null} { copiedFrom, copiedTo } or null
 */
function mirrorSessionSidecar(options) {
  if (!options || typeof options !== 'object') {
    return null;
  }

  const resolvedPath = isNonEmptyString(options.resolvedPath)
    ? options.resolvedPath.trim()
    : null;
  const defaultSourcePath = isNonEmptyString(options.defaultSourcePath)
    ? options.defaultSourcePath.trim()
    : null;

  if (!resolvedPath || !defaultSourcePath) {
    return null;
  }

  // Source must exist
  if (!pathExists(defaultSourcePath)) {
    return null;
  }

  // Target must NOT already exist
  if (pathExists(resolvedPath)) {
    return null;
  }

  // Target parent directory must exist or be creatable
  const targetDir = path.dirname(resolvedPath);
  try {
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
  } catch {
    return null;
  }

  // Perform the copy
  try {
    fs.copyFileSync(defaultSourcePath, resolvedPath);
  } catch {
    return null;
  }

  return {
    copiedFrom: defaultSourcePath,
    copiedTo: resolvedPath,
  };
}

module.exports = {
  resolveSessionSidecarPath,
  readPlanningSession,
  mirrorSessionSidecar,
};
