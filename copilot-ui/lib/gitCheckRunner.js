'use strict';

let fs = require('fs');
const path = require('path');
let { execFile } = require('child_process');
const { syncCiState } = require('./ciSync');
const { resolveCommitCheckConfig } = require('./commitCheckConfig');



/**
 * Run checks via the canonical commit-check-run.mjs script.
 * Transforms the script's JSON output into the API response shape.
 */
function runCanonicalChecks(repoRoot, config, options) {
  return new Promise((resolve) => {
    const scriptPath = path.join(repoRoot, 'scripts', 'commit-check-run.mjs');
    if (!fs.existsSync(scriptPath)) {
      // Script not found — fall back to legacy
      resolve(runAllChecksLegacy(repoRoot));
      return;
    }

    const args = ['--json', '--repo', repoRoot];
    if (options) {
      if (options.profile) args.push('--profile', options.profile);
      if (options.selectedLanes) args.push('--lane', options.selectedLanes);
      if (options.selectedGroup) args.push('--group', options.selectedGroup);
      if (options.skipLanes && options.skipLanes.size > 0) {
        for (const [lane, reason] of options.skipLanes) {
          args.push('--reason', reason, '--skip', lane);
        }
      }
    }
    const timeoutMs = resolveCanonicalRunTimeout(config, options);
    const child = execFile('node', [scriptPath, ...args], {
      cwd: repoRoot,
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    }, (error, stdout, stderr) => {
      let parsed;
      try {
        parsed = JSON.parse((stdout || '').trim());
      } catch {
        const stdoutText = (stdout || '').trim();
        const stderrText = (stderr || '').trim();
        const diagnostic = error && error.killed
          ? `commit-check process timed out after ${Math.round(timeoutMs / 1000)}s.`
          : 'commit-check process did not return valid JSON.';
        // JSON parse failed — return error
        resolve({
          repoRoot,
          source: 'commit-check',
          checkedAt: new Date().toISOString(),
          checksAvailable: 0,
          checksRun: 0,
          checksPassed: 0,
          checksFailed: 0,
          allPassed: false,
          results: [],
          errorOutput: [
            diagnostic,
            stderrText ? `stderr:\n${tail(stderrText)}` : '',
            stdoutText ? `stdout tail:\n${tail(stdoutText)}` : '',
          ].filter(Boolean).join('\n\n'),
          message: `Failed to parse commit-check output: ${diagnostic}`,
        });
        return;
      }

      const lanes = parsed.lanes || {};
      const laneNames = Object.keys(lanes);
      const results = laneNames.map((name) => {
        const lane = lanes[name];
        const status = String(lane.status || '').toUpperCase();
        const passed = status === 'PASS' || status === 'SKIP';
        return {
          checkName: name,
          status,
          passed,
          exitCode: typeof lane.exitCode === 'number' ? lane.exitCode : undefined,
          durationMs: typeof lane.durationMs === 'number' ? lane.durationMs : undefined,
          error: status === 'FAIL' ? (lane.details || 'Check failed') : undefined,
          output: lane.details || '',
          score: lane.score,
          commands: Array.isArray(lane.commands) ? lane.commands : [],
          group: lane.group || null,
          blocking: lane.blocking !== false,
          ciWorkflow: lane.ciWorkflow || null,
          ciJob: lane.ciJob || null,
          ciRequired: lane.ciRequired || false,
          required: lane.required !== false,
          skippable: lane.skippable || false,
          cost: lane.cost || 'fast',
          opensWindow: lane.opensWindow || false,
          defaultProfiles: lane.defaultProfiles || [],
        };
      });

      const failed = parsed.overallPass === false
        ? results.filter((r) => !r.passed).length
        : 0;
      const passed = results.length - failed;

      resolve({
        repoRoot,
        source: 'commit-check',
        checkedAt: parsed.timestamp || new Date().toISOString(),
        threshold: parsed.threshold,
        compositeScore: parsed.compositeScore,
        anyGateFailed: parsed.anyGateFailed === true,
        checksAvailable: laneNames.length,
        checksRun: results.length,
        checksPassed: passed,
        checksFailed: failed,
        allPassed: parsed.overallPass !== false,
        groups: parsed.groups || {},
        groupResults: parsed.groupResults || {},
        profile: parsed.profile || (options ? options.profile : null) || null,
        requiredFailures: parsed.requiredFailures || [],
        skippedLanes: parsed.skippedLanes || {},
        overrideReasons: parsed.overrideReasons || {},
        logs: parsed.logs || [],
        errorOutput: parsed.errorOutput || null,
        results,
        message: failed === 0
          ? `All ${passed} lanes passed (score: ${parsed.compositeScore ?? 'N/A'}).`
          : `${failed} of ${results.length} lanes failed.`,
      });
    });
  });
}

