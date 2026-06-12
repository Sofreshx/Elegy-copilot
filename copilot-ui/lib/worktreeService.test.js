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
    const elegyHome = path.join(tmpRoot, '.elegy');
    const repoPath = path.join(tmpRoot, 'repo');
    try {
      fs.mkdirSync(path.join(repoPath, '.git'), { recursive: true });
      const service = createWorktreeService({ elegyHome });
      const result = service.resolveLaunchPlan({
        elegyHome,
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
    const elegyHome = path.join(tmpRoot, '.elegy');
    const repoPath = path.join(tmpRoot, 'repo');
    try {
      fs.mkdirSync(path.join(repoPath, '.git'), { recursive: true });
      const service = createWorktreeService({ elegyHome });
      const result = service.resolveLaunchPlan({
        elegyHome,
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
      assert.equal(service.listWorktrees({ elegyHome, repoId: 'repo' }).length, 1);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
  await test('prepared dedicated worktrees can transition active then reusable', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-worktree-service-'));
    const elegyHome = path.join(tmpRoot, '.elegy');
    const repoPath = path.join(tmpRoot, 'repo');
    const worktreePath = path.join(tmpRoot, 'repo-worktrees', 'wt-1');
    try {
      createGitRepoRoot(repoPath);
      createGitWorktree(repoPath, worktreePath, 'wt-1');
      const service = createWorktreeService({ elegyHome });
      const resolved = service.resolveLaunchPlan({
        elegyHome,
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
        elegyHome,
        repoId: 'repo',
        worktreeId: 'wt-1',
        sessionId: 'session-123',
        runId: 'run-1',
      });
      assert.equal(active.status, 'active');
      assert.equal(active.assignment.sessionId, 'session-123');
      const reusable = service.markWorktreeReusable({
        elegyHome,
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
    const elegyHome = path.join(tmpRoot, '.elegy');
    const repoPath = path.join(tmpRoot, 'repo');
    const worktreePath = path.join(tmpRoot, 'repo-worktrees', 'wt-bad');
    try {
      createGitRepoRoot(repoPath);
      fs.mkdirSync(worktreePath, { recursive: true });
      const service = createWorktreeService({ elegyHome });
      const resolved = service.resolveLaunchPlan({
        elegyHome,
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
    const elegyHome = path.join(tmpRoot, '.elegy');
    const repoPath = path.join(tmpRoot, 'repo');
    const worktreePath = path.join(tmpRoot, 'repo-worktrees', 'wt-locked');
    try {
      createGitRepoRoot(repoPath);
      createGitWorktree(repoPath, worktreePath, 'wt-locked');
      const service = createWorktreeService({ elegyHome });
      service.resolveLaunchPlan({
        elegyHome,
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
        elegyHome,
        repoId: 'repo',
        worktreeId: 'wt-locked',
        sessionId: 'session-123',
        runId: 'run-1',
      });
      const resolved = service.resolveLaunchPlan({
        elegyHome,
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
  await test('OpenCode session records are read from repo-state and projected into worktree list', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-worktree-service-'));
    const elegyHome = path.join(tmpRoot, '.elegy');
    const repoPath = path.join(tmpRoot, 'repo');
    const worktreePath = path.join(tmpRoot, 'repo-worktrees', 'wt-session');
    try {
      createGitRepoRoot(repoPath);
      createGitWorktree(repoPath, worktreePath, 'wt-session');
      const service = createWorktreeService({ elegyHome });
      const resolved = service.resolveLaunchPlan({
        elegyHome,
        repoId: 'repo',
        repoPath,
        worktree: {
          mode: 'dedicated',
          worktreeId: 'wt-session',
          worktreePath,
        },
        activeSessions: [{
          repoId: 'repo',
          active: true,
          worktree: { mode: 'shared' },
        }],
      });
      // Write two session records for that worktree
      const sessionsDir = path.join(elegyHome, 'repo-state', 'repo', 'opencode-sessions');
      fs.mkdirSync(sessionsDir, { recursive: true });
      fs.writeFileSync(path.join(sessionsDir, 'sess-running.json'), JSON.stringify({
        contractVersion: '1',
        source: 'opencode-worktree-plugin',
        sessionId: 'sess-running',
        repoId: 'repo',
        worktreeId: 'wt-session',
        worktreePath,
        branch: 'feature/sess',
        status: 'running',
        lifecycle: {
          startedAt: '2026-06-07T10:00:00.000Z',
          lastSeenAt: '2026-06-07T10:00:00.000Z',
        },
        lastEvent: { type: 'session.created', receivedAt: '2026-06-07T10:00:00.000Z' },
      }), 'utf8');
      fs.writeFileSync(path.join(sessionsDir, 'sess-deleted.json'), JSON.stringify({
        contractVersion: '1',
        source: 'opencode-worktree-plugin',
        sessionId: 'sess-deleted',
        repoId: 'repo',
        worktreeId: 'wt-session',
        worktreePath,
        branch: 'feature/sess',
        status: 'deleted',
        lifecycle: {
          startedAt: '2026-06-07T09:00:00.000Z',
          lastSeenAt: '2026-06-07T09:30:00.000Z',
          deletedAt: '2026-06-07T09:30:00.000Z',
        },
        lastEvent: { type: 'session.deleted', receivedAt: '2026-06-07T09:30:00.000Z' },
      }), 'utf8');
      const direct = service.getOpenCodeSession(elegyHome, 'repo', 'sess-running');
      assert.ok(direct, 'getOpenCodeSession should return running session');
      assert.equal(direct.status, 'running');
      assert.equal(direct.worktreeId, 'wt-session');
      const list = service.listOpenCodeSessions({ elegyHome, repoId: 'repo', includeDeleted: true });
      assert.equal(list.length, 2, 'should list both sessions with includeDeleted');
      const statuses = list.map((s) => s.status).sort();
      assert.deepEqual(statuses, ['deleted', 'running']);
      // Default (no includeDeleted) hides deleted sessions
      const filtered = service.listOpenCodeSessions({ elegyHome, repoId: 'repo', worktreeId: 'wt-session' });
      assert.equal(filtered.length, 1, 'should filter to one worktree');
      assert.equal(filtered[0].status, 'running');
      // includeDeleted=true brings back the deleted session
      const withDeleted = service.listOpenCodeSessions({ elegyHome, repoId: 'repo', includeDeleted: true });
      assert.equal(withDeleted.length, 2);
      // Project onto worktree list
      const worktrees = service.listWorktrees({
        elegyHome,
        repoId: 'repo',
        includeSessions: true,
      });
      const wt = worktrees.find((w) => w.worktreeId === 'wt-session');
      assert.ok(wt, 'worktree record should exist');
      assert.equal(wt.opencodeSessionStatus, 'running');
      assert.equal(wt.opencodeSessionId, 'sess-running');
      assert.equal(wt.opencodeSessions.length, 1, 'deleted session excluded by default');
      assert.equal(wt.opencodeSessions[0].sessionId, 'sess-running');
      // includeDeleted=true projection
      const worktreesWithDeleted = service.listWorktrees({
        elegyHome,
        repoId: 'repo',
        includeSessions: true,
        includeDeleted: true,
      });
      const wtWithDeleted = worktreesWithDeleted.find((w) => w.worktreeId === 'wt-session');
      assert.equal(wtWithDeleted.opencodeSessions.length, 2);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
  await test('malformed OpenCode session JSON is ignored fail-soft', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-worktree-service-'));
    const elegyHome = path.join(tmpRoot, '.elegy');
    const repoPath = path.join(tmpRoot, 'repo');
    const worktreePath = path.join(tmpRoot, 'repo-worktrees', 'wt-malformed');
    try {
      createGitRepoRoot(repoPath);
      createGitWorktree(repoPath, worktreePath, 'wt-malformed');
      const service = createWorktreeService({ elegyHome });
      service.resolveLaunchPlan({
        elegyHome,
        repoId: 'repo',
        repoPath,
        worktree: {
          mode: 'dedicated',
          worktreeId: 'wt-malformed',
          worktreePath,
        },
        activeSessions: [{
          repoId: 'repo',
          active: true,
          worktree: { mode: 'shared' },
        }],
      });
      const sessionsDir = path.join(elegyHome, 'repo-state', 'repo', 'opencode-sessions');
      fs.mkdirSync(sessionsDir, { recursive: true });
      // Malformed JSON
      fs.writeFileSync(path.join(sessionsDir, 'broken.json'), '{not valid json', 'utf8');
      // Missing sessionId
      fs.writeFileSync(path.join(sessionsDir, 'missing-id.json'), JSON.stringify({
        contractVersion: '1',
        source: 'opencode-worktree-plugin',
        repoId: 'repo',
        worktreeId: 'wt-malformed',
        status: 'running',
      }), 'utf8');
      // Missing repoId
      fs.writeFileSync(path.join(sessionsDir, 'missing-repo.json'), JSON.stringify({
        contractVersion: '1',
        source: 'opencode-worktree-plugin',
        sessionId: 'x',
        status: 'running',
      }), 'utf8');
      // Valid one
      fs.writeFileSync(path.join(sessionsDir, 'valid.json'), JSON.stringify({
        contractVersion: '1',
        source: 'opencode-worktree-plugin',
        sessionId: 'valid-sess',
        repoId: 'repo',
        worktreeId: 'wt-malformed',
        worktreePath,
        branch: 'feature/x',
        status: 'idle',
        lifecycle: { startedAt: '2026-06-07T08:00:00.000Z', lastSeenAt: '2026-06-07T08:00:00.000Z', idleAt: '2026-06-07T08:00:00.000Z' },
        lastEvent: { type: 'session.idle', receivedAt: '2026-06-07T08:00:00.000Z' },
      }), 'utf8');
      const list = service.listOpenCodeSessions({ elegyHome, repoId: 'repo' });
      assert.equal(list.length, 1, 'should ignore broken/missing session records');
      assert.equal(list[0].sessionId, 'valid-sess');
      assert.equal(list[0].status, 'idle');
      const worktrees = service.listWorktrees({
        elegyHome,
        repoId: 'repo',
        includeSessions: true,
      });
      const wt = worktrees.find((w) => w.worktreeId === 'wt-malformed');
      assert.equal(wt.opencodeSessionId, 'valid-sess');
      assert.equal(wt.opencodeSessionStatus, 'idle');
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
  await test('session projection is deterministic after restart (read-only, no live plugin)', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-worktree-service-'));
    const elegyHome = path.join(tmpRoot, '.elegy');
    const repoPath = path.join(tmpRoot, 'repo');
    const worktreePath = path.join(tmpRoot, 'repo-worktrees', 'wt-restart');
    try {
      createGitRepoRoot(repoPath);
      createGitWorktree(repoPath, worktreePath, 'wt-restart');
      // First service instance: write worktree record + 2 session records
      {
        const service = createWorktreeService({ elegyHome });
        service.resolveLaunchPlan({
          elegyHome,
          repoId: 'repo',
          repoPath,
          worktree: {
            mode: 'dedicated',
            worktreeId: 'wt-restart',
            worktreePath,
          },
          activeSessions: [{
            repoId: 'repo',
            active: true,
            worktree: { mode: 'shared' },
          }],
        });
        service.markWorktreeActive({
          elegyHome,
          repoId: 'repo',
          worktreeId: 'wt-restart',
          sessionId: 'rest-sess-1',
        });
        const sessionsDir = path.join(elegyHome, 'repo-state', 'repo', 'opencode-sessions');
        fs.mkdirSync(sessionsDir, { recursive: true });
        fs.writeFileSync(path.join(sessionsDir, 'rest-sess-1.json'), JSON.stringify({
          contractVersion: '1',
          source: 'opencode-worktree-plugin',
          sessionId: 'rest-sess-1',
          repoId: 'repo',
          worktreeId: 'wt-restart',
          worktreePath,
          branch: 'feature/restart',
          status: 'running',
          lifecycle: { startedAt: '2026-06-07T11:00:00.000Z', lastSeenAt: '2026-06-07T11:00:00.000Z' },
          lastEvent: { type: 'session.created', receivedAt: '2026-06-07T11:00:00.000Z' },
        }), 'utf8');
      }
      // Second service instance simulates a fresh restart: read-only projection
      const service2 = createWorktreeService({ elegyHome });
      const worktrees = service2.listWorktrees({
        elegyHome,
        repoId: 'repo',
        includeSessions: true,
      });
      const wt = worktrees.find((w) => w.worktreeId === 'wt-restart');
      assert.equal(wt.status, 'active');
      assert.equal(wt.assignment.sessionId, 'rest-sess-1');
      assert.equal(wt.opencodeSessionStatus, 'running');
      assert.equal(wt.opencodeSessionId, 'rest-sess-1');
      assert.equal(wt.opencodeSessions.length, 1);
      assert.equal(wt.opencodeSessions[0].sessionId, 'rest-sess-1');
      // Project again — should be stable
      const worktrees2 = service2.listWorktrees({
        elegyHome,
        repoId: 'repo',
        includeSessions: true,
      });
      const wt2 = worktrees2.find((w) => w.worktreeId === 'wt-restart');
      assert.deepEqual(wt.opencodeSessions, wt2.opencodeSessions);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
  await test('marks dedicated worktrees as removed and records lifecycle', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-worktree-service-'));
    const elegyHome = path.join(tmpRoot, '.elegy');
    const repoPath = path.join(tmpRoot, 'repo');
    const worktreePath = path.join(tmpRoot, 'repo-worktrees', 'wt-removed');
    try {
      createGitRepoRoot(repoPath);
      createGitWorktree(repoPath, worktreePath, 'wt-removed');
      const service = createWorktreeService({ elegyHome });

      // Allocate
      const plan = service.resolveLaunchPlan({
        elegyHome,
        repoId: 'repo-removed',
        repoPath,
        worktree: {
          mode: 'dedicated',
          worktreeId: 'wt-removed',
          worktreePath,
        },
        activeSessions: [{
          repoId: 'repo-removed',
          active: true,
          worktree: { mode: 'shared' },
        }],
      });
      assert.ok(plan.worktree.worktreeId);
      const worktreeId = plan.worktree.worktreeId;

      // Activate
      service.markWorktreeActive({
        elegyHome,
        repoId: 'repo-removed',
        worktreeId,
        sessionId: 's1',
        runId: 'r1',
      });

      // Remove
      const removed = service.markWorktreeRemoved({
        elegyHome,
        repoId: 'repo-removed',
        worktreeId,
      });
      assert.ok(removed);
      assert.equal(removed.status, 'removed');
      assert.ok(removed.lifecycle.removedAt);
      assert.ok(removed.lifecycle.allocatedAt);
      assert.ok(removed.lifecycle.activatedAt);

      // Verify
      const fetched = service.getWorktree(elegyHome, 'repo-removed', worktreeId);
      assert.equal(fetched.status, 'removed');
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  await test('markWorktreeRemoved returns null for missing worktree', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-worktree-service-'));
    const elegyHome = path.join(tmpRoot, '.elegy');
    try {
      const service = createWorktreeService({ elegyHome });
      const result = service.markWorktreeRemoved({
        elegyHome,
        repoId: 'nonexistent',
        worktreeId: 'no-such-id',
      });
      assert.equal(result, null);
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
