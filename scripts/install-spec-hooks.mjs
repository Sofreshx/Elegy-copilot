#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

/**
 * Spec Validation Hook Cleanup Tool (DEPRECATED)
 * ================================================
 * Removes the managed spec-validation block from .git/hooks/pre-commit if present.
 *
 * DEPRECATED — spec validation is no longer enforced as repo policy.
 * Previously installed the pre-commit gate for spec file validation.
 * Now performs cleanup only: removes the legacy managed block.
 *
 * BEHAVIOR:
 * - If .git/hooks/pre-commit exists and contains a block between
 *   `# BEGIN spec-validation` and `# END spec-validation` (inclusive),
 *   that block is removed.
 * - If the hook file becomes empty after removal, the file is deleted entirely.
 * - If no block is found, prints a message and exits cleanly.
 *
 * EXIT CODES:
 *   0 — success (cleanup done or nothing to do)
 *   2 — not in a git repository
 */

function getGitHooksDir() {
  try {
    const gitDir = execSync('git rev-parse --git-dir', { encoding: 'utf8' }).trim();
    return path.resolve(gitDir, 'hooks');
  } catch (e) {
    console.error('[spec-hooks-cleanup] Not in a git repository.');
    process.exit(2);
  }
}

function main() {
  const hooksDir = getGitHooksDir();
  const hookPath = path.join(hooksDir, 'pre-commit');

  if (!fs.existsSync(hookPath)) {
    console.log('[spec-hooks-cleanup] No pre-commit hook found — nothing to clean up.');
    process.exit(0);
  }

  const existing = fs.readFileSync(hookPath, 'utf8');

  if (!existing.includes('# BEGIN spec-validation')) {
    console.log('[spec-hooks-cleanup] No managed spec-validation block found — nothing to clean up.');
    process.exit(0);
  }

  // Remove the managed block whether it was the whole hook or appended below user content.
  let changed = false;
  let cleaned = existing.replace(
    /(?:^|\r?\n)# BEGIN spec-validation[\s\S]*?# END spec-validation\r?\n?/,
    (match, offset) => {
      changed = true;
      return offset === 0 ? '' : '\n';
    }
  );
  if (!changed) {
    console.log('[spec-hooks-cleanup] No managed spec-validation block found — nothing to clean up.');
    process.exit(0);
  }
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();

  if (!cleaned.trim()) {
    // Hook is empty after removal — delete the file entirely
    fs.unlinkSync(hookPath);
    console.log('[spec-hooks-cleanup] Removed managed spec-validation block and deleted now-empty pre-commit hook.');
  } else {
    // Preserve or restore a shell shebang so the remaining hook stays executable.
    if (!cleaned.startsWith('#!')) {
      cleaned = `#!/bin/sh\n${cleaned}`;
    }
    fs.writeFileSync(hookPath, cleaned + '\n', 'utf8');
    console.log('[spec-hooks-cleanup] Removed managed spec-validation block from pre-commit hook.');
  }

  process.exit(0);
}

main();
