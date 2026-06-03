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

/**
 * Discover available checks for a repo root by checking file existence.
 */
function discoverChecks(repoRoot) {
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
      });
    }
    if (fs.existsSync(prePush)) {
      available.push({
        name: 'git-hooks-pre-push',
        path: '.githooks/pre-push',
        fullPath: prePush,
        description: 'Pre-push hook: full validation',
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
async function runAllChecks(repoRoot) {
  const checks = discoverChecks(repoRoot);
  if (checks.length === 0) {
    return {
      repoRoot,
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
  KNOWN_CHECKS,
};
