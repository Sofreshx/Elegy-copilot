#!/usr/bin/env node
/**
 * DORMANT/LEGACY — Spec-System Hardening Pre-Commit Gate (R2)
 * =============================================================
 * This script was the pre-commit validation gate for spec files.
 *
 * DORMANT — spec validation is no longer enforced as repo policy.
 * This file is kept in-repo as dormant implementation history.
 *
 * HISTORICAL RELIABILITY LAYER: 2 of 4
 *   Layer 1: validate-specs.js — structural + liveness + cross-spec checks
 *   Layer 2: validate-specs-precommit.mjs — pre-commit gate (this file — DORMANT)
 *   Layer 3: .github/workflows/repo-ci.yml — CI gate (DORMANT)
 *   Layer 4: spec-review SKILL.md + reviewer agent — human review gate
 *
 * HISTORICAL BEHAVIOR:
 * - Detected staged spec files via git diff
 * - If no spec files staged: exited 0 silently
 * - If spec files staged: ran validate-specs.js --strict specs
 * - Propagated the validator's exit code
 *
 * BYPASS (retained for compatibility): SKIP_SPEC_CHECK=1 git commit
 */

// DORMANT — This file is kept as implementation history. No longer called
// by any pre-commit hook or enforced as repo policy.

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