function normalizeSelectedLanes(selectedLanes) {
  if (!selectedLanes) return null;
  if (Array.isArray(selectedLanes)) return selectedLanes;
  return [selectedLanes];
}

function resolveCanonicalRunTimeout(config, options = {}) {
  const lanes = config?.lanes && typeof config.lanes === 'object' ? config.lanes : {};
  let laneNames = Object.keys(lanes).filter((name) => lanes[name]?.enabled !== false);

  if (options.profile) {
    laneNames = laneNames.filter((name) => {
      const profiles = lanes[name]?.defaultProfiles;
      return Array.isArray(profiles) && profiles.includes(options.profile);
    });
  }

  const selectedLanes = normalizeSelectedLanes(options.selectedLanes);
  if (selectedLanes) {
    laneNames = laneNames.filter((name) => selectedLanes.includes(name));
  }

  if (options.selectedGroup) {
    laneNames = laneNames.filter((name) => lanes[name]?.group === options.selectedGroup);
  }

  if (options.skipLanes && options.skipLanes.size > 0) {
    laneNames = laneNames.filter((name) => !options.skipLanes.has(name));
  }

  const summedTimeout = laneNames.reduce((sum, name) => {
    const timeout = Number(lanes[name]?.timeoutMs);
    return sum + (Number.isFinite(timeout) && timeout > 0 ? timeout : 120000);
  }, 0);

  const overheadMs = Math.max(30000, laneNames.length * 5000);
  return Math.min(Math.max(summedTimeout + overheadMs, 120000), 30 * 60 * 1000);
}

function tail(value, maxLength = 4000) {
  if (value.length <= maxLength) return value;
  return value.slice(value.length - maxLength);
}

const RUN_TIMEOUT_MS = 30000;

/**
 * Discover available checks for a repo root by checking file existence.
 */
function discoverChecks(repoRoot) {
  // Prefer canonical config
  const config = resolveCommitCheckConfig(repoRoot);
  if (config && config.lanes) {
    const laneNames = Object.keys(config.lanes).filter((name) => config.lanes[name].enabled !== false);
    const checks = laneNames.map((name) => {
      const lane = config.lanes[name];
      return {
        name,
        path: (lane.commands || []).join(', ') || '(configured)',
        fullPath: '',
        description: lane.description || '',
        group: lane.group || null,
        cwd: lane.cwd || null,
        timeoutMs: lane.timeoutMs || null,
        blocking: lane.blocking !== false,
        ciWorkflow: lane.ciWorkflow || null,
        ciJob: lane.ciJob || null,
        ciRequired: lane.ciRequired || false,
        source: 'commit-check',
        required: lane.required !== false,
        skippable: lane.skippable || false,
        requiresReasonOnSkip: lane.requiresReasonOnSkip !== false,
        defaultProfiles: lane.defaultProfiles || [],
        cost: lane.cost || 'fast',
        opensWindow: lane.opensWindow || false,
      };
    });
    checks.groups = config.groups || {};
    checks.profiles = config.profiles || {};
    return checks;
  }

  const available = [];

  // Also check for .githooks/ directory existence
  const hooksDir = path.join(repoRoot, '.githooks');
  if (fs.existsSync(hooksDir)) {
    const preCommit = path.join(hooksDir, 'pre-commit');
    const prePush = path.join(hooksDir, 'pre-push');
    if (fs.existsSync(preCommit)) {
      available.push({
        name: 'git-hooks-pre-commit',
        path: '.githooks/pre-commit',
        fullPath: preCommit,
        description: 'Pre-commit hook: fast validation',
        source: 'legacy',
      });
    }
    if (fs.existsSync(prePush)) {
      available.push({
        name: 'git-hooks-pre-push',
        path: '.githooks/pre-push',
        fullPath: prePush,
        description: 'Pre-push hook: full validation',
        source: 'legacy',
      });
    }
  }

  return available;
}

