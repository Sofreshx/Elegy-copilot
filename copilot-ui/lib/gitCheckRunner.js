'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

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

const RUN_TIMEOUT_MS = 30000;
const CANONICAL_CHECK_TIMEOUT_MS = 120000;

/**
 * Resolve the canonical commit-check config from a repo root.
 * Checks .copilot/commit-checks.json first, then .github/commit-checks.json as fallback.
 * Returns { exists, path, config } — config is the parsed JSON object, null if missing or invalid.
 */
function resolveCommitCheckConfig(repoRoot) {
  const configPaths = [
    path.join(repoRoot, '.copilot', 'commit-checks.json'),
    path.join(repoRoot, '.github', 'commit-checks.json'),
  ];

  for (const configPath of configPaths) {
    if (fs.existsSync(configPath)) {
      try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        return { exists: true, path: configPath, config };
      } catch {
        // Invalid JSON at this path, skip to next fallback
      }
    }
  }

  return { exists: false, path: null, config: null };
}

/**
 * Run canonical commit checks by spawning the commit-check-run.mjs script.
 * Transforms the script's JSON output into the API response shape.
 */
function runCanonicalChecks(repoRoot, configPath) {
  return new Promise((resolve) => {
    const scriptPath = path.join(repoRoot, 'scripts', 'commit-check-run.mjs');

    execFile('node', [scriptPath, '--json', '--repo', repoRoot, '--config', configPath], {
      timeout: CANONICAL_CHECK_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    }, (error, stdout, stderr) => {
      if (error) {
        // Script execution failed (timeout, not found, etc.)
        resolve({
          repoRoot,
          checkedAt: new Date().toISOString(),
          source: 'commit-check',
          checksAvailable: 0,
          checksRun: 0,
          checksPassed: 0,
          checksFailed: 0,
          allPassed: false,
          results: [],
          message: `Canonical check runner failed: ${error.message}`,
        });
        return;
      }

      let output;
      try {
        output = JSON.parse(stdout);
      } catch (parseError) {
        resolve({
          repoRoot,
          checkedAt: new Date().toISOString(),
          source: 'commit-check',
          checksAvailable: 0,
          checksRun: 0,
          checksPassed: 0,
          checksFailed: 0,
          allPassed: false,
          results: [],
          message: `Failed to parse canonical check output: ${parseError.message}`,
        });
        return;
      }

      // Transform script output to API response shape
      const lanes = output.lanes || {};
      const laneNames = Object.keys(lanes);
      const results = [];
      let passedCount = 0;
      let failedCount = 0;

      for (const name of laneNames) {
        const lane = lanes[name];
        const passed = lane.status === 'PASS' || lane.status === 'SKIP';
        const result = {
          checkName: name,
          passed,
          output: lane.details || '',
        };
        if (lane.status === 'FAIL') {
          result.error = lane.details || 'Check failed';
        }
        if (lane.score != null) {
          result.score = lane.score;
        }

        results.push(result);
        if (passed) {
          passedCount++;
        } else {
          failedCount++;
        }
      }

      const totalChecks = laneNames.length;
      const allPassed = output.overallPass === true;

      resolve({
        repoRoot,
        checkedAt: output.timestamp || new Date().toISOString(),
        source: 'commit-check',
        compositeScore: output.compositeScore,
        checksAvailable: totalChecks,
        checksRun: results.length,
        checksPassed: passedCount,
        checksFailed: failedCount,
        allPassed,
        results,
        message: allPassed
          ? `All ${passedCount} checks passed.`
          : `${failedCount} of ${results.length} checks failed.`,
      });
    });
  });
}

/**
 * Discover available checks for a repo root.
 * Prefers canonical commit-check config when present; falls back to legacy KNOWN_CHECKS + githooks.
 */
function discoverChecks(repoRoot) {
  const canonical = resolveCommitCheckConfig(repoRoot);

  if (canonical.exists && canonical.config && canonical.config.lanes) {
    const lanes = canonical.config.lanes;
    const available = [];
    for (const [name, lane] of Object.entries(lanes)) {
      if (lane.enabled === false) continue;
      available.push({
        name,
        path: (lane.commands || []).join(', '),
        fullPath: '',
        description: '',
        source: 'commit-check',
      });
    }
    return available;
  }

  // Fall back to legacy KNOWN_CHECKS + githooks discovery
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
 * Prefers canonical commit-check runner when config exists; falls back to legacy check scripts.
 */
async function runAllChecks(repoRoot) {
  const canonical = resolveCommitCheckConfig(repoRoot);

  if (canonical.exists && canonical.path) {
    return runCanonicalChecks(repoRoot, canonical.path);
  }

  // Fall back to legacy KNOWN_CHECKS discovery + per-script execution
  const checks = discoverChecks(repoRoot);
  if (checks.length === 0) {
    return {
      repoRoot,
      checkedAt: new Date().toISOString(),
      source: 'none',
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
    checkedAt: new Date().toISOString(),
    source: 'legacy',
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

module.exports = {
  discoverChecks,
  runCheck,
  runAllChecks,
  gateGitAction,
  resolveCommitCheckConfig,
  runCanonicalChecks,
  KNOWN_CHECKS,
};
