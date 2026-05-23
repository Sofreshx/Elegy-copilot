'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createWorktreeService } = require('./worktreeService');

let passed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  PASS: ${name}`);
  } catch (error) {
    console.error(`  FAIL: ${name}`);
    console.error(`    ${error.message}`);
    process.exitCode = 1;
  }
}

function createGitRepoRoot(repoPath) {
  fs.mkdirSync(path.join(repoPath, '.git', 'worktrees'), { recursive: true });
}

function createGitWorktree(repoPath, worktreePath, worktreeName = path.basename(worktreePath)) {
  const gitDir = path.join(repoPath, '.git', 'worktrees', worktreeName);
  fs.mkdirSync(worktreePath, { recursive: true });
  fs.mkdirSync(gitDir, { recursive: true });
  fs.writeFileSync(path.join(gitDir, 'commondir'), path.join('..', '..'));
  fs.writeFileSync(path.join(worktreePath, '.git'), `gitdir: ${gitDir}\n`);
}

async function run() {
  await test('shared launch plan reuses the primary repo checkout when no same-repo writer is active', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-worktree-service-'));
    const copilotHome = path.join(tmpRoot, '.copilot');
    const repoPath = path.join(tmpRoot, 'repo');

    try {
      fs.mkdirSync(path.join(repoPath, '.git'), { recursive: true });
      const service = createWorktreeService({ copilotHome });

      const result = service.resolveLaunchPlan({
        copilotHome,
        repoId: 'repo',
        repoPath,
      });

      assert.equal(result.cwd, path.resolve(repoPath));
      assert.equal(result.worktree.mode, 'shared');
      assert.equal(result.worktree.status, 'shared');
      assert.equal(result.worktree.launch.blocked, false);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  await test('same-repo parallel launch reserves a dedicated worktree record and blocks until prepared', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-worktree-service-'));
    const copilotHome = path.join(tmpRoot, '.copilot');
    const repoPath = path.join(tmpRoot, 'repo');

    try {
      fs.mkdirSync(path.join(repoPath, '.git'), { recursive: true });
      const service = createWorktreeService({ copilotHome });

      const result = service.resolveLaunchPlan({
        copilotHome,
        repoId: 'repo',
        repoPath,
        activeSessions: [{
          repoId: 'repo',
          active: true,
          worktree: { mode: 'shared' },
        }],
      });

      assert.equal(result.worktree.mode, 'dedicated');
      assert.equal(result.worktree.status, 'pending_preparation');
      assert.equal(result.worktree.launch.blocked, true);
      assert.ok(result.worktree.worktreeId);
      assert.equal(service.listWorktrees({ copilotHome, repoId: 'repo' }).length, 1);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  await test('prepared dedicated worktrees can transition active then reusable', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-worktree-service-'));
    const copilotHome = path.join(tmpRoot, '.copilot');
    const repoPath = path.join(tmpRoot, 'repo');
    const worktreePath = path.join(tmpRoot, 'repo-worktrees', 'wt-1');

    try {
      createGitRepoRoot(repoPath);
      createGitWorktree(repoPath, worktreePath, 'wt-1');
      const service = createWorktreeService({ copilotHome });

      const resolved = service.resolveLaunchPlan({
        copilotHome,
        repoId: 'repo',
        repoPath,
        worktree: {
          mode: 'dedicated',
          worktreeId: 'wt-1',
          worktreePath,
        },
        activeSessions: [{
          repoId: 'repo',
          active: true,
          worktree: { mode: 'shared' },
        }],
      });

      assert.equal(resolved.cwd, path.resolve(worktreePath));
      assert.equal(resolved.worktree.status, 'ready');

      const active = service.markWorktreeActive({
        copilotHome,
        repoId: 'repo',
        worktreeId: 'wt-1',
        sessionId: 'session-123',
        runId: 'run-1',
      });
      assert.equal(active.status, 'active');
      assert.equal(active.assignment.sessionId, 'session-123');

      const reusable = service.markWorktreeReusable({
        copilotHome,
        repoId: 'repo',
        worktreeId: 'wt-1',
      });
      assert.equal(reusable.status, 'reusable');
      assert.equal(reusable.cleanup.status, 'reuse_ready');
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  await test('dedicated launch stays blocked when the path is not an attached git worktree for the repo', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-worktree-service-'));
    const copilotHome = path.join(tmpRoot, '.copilot');
    const repoPath = path.join(tmpRoot, 'repo');
    const worktreePath = path.join(tmpRoot, 'repo-worktrees', 'wt-bad');

    try {
      createGitRepoRoot(repoPath);
      fs.mkdirSync(worktreePath, { recursive: true });
      const service = createWorktreeService({ copilotHome });

      const resolved = service.resolveLaunchPlan({
        copilotHome,
        repoId: 'repo',
        repoPath,
        worktree: {
          mode: 'dedicated',
          worktreeId: 'wt-bad',
          worktreePath,
        },
        activeSessions: [{
          repoId: 'repo',
          active: true,
          worktree: { mode: 'shared' },
        }],
      });

      assert.equal(resolved.cwd, null);
      assert.equal(resolved.worktree.launch.blocked, true);
      assert.match(resolved.worktree.launch.reason, /attached git worktree/i);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  await test('active dedicated worktrees fail closed when a different run tries to reuse them', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-worktree-service-'));
    const copilotHome = path.join(tmpRoot, '.copilot');
    const repoPath = path.join(tmpRoot, 'repo');
    const worktreePath = path.join(tmpRoot, 'repo-worktrees', 'wt-locked');

    try {
      createGitRepoRoot(repoPath);
      createGitWorktree(repoPath, worktreePath, 'wt-locked');
      const service = createWorktreeService({ copilotHome });

      service.resolveLaunchPlan({
        copilotHome,
        repoId: 'repo',
        repoPath,
        worktree: {
          mode: 'dedicated',
          worktreeId: 'wt-locked',
          worktreePath,
        },
        activeSessions: [{
          repoId: 'repo',
          active: true,
          worktree: { mode: 'shared' },
        }],
        runId: 'run-1',
      });

      service.markWorktreeActive({
        copilotHome,
        repoId: 'repo',
        worktreeId: 'wt-locked',
        sessionId: 'session-123',
        runId: 'run-1',
      });

      const resolved = service.resolveLaunchPlan({
        copilotHome,
        repoId: 'repo',
        repoPath,
        worktree: {
          mode: 'dedicated',
          worktreeId: 'wt-locked',
          worktreePath,
        },
        activeSessions: [{
          repoId: 'repo',
          active: true,
          worktree: { mode: 'shared' },
        }],
        sessionId: 'session-999',
        runId: 'run-2',
      });

      assert.equal(resolved.cwd, null);
      assert.equal(resolved.worktree.status, 'active');
      assert.equal(resolved.worktree.launch.blocked, true);
      assert.match(resolved.worktree.launch.reason, /already assigned/i);
      assert.equal(resolved.worktree.assignment.sessionId, 'session-123');
      assert.equal(resolved.worktree.assignment.runId, 'run-1');
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  console.log(`\n  ${passed} passed, ${process.exitCode ? 'some failed' : '0 failed'}\n`);
}

run().catch((error) => {
  console.error(`\n  FATAL: ${error.message}\n`);
  process.exitCode = 1;
});
