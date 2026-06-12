'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { syncCiState } = require('./ciSync');

/**
 * Known check scripts in priority order.
 * Each entry: { name, path: relative to repoRoot, description }
 */
const KNOWN_CHECKS = [
  {
    name: 'registry-alignment',
    path: 'scripts/validate-registry-alignment.ps1',
    description: 'Cross-checks fixture manifests, wrapper surfaces, CLI surfaces, inventory patterns, and boundary-policy references.',
  },
  {
    name: 'package-boundaries',
    path: 'scripts/validate-package-boundaries.ps1',
    description: 'Validates package boundary policy rules.',
  },
  {
    name: 'canonical-outputs',
    path: 'scripts/validate-canonical-outputs.ps1',
    description: 'Validates canonical output integrity.',
  },
  {
    name: 'dotnet-exit-freeze',
    path: 'scripts/validate-dotnet-exit-freeze.ps1',
    description: 'Asserts zero .NET artifacts.',
  },
];

/**
 * Custom check definitions per repo (optional overrides).
 * Add entries here for repos with custom check scripts.
 */
const REPO_CUSTOM_CHECKS = {};

/**
 * Resolve the canonical commit-check config file for a repo root.
 * Checks .copilot/commit-checks.json first, then .github/commit-checks.json as fallback.
 * Returns parsed config object or null.
 */
function resolveCommitCheckConfig(repoRoot) {
  const paths = [
    path.join(repoRoot, '.copilot', 'commit-checks.json'),
    path.join(repoRoot, '.github', 'commit-checks.json'),
  ];
  for (const configPath of paths) {
    if (fs.existsSync(configPath)) {
      try {
        return JSON.parse(fs.readFileSync(configPath, 'utf8'));
      } catch {
        // Invalid JSON — skip
      }
    }
  }
  return null;
}

/**
 * Run checks via the canonical commit-check-run.mjs script.
 * Transforms the script's JSON output into the API response shape.
 */
function runCanonicalChecks(repoRoot, config) {
  return new Promise((resolve) => {
    const scriptPath = path.join(repoRoot, 'scripts', 'commit-check-run.mjs');
    if (!fs.existsSync(scriptPath)) {
      // Script not found — fall back to legacy
      resolve(runAllChecksLegacy(repoRoot));
      return;
    }

    const child = execFile('node', [scriptPath, '--json', '--repo', repoRoot], {
      cwd: repoRoot,
      timeout: 120000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    }, (error, stdout, stderr) => {
      let parsed;
      try {
        parsed = JSON.parse((stdout || '').trim());
      } catch {
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
          message: 'Failed to parse commit-check output.',
        });
        return;
      }

      const lanes = parsed.lanes || {};
      const laneNames = Object.keys(lanes);
      const results = laneNames.map((name) => {
        const lane = lanes[name];
        return {
          checkName: name,
          passed: lane.status === 'PASS',
          error: lane.status === 'FAIL' ? (lane.details || 'Check failed') : undefined,
          output: lane.details || '',
          score: lane.score,
          commands: lane.commands,
          group: lane.group || null,
          blocking: lane.blocking !== false,
          ciWorkflow: lane.ciWorkflow || null,
          ciJob: lane.ciJob || null,
          ciRequired: lane.ciRequired || false,
        };
      });

      const passed = results.filter((r) => r.passed).length;
      const failed = results.filter((r) => !r.passed).length;

      resolve({
        repoRoot,
        source: 'commit-check',
        checkedAt: parsed.timestamp || new Date().toISOString(),
        checksAvailable: laneNames.length,
        checksRun: results.length,
        checksPassed: passed,
        checksFailed: failed,
        allPassed: parsed.overallPass !== false,
        groups: parsed.groups || {},
        groupResults: parsed.groupResults || {},
        results,
        message: failed === 0
          ? `All ${passed} lanes passed (score: ${parsed.compositeScore ?? 'N/A'}).`
          : `${failed} of ${results.length} lanes failed.`,
      });
    });
  });
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
      };
    });
    checks.groups = config.groups || {};
    return checks;
  }

  const checks = [...KNOWN_CHECKS];
  const available = [];

  for (const check of checks) {
    const fullPath = path.join(repoRoot, check.path);
    if (fs.existsSync(fullPath)) {
      available.push({
        name: check.name,
        path: check.path,
        fullPath,
        description: check.description,
        source: 'legacy',
      });
    }
  }

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
      source: 'legacy',
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
 * Run checks before a git action (commit, push, PR).
 * Returns { allowed: boolean, checkResults, requiresOverride: boolean }
 */
async function gateGitAction(repoRoot, action, unsafeOverride) {
  // If unsafe override is provided and valid, skip checks
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
    const freshness = checkFreshness(repoId, repoRoot, config);

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

  const checkResults = await runAllChecks(repoRoot);

  if (checkResults.checksAvailable === 0) {
    // No checks configured — allow the action
    return {
      allowed: true,
      skipped: false,
      checkResults,
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

    return {
      allowed: true,
      skipped: false,
      checkResults,
      message: 'All pre-action checks passed.',
    };
  }

  // Checks failed — gate the action
  return {
    allowed: false,
    skipped: false,
    checkResults,
    requiresOverride: true,
    message: `${checkResults.checksFailed} check(s) failed. Provide an override reason to proceed anyway.`,
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

module.exports = {
  discoverChecks,
  runCheck,
  runAllChecks,
  gateGitAction,
  resolveCommitCheckConfig,
  resolveGroupResults,
  KNOWN_CHECKS,
};