/**
 * Run a single check script and return results.
 */
function runCheck(check, repoRoot) {
  return new Promise((resolve) => {
    const ext = path.extname(check.path).toLowerCase();
    let command;
    let args;

    if (ext === '.ps1') {
      command = 'pwsh';
      args = ['-NoProfile', '-NonInteractive', '-Command', `& '${check.fullPath}' -RepoRoot '${repoRoot}'`];
    } else if (ext === '.sh' || check.path.includes('pre-commit') || check.path.includes('pre-push')) {
      command = 'bash';
      args = [check.fullPath];
    } else if (ext === '.js') {
      command = 'node';
      args = [check.fullPath];
    } else {
      command = check.fullPath;
      args = [];
    }

    const child = execFile(command, args, {
      cwd: repoRoot,
      timeout: RUN_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    }, (error, stdout, stderr) => {
      const output = (stdout || '').trim();
      const errOutput = (stderr || '').trim();
      const combined = [output, errOutput].filter(Boolean).join('\n');
      
      if (error) {
        // Check if it was a timeout
        if (error.killed) {
          resolve({
            checkName: check.name,
            passed: false,
            error: `Check timed out after ${RUN_TIMEOUT_MS / 1000}s`,
            output: combined,
          });
        } else {
          // Non-zero exit = check failed
          resolve({
            checkName: check.name,
            passed: false,
            error: error.message,
            output: combined,
          });
        }
      } else {
        resolve({
          checkName: check.name,
          passed: true,
          output: combined,
        });
      }
    });
  });
}

/**
 * Run all discovered checks for a repo and return aggregated results.
 */
async function runAllChecksLegacy(repoRoot) {
  const checks = discoverChecks(repoRoot);
  if (checks.length === 0) {
    return {
      repoRoot,
      source: 'none',
      checkedAt: new Date().toISOString(),
      checksAvailable: 0,
      checksRun: 0,
      checksPassed: 0,
      checksFailed: 0,
      allPassed: true,
      results: [],
      message: 'No validation checks discovered for this repository.',
    };
  }

  const results = await Promise.all(checks.map((check) => runCheck(check, repoRoot)));
  
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  return {
    repoRoot,
    source: 'legacy',
    checkedAt: new Date().toISOString(),
    checksAvailable: checks.length,
    checksRun: results.length,
    checksPassed: passed,
    checksFailed: failed,
    allPassed: failed === 0,
    results,
    message: failed === 0
      ? `All ${passed} checks passed.`
      : `${failed} of ${results.length} checks failed.`,
  };
}

/**
 * Run all checks — prefer canonical config, fall back to legacy.
 */
async function runAllChecks(repoRoot) {
  const config = resolveCommitCheckConfig(repoRoot);
  if (config) {
    return runCanonicalChecks(repoRoot, config);
  }
  return runAllChecksLegacy(repoRoot);
}

/**
 * Run all checks with profile/skip options.
 * Routes through canonical checks with the provided profile options.
 */
async function runAllChecksWithProfile(repoRoot, options) {
  const config = resolveCommitCheckConfig(repoRoot);
  if (config) {
    return runCanonicalChecks(repoRoot, config, options);
  }
  return runAllChecksLegacy(repoRoot);
}

/**
 * Run checks before a git action (commit, push, PR).
 * Returns { allowed: boolean, checkResults, requiresOverride: boolean }
 */
