'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HISTORY_MAX = 10;

/**
 * Resolve realpath of repoRoot, SHA256 hash it, return first 12 hex chars.
 *
 * @param {string} repoRoot
 * @returns {string}
 */
function deriveRepoId(repoRoot) {
  const real = fs.realpathSync(repoRoot);
  const hash = crypto.createHash('sha256').update(real, 'utf8').digest('hex');
  return hash.slice(0, 12);
}

/**
 * Compute a git fingerprint for a repo root.
 * Returns { head, dirtyHash } or { head: null, dirtyHash: null } on failure.
 *
 * @param {string} repoRoot
 * @returns {{ head: string|null, dirtyHash: string|null }}
 */
function computeGitFingerprint(repoRoot) {
  try {
    const { execSync } = require('child_process');
    const head = execSync('git rev-parse HEAD', {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
      timeout: 10000,
    }).trim();

    const porcelain = execSync('git status --porcelain', {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
      timeout: 10000,
    }).trim();

    let dirtyHash = null;
    if (porcelain.length > 0) {
      dirtyHash = crypto.createHash('sha256').update(porcelain, 'utf8').digest('hex');
    }

    return { head, dirtyHash };
  } catch {
    return { head: null, dirtyHash: null };
  }
}

/**
 * Compute a SHA256 hash of a config object.
 * Returns hex string, or null if config is null/undefined.
 *
 * @param {Object|null} config
 * @returns {string|null}
 */
function computeConfigHash(config) {
  if (config == null) {
    return null;
  }
  const str = JSON.stringify(config);
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

/**
 * Get the filesystem path for a repoId's check state file.
 *
 * @param {string} repoId
 * @returns {string}
 */
function getStatePath(repoId) {
  return path.join(os.homedir(), '.elegy', 'repo-state', repoId, 'checks', 'state.json');
}

/**
 * Read and parse the check state JSON file.
 * Returns the parsed object, or null if file doesn't exist or is invalid.
 *
 * @param {string} repoId
 * @returns {Object|null}
 */
function readCheckState(repoId) {
  const statePath = getStatePath(repoId);
  try {
    const raw = fs.readFileSync(statePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Build the state object with current timestamp, git fingerprint, config hash, and run result.
 *
 * @param {string} repoId
 * @param {string} repoPath
 * @param {Object} runResult
 * @param {Object|null} config
 * @param {Object|null} ciSyncResult
 * @returns {Object}
 */
function buildState(repoId, repoPath, runResult, config, ciSyncResult) {
  const gitFingerprint = computeGitFingerprint(repoPath);
  const configHash = computeConfigHash(config);

  // Build lanes object from runResult.results array
  const lanes = {};
  if (runResult.results && Array.isArray(runResult.results)) {
    for (const r of runResult.results) {
      lanes[r.checkName] = {
        status: r.status || (r.passed ? 'PASS' : 'FAIL'),
        exitCode: typeof r.exitCode === 'number' ? r.exitCode : null,
        durationMs: typeof r.durationMs === 'number' ? r.durationMs : null,
        details: r.output || r.error || '',
        score: r.score ?? null,
        group: r.group || null,
        blocking: r.blocking !== false,
        ciWorkflow: r.ciWorkflow || null,
        ciJob: r.ciJob || null,
        ciRequired: r.ciRequired === true,
        commands: Array.isArray(r.commands) ? r.commands : [],
      };
    }
  }

  return {
    repoId,
    repoPath,
    lastRun: {
      timestamp: new Date().toISOString(),
      gitFingerprint,
      configHash,
      overallPass: runResult.allPassed !== false,
      compositeScore: runResult.compositeScore,
      lanes,
      groups: runResult.groups || {},
      groupResults: runResult.groupResults || {},
      ciSync: ciSyncResult || null,
    },
    history: [],
  };
}

/**
 * Write check state to disk.
 * Creates directory structure if needed. Preserves and rotates history.
 *
 * @param {string} repoId
 * @param {string} repoPath
 * @param {Object} runResult - raw output from commit-check-run or legacy runner
 * @param {Object|null} config - resolved commit-check config (or null)
 * @param {Object|null} ciSyncResult - result from syncCiState (or null)
 * @returns {Object} the written state object
 */
function writeCheckState(repoId, repoPath, runResult, config, ciSyncResult) {
  const statePath = getStatePath(repoId);
  const stateDir = path.dirname(statePath);

  // Ensure directory exists
  fs.mkdirSync(stateDir, { recursive: true });

  // Read existing state to preserve history
  const existing = readCheckState(repoId);

  // Build new state
  const newState = buildState(repoId, repoPath, runResult, config, ciSyncResult);

  // Transfer and rotate history
  if (existing && existing.lastRun) {
    newState.history = [existing.lastRun, ...(existing.history || [])].slice(0, HISTORY_MAX);
  }

  fs.writeFileSync(statePath, JSON.stringify(newState, null, 2), 'utf8');
  return newState;
}

/**
 * Check freshness of the last run against the current git state and config.
 *
 * @param {string} repoId
 * @param {string} repoPath
 * @param {Object|null} config
 * @returns {{ fresh: boolean, reason: string, lastRun?: Object }}
 */
function checkFreshness(repoId, repoPath, config) {
  const state = readCheckState(repoId);
  if (!state || !state.lastRun) {
    return { fresh: false, reason: 'no-prior-run' };
  }

  const currentFingerprint = computeGitFingerprint(repoPath);
  const currentConfigHash = computeConfigHash(config);

  if (currentFingerprint.head !== state.lastRun.gitFingerprint.head) {
    return { fresh: false, reason: 'head-changed' };
  }
  if (currentFingerprint.dirtyHash !== state.lastRun.gitFingerprint.dirtyHash) {
    return { fresh: false, reason: 'working-tree-changed' };
  }
  if (currentConfigHash !== state.lastRun.configHash) {
    return { fresh: false, reason: 'config-changed' };
  }

  return { fresh: true, reason: 'fresh', lastRun: state.lastRun };
}

/**
 * Convenience: read state, check freshness, return combined result.
 *
 * @param {string} repoId
 * @param {string} repoPath
 * @param {Object|null} config
 * @returns {{ repoId: string, repoPath: string, hasState: boolean, lastRun: Object|null, freshness: { fresh: boolean, reason: string }, history: Array }}
 */
function getCheckState(repoId, repoPath, config) {
  const state = readCheckState(repoId);
  const hasState = !!state;
  const lastRun = state ? state.lastRun : null;
  const history = state ? state.history || [] : [];
  const freshness = hasState ? checkFreshness(repoId, repoPath, config) : { fresh: false, reason: 'no-state' };

  return {
    repoId,
    repoPath,
    hasState,
    lastRun,
    freshness,
    history,
  };
}

module.exports = {
  deriveRepoId,
  computeGitFingerprint,
  computeConfigHash,
  getStatePath,
  readCheckState,
  writeCheckState,
  checkFreshness,
  getCheckState,
};
