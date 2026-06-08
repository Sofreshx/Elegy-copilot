#!/usr/bin/env node
/**
 * Spec-System Hardening — Pre-Commit Gate (R2)
 * ==============================================
 * This script is the pre-commit validation gate for spec files.
 * 
 * RELIABILITY LAYER: 2 of 4
 *   Layer 1: validate-specs.js — structural + liveness + cross-spec checks
 *   Layer 2: validate-specs-precommit.mjs — pre-commit gate (this file)
 *   Layer 3: .github/workflows/repo-ci.yml — CI gate
 *   Layer 4: spec-review SKILL.md + reviewer agent — human review gate
 * 
 * BEHAVIOR:
 * - Detects staged spec files via git diff
 * - If no spec files staged: exits 0 silently
 * - If spec files staged: runs validate-specs.js --strict specs
 * - Propagates the validator's exit code
 * 
 * BYPASS: SKIP_SPEC_CHECK=1 git commit
 *   The CI gate still enforces — this bypass is for emergency local work only.
 */

// Spec-system-hardening (R2): Pre-commit validation gate.
// Detects staged spec files and runs the full spec validator with --strict.
// Called by .git/hooks/pre-commit (installed by scripts/install-spec-hooks.mjs).
// Bypass: set SKIP_SPEC_CHECK=1 in the environment before committing.

if (process.env.SKIP_SPEC_CHECK === '1') {
  process.exit(0);
}

import { execSync } from 'child_process';

// Get staged files
let staged;
try {
  staged = execSync('git diff --cached --name-only --diff-filter=ACMR', { encoding: 'utf8' });
} catch (e) {
  console.error('[spec-precommit] Failed to get staged files:', e.message);
  process.exit(2);
}

const stagedFiles = staged.trim().split('\n').filter(Boolean);
const specFiles = stagedFiles.filter(f => f.match(/^docs\/specs\/[^/]+\/spec\.md$/));

if (specFiles.length === 0) {
  process.exit(0);
}

// Run full-directory validation
console.error(`[spec-precommit] ${specFiles.length} spec file(s) staged, running validation...`);
try {
  execSync('node scripts/validate-specs.js --strict docs/specs', {
    encoding: 'utf8',
    stdio: 'inherit'
  });
} catch (e) {
  // validator exited non-zero — propagate the failure
  process.exit(e.status || 1);
}