async function gateGitAction(repoRoot, action, unsafeOverride, profile, branchName) {
  // Resolve branch name if not provided
  if (!branchName) {
    branchName = getCurrentBranch(repoRoot);
  }
  const isProtected = isProtectedBranch(repoRoot, branchName);

  // PR creation: never allow unsafe override
  if (action === 'pull-request' && unsafeOverride && typeof unsafeOverride.reason === 'string') {
    return {
      allowed: false,
      skipped: false,
      checkResults: null,
      requiresOverride: false,
      overrideBlocked: true,
      message: 'Unsafe override is not allowed for pull request creation. All checks must pass.',
    };
  }

  // Push to protected branch: never allow unsafe override  
  if (action === 'push' && isProtected && unsafeOverride && typeof unsafeOverride.reason === 'string') {
    return {
      allowed: false,
      skipped: false,
      checkResults: null,
      requiresOverride: false,
      overrideBlocked: true,
      protectedBranch: true,
      message: 'Unsafe override is not allowed when pushing to a protected branch (' + branchName + '). All checks must pass with the ci-local profile.',
    };
  }

  // Unsafe override for commit or non-protected push: allowed
  if (unsafeOverride && typeof unsafeOverride.reason === 'string' && unsafeOverride.reason.trim().length > 0) {
    return {
      allowed: true,
      skipped: true,
      overrideReason: unsafeOverride.reason.trim(),
      checkResults: null,
      message: `Checks skipped due to unsafe override: "${unsafeOverride.reason.trim()}"`,
    };
  }

  // Freshness check — reuse prior cached results if git state hasn't changed
  try {
    const { deriveRepoId, checkFreshness } = require('./checkState');
    const repoId = deriveRepoId(repoRoot);
    const config = resolveCommitCheckConfig(repoRoot);
    const freshness = checkFreshness(repoId, repoRoot, config, profile);

    if (freshness.fresh && freshness.lastRun.overallPass) {
      // Prior run is fresh and passed — reconstruct cached results from stored lanes
      const cachedLanes = freshness.lastRun.lanes || {};
      const laneNames = Object.keys(cachedLanes);
      const cachedResults = {
        repoRoot,
        source: freshness.lastRun.configHash ? 'commit-check' : 'legacy',
        checkedAt: freshness.lastRun.timestamp,
        checksAvailable: laneNames.length,
        checksRun: laneNames.length,
        checksPassed: laneNames.filter((n) => cachedLanes[n].status === 'PASS').length,
        checksFailed: laneNames.filter((n) => cachedLanes[n].status !== 'PASS').length,
        allPassed: true,
        groups: freshness.lastRun.groups || {},
        groupResults: freshness.lastRun.groupResults || {},
        profile: freshness.lastRun.profile || null,
        requiredFailures: freshness.lastRun.requiredFailures || [],
        skippedLanes: freshness.lastRun.skippedLanes || {},
        overrideReasons: freshness.lastRun.overrideReasons || {},
        logs: freshness.lastRun.logs || [],
        results: laneNames.map((name) => ({
          checkName: name,
          passed: cachedLanes[name].status === 'PASS',
          error: cachedLanes[name].status === 'FAIL' ? (cachedLanes[name].details || 'Check failed') : undefined,
          output: cachedLanes[name].details || '',
          score: cachedLanes[name].score,
          group: cachedLanes[name].group,
          blocking: cachedLanes[name].blocking,
          ciWorkflow: cachedLanes[name].ciWorkflow,
          ciJob: cachedLanes[name].ciJob,
          ciRequired: cachedLanes[name].ciRequired,
          required: cachedLanes[name].required !== false,
          skippable: cachedLanes[name].skippable || false,
          cost: cachedLanes[name].cost || 'fast',
          opensWindow: cachedLanes[name].opensWindow || false,
          defaultProfiles: cachedLanes[name].defaultProfiles || [],
        })),
        message: 'Using cached check results (no changes since last run).',
        cached: true,
      };

      // CI gap detection still runs on cached results
      try {
        const syncResult = syncCiState(repoRoot);
        if (syncResult.syncResult.summary.readiness === 'ci-gap') {
          return {
            allowed: false,
            skipped: false,
            checkResults: cachedResults,
            requiresOverride: true,
            ciGap: true,
            ciGapDetails: syncResult.syncResult.mappings.filter((m) => m.status === 'ci-gap'),
            message: `CI gap detected: ${syncResult.syncResult.summary.gaps} CI job(s) (${syncResult.syncResult.mappings.filter((m) => m.status === 'ci-gap').map((m) => m.workflowFile + '/' + m.jobName).join(', ')}) not mapped to local lanes. Provide an override reason to proceed anyway.`,
          };
        }
      } catch {
        // ciSync failure is non-blocking
      }

      return {
        allowed: true,
        skipped: false,
        checkResults: cachedResults,
        message: 'All pre-action checks passed (cached).',
      };
    }
  } catch {
    // Freshness check failure is non-blocking — run checks normally
  }

  // ── Push to protected branch: must have fresh ci-local ──
  if (action === 'push' && isProtected) {
    // Force profile to ci-local for protected pushes, regardless of what was passed
    profile = 'ci-local';
    
    // Run checks NOW (we're past the freshness cache check)
    const protectedResults = await runAllChecksWithProfile(repoRoot, { profile: 'ci-local' });
    
    if (!protectedResults.allPassed) {
      return {
        allowed: false,
        skipped: false,
        checkResults: protectedResults,
        requiresOverride: false,
        overrideBlocked: true,
        protectedBranch: true,
        message: `Push to protected branch "${branchName}" blocked: ci-local checks failed. Fix issues and re-run ci-local. No override allowed.`,
      };
    }
    
    // CI gap check for protected push
    try {
      const syncResult = syncCiState(repoRoot);
      if (syncResult.syncResult.summary.readiness === 'ci-gap') {
        return {
          allowed: false,
          skipped: false,
          checkResults: protectedResults,
          requiresOverride: false,
          overrideBlocked: true,
          protectedBranch: true,
          ciGap: true,
          message: `Push to protected branch "${branchName}" blocked: CI gaps detected. No override allowed.`,
        };
      }
    } catch {}
    
    return {
      allowed: true,
      skipped: false,
      checkResults: protectedResults,
      protectedBranch: true,
      message: 'ci-local checks passed. Push to protected branch allowed.',
    };
  }

  const checkResults = profile
    ? await runAllChecksWithProfile(repoRoot, { profile })
    : await runAllChecks(repoRoot);

  if (checkResults.checksAvailable === 0) {
    // No checks configured — allow the action
    return {
      allowed: true,
      skipped: false,
      checkResults,
      isProtected: isProtected,
      message: 'No pre-action checks configured. Proceeding.',
    };
  }

  if (checkResults.allPassed) {
    // CI gap detection: check if all PR-relevant CI jobs have local lane mappings
    try {
      const syncResult = syncCiState(repoRoot);
      if (syncResult.syncResult.summary.readiness === 'ci-gap') {
        return {
          allowed: false,
          skipped: false,
          checkResults,
          requiresOverride: true,
          ciGap: true,
          ciGapDetails: syncResult.syncResult.mappings.filter((m) => m.status === 'ci-gap'),
          message: `CI gap detected: ${syncResult.syncResult.summary.gaps} CI job(s) (${syncResult.syncResult.mappings.filter((m) => m.status === 'ci-gap').map((m) => m.workflowFile + '/' + m.jobName).join(', ')}) not mapped to local lanes. Provide an override reason to proceed anyway.`,
        };
      }
    } catch {
      // ciSync failure is non-blocking — allow the action to proceed
    }

    // For PR creation, never allow CI gaps
    if (action === 'pull-request') {
      try {
        const prSyncResult = syncCiState(repoRoot);
        if (prSyncResult.syncResult.summary.readiness === 'ci-gap') {
          return {
            allowed: false,
            skipped: false,
            checkResults,
            requiresOverride: false,
            overrideBlocked: true,
            ciGap: true,
            ciGapDetails: prSyncResult.syncResult.mappings.filter((m) => m.status === 'ci-gap'),
            message: `PR creation blocked: CI gaps detected. All CI jobs must be mapped to local lanes. No override allowed.`,
          };
        }
      } catch {}
    }

    return {
      allowed: true,
      skipped: false,
      checkResults,
      message: 'All pre-action checks passed.',
    };
  }

  // Checks failed — gate the action
  // For PR: no override allowed
  if (action === 'pull-request') {
    return {
      allowed: false,
      skipped: false,
      checkResults,
      requiresOverride: false,
      overrideBlocked: true,
      message: `PR creation blocked: ${checkResults.checksFailed} check(s) failed. No override allowed. Fix issues and re-run checks.`,
    };
  }
  
  // For commit: override allowed with reason
  // For push to non-protected: override allowed
  const actionLabel = action === 'commit' ? 'Commit' : 'Push';
  return {
    allowed: false,
    skipped: false,
    checkResults,
    requiresOverride: true,
    isProtected: isProtected,
    message: `${checkResults.checksFailed} check(s) failed. Provide an override reason to proceed with ${actionLabel} anyway.`,
  };
}

