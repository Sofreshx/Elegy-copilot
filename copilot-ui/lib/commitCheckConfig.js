'use strict';

let fs = require('fs');
const path = require('path');

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

function __setDeps(deps = {}) {
  if (deps.fs) fs = deps.fs;
}

module.exports = { resolveCommitCheckConfig, __setDeps };
