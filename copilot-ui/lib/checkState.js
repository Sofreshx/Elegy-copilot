'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readGitEvidence } = require('./gitEvidence');

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
 * Returns { branch, head, dirtyHash } or null fields on failure.
 *
 * @param {string} repoRoot
 * @returns {{ head: string|null, dirtyHash: string|null }}
 */
function computeGitFingerprint(repoRoot) {
  const evidence = readGitEvidence(repoRoot);
  return { branch: evidence.branch, head: evidence.head, dirtyHash: evidence.dirtyHash };
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
        required: r.required !== false,
        skippable: r.skippable || false,
        cost: r.cost || 'fast',
        opensWindow: r.opensWindow || false,
        defaultProfiles: r.defaultProfiles || [],
      };
    }
  }

  return {
    repoId,
    repoPath,
    lastRun: {
      timestamp: new Date().toISOString(),
      gitFingerprint: {
        branch: runResult.branch || gitFingerprint.branch,
        head: runResult.head || gitFingerprint.head,
        dirtyHash: runResult.dirtyHash || gitFingerprint.dirtyHash,
      },
      configHash,
      planHash: runResult.planHash || runResult.planIdentity?.hash || null,
      action: runResult.action || null,
      selectionMode: runResult.selectionMode || null,
      runnerVersion: runResult.runnerVersion || null,
      source: runResult.sourceKind || runResult.source || 'local',
      overallPass: runResult.allPassed !== false,
      gatePassed: runResult.gatePassed ?? (runResult.allPassed !== false),
      compositeScore: runResult.compositeScore,
      passesThreshold: runResult.passesThreshold ?? null,
      profile: runResult.profile || null,
      lanes,
      groups: runResult.groups || {},
      groupResults: runResult.groupResults || {},
      requiredFailures: runResult.requiredFailures || [],
      blockingFailures: runResult.blockingFailures || runResult.requiredFailures || [],
      skippedLanes: runResult.skippedLanes || {},
      overrideReasons: runResult.overrideReasons || {},
      logs: runResult.logs || [],
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
function checkFreshness(repoId, repoPath, config, profile, planHash) {
  const state = readCheckState(repoId);
  if (!state || !state.lastRun) {
    return { fresh: false, reason: 'no-prior-run' };
  }

  const currentFingerprint = computeGitFingerprint(repoPath);
  const currentConfigHash = computeConfigHash(config);
  const previousFingerprint = state.lastRun.gitFingerprint || {};

  if (currentFingerprint.branch !== previousFingerprint.branch) {
    return { fresh: false, reason: 'branch-changed' };
  }
  if (currentFingerprint.head !== previousFingerprint.head) {
    return { fresh: false, reason: 'head-changed' };
  }
  if (currentFingerprint.dirtyHash !== previousFingerprint.dirtyHash) {
    return { fresh: false, reason: 'working-tree-changed' };
  }
  if (currentConfigHash !== state.lastRun.configHash) {
    return { fresh: false, reason: 'config-changed' };
  }
  if (state.lastRun.planHash) {
    const currentPlanHash = resolveCurrentPlanHash(repoPath, state.lastRun, planHash);
    if (currentPlanHash && currentPlanHash !== state.lastRun.planHash) {
      return { fresh: false, reason: 'plan-changed' };
    }
  }
  if (profile && state.lastRun.profile !== profile) {
    return { fresh: false, reason: 'different-profile' };
  }

  return { fresh: true, reason: 'fresh', lastRun: state.lastRun };
}

function resolveCurrentPlanHash(repoPath, lastRun, explicitPlanHash) {
  if (typeof explicitPlanHash === 'string' && explicitPlanHash.length > 0) return explicitPlanHash;
  try {
    const { discoverCheckPlan } = require('./checkPlanService');
    const action = ['commit', 'push', 'ci-local', 'release'].includes(lastRun.action)
      ? lastRun.action
      : lastRun.profile === 'push'
        ? 'push'
        : lastRun.profile === 'release'
          ? 'release'
          : 'commit';
    return discoverCheckPlan(repoPath, { action }).planHash || null;
  } catch {
    return null;
  }
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