/**
 * Compute per-group pass/fail summary from lane results.
 * @param {Array<{checkName: string, passed: boolean, group?: string|null}>} checkResults
 * @returns {Object<string, {passedLanes: string[], failedLanes: string[], allPassed: boolean}>}
 */
function resolveGroupResults(checkResults) {
  const groupResults = {};
  for (const result of checkResults) {
    const group = result.group || '__ungrouped__';
    if (!groupResults[group]) {
      groupResults[group] = { passedLanes: [], failedLanes: [], allPassed: true };
    }
    if (result.passed) {
      groupResults[group].passedLanes.push(result.checkName);
    } else {
      groupResults[group].failedLanes.push(result.checkName);
      groupResults[group].allPassed = false;
    }
  }
  return groupResults;
}

function __setDeps(deps = {}) {
  if (deps.fs) fs = deps.fs;
  if (deps.execFile) execFile = deps.execFile;
  // Propagate DI mocks to commitCheckConfig so tests can inject mock fs
  try {
    const commitCheckConfig = require('./commitCheckConfig');
    if (commitCheckConfig.__setDeps) commitCheckConfig.__setDeps(deps);
  } catch { /* commitCheckConfig not available */ }
}

/**
 * Detect whether a branch is protected.
 * Protected = default branch (from remote HEAD) or literal 'main'/'master'.
 */
