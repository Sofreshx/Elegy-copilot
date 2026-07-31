'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');

const {
  checkFreshness,
  computeGitFingerprint,
  deriveRepoId,
  getStatePath,
  writeCheckState,
} = require('./checkState');

function git(repoRoot, args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

test('includes branch in the fingerprint and invalidates cached proof after branch changes', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'elegy-check-state-'));
  const repoId = deriveRepoId(repoRoot);
  try {
    git(repoRoot, ['init', '--initial-branch=main']);
    git(repoRoot, ['config', 'user.email', 'checks@example.test']);
    git(repoRoot, ['config', 'user.name', 'Checks Test']);
    fs.writeFileSync(path.join(repoRoot, 'README.md'), 'checks\n', 'utf8');
    git(repoRoot, ['add', 'README.md']);
    git(repoRoot, ['commit', '-m', 'initial']);

    const fingerprint = computeGitFingerprint(repoRoot);
    assert.equal(fingerprint.branch, 'main');
    writeCheckState(repoId, repoRoot, {
      allPassed: true,
      profile: 'commit',
      results: [],
    }, null, null);

    git(repoRoot, ['checkout', '-b', 'checks/branch-change']);
    const freshness = checkFreshness(repoId, repoRoot, null, 'commit');
    assert.equal(freshness.fresh, false);
    assert.equal(freshness.reason, 'branch-changed');
  } finally {
    fs.rmSync(path.dirname(path.dirname(getStatePath(repoId))), { recursive: true, force: true });
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('stores plan context and invalidates cached proof after the plan changes', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'elegy-check-state-plan-'));
  const repoId = deriveRepoId(repoRoot);
  try {
    git(repoRoot, ['init', '--initial-branch=main']);
    git(repoRoot, ['config', 'user.email', 'checks@example.test']);
    git(repoRoot, ['config', 'user.name', 'Checks Test']);
    fs.writeFileSync(path.join(repoRoot, 'README.md'), 'checks\n', 'utf8');
    git(repoRoot, ['add', 'README.md']);
    git(repoRoot, ['commit', '-m', 'initial']);

    writeCheckState(repoId, repoRoot, {
      allPassed: true,
      profile: 'commit',
      planHash: 'plan-1',
      action: 'commit',
      selectionMode: 'recommended',
      runnerVersion: '0.1.0',
      sourceKind: 'local',
      results: [],
    }, null, null);

    const fresh = checkFreshness(repoId, repoRoot, null, 'commit', 'plan-1');
    assert.equal(fresh.fresh, true);
    const stale = checkFreshness(repoId, repoRoot, null, 'commit', 'plan-2');
    assert.equal(stale.fresh, false);
    assert.equal(stale.reason, 'plan-changed');
  } finally {
    fs.rmSync(path.dirname(path.dirname(getStatePath(repoId))), { recursive: true, force: true });
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('invalidates cached proof when the contents of an already-dirty file change', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'elegy-check-state-content-'));
  const repoId = deriveRepoId(repoRoot);
  try {
    git(repoRoot, ['init', '--initial-branch=main']);
    git(repoRoot, ['config', 'user.email', 'checks@example.test']);
    git(repoRoot, ['config', 'user.name', 'Checks Test']);
    const filePath = path.join(repoRoot, 'README.md');
    fs.writeFileSync(filePath, 'checks\n', 'utf8');
    git(repoRoot, ['add', 'README.md']);
    git(repoRoot, ['commit', '-m', 'initial']);

    fs.writeFileSync(filePath, 'first dirty edit\n', 'utf8');
    const firstFingerprint = computeGitFingerprint(repoRoot);
    writeCheckState(repoId, repoRoot, {
      allPassed: true,
      profile: 'commit',
      results: [],
    }, null, null);

    fs.writeFileSync(filePath, 'second dirty edit\n', 'utf8');
    const secondFingerprint = computeGitFingerprint(repoRoot);
    assert.notEqual(firstFingerprint.dirtyHash, secondFingerprint.dirtyHash);
    const freshness = checkFreshness(repoId, repoRoot, null, 'commit');
    assert.equal(freshness.fresh, false);
    assert.equal(freshness.reason, 'working-tree-changed');
  } finally {
    fs.rmSync(path.dirname(path.dirname(getStatePath(repoId))), { recursive: true, force: true });
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});