function isProtectedBranch(repoRoot, branchName) {
  if (!branchName) return false;
  
  const candidate = branchName.trim();
  if (candidate === 'main' || candidate === 'master') return true;
  
  // Check if this is the remote default branch
  try {
    const { execSync } = require('child_process');
    const remoteHead = execSync('git symbolic-ref refs/remotes/origin/HEAD', {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
      timeout: 5000,
    }).trim();
    
    // remoteHead is like "refs/remotes/origin/main"
    const defaultBranch = remoteHead.split('/').pop();
    if (defaultBranch === candidate) return true;
  } catch {
    // Can't determine remote HEAD — rely on main/master check only
  }
  
  return false;
}

/**
 * Get current branch name for a repo.
 */
function getCurrentBranch(repoRoot) {
  try {
    const { execSync } = require('child_process');
    return execSync('git branch --show-current', {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
      timeout: 5000,
    }).trim();
  } catch {
    return null;
  }
}

module.exports = {
  discoverChecks,
  runCheck,
  runAllChecks,
  runAllChecksWithProfile,
  gateGitAction,
  // Backward-compat re-export; canonical source is commitCheckConfig.js
  resolveCommitCheckConfig,
  resolveGroupResults,
  __setDeps,
  isProtectedBranch,
  getCurrentBranch,
};
