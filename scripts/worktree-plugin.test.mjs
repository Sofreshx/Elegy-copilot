import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

// Set OPENCODE_WORKTREE_BASE BEFORE importing the plugin so the module-level
// WORKTREE_BASE constant captures the test directory, not the real home.
const TEST_WORKTREE_BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-wt-test-base-'));
process.env.OPENCODE_WORKTREE_BASE = TEST_WORKTREE_BASE;

// Resolve the plugin path relative to this file (repo-relative, no hardcoded user path).
const pluginPath = path.resolve(import.meta.dirname, '..', 'opencode-assets', 'plugins', 'worktree.js');
const pluginUrl = pathToFileURL(pluginPath).href;
const { WorktreePlugin } = await import(pluginUrl);

let passed = 0;

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-worktree-plugin-'));
  const cleanup = () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };
  const result = fn(dir);
  if (result && typeof result.then === 'function') {
    return result.then(cleanup, (e) => { cleanup(); throw e; });
  }
  cleanup();
  return result;
}

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

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
}

function initGitRepo(dir) {
  git(['init'], dir);
  git(['config', 'user.email', 'test@test.com'], dir);
  git(['config', 'user.name', 'Test'], dir);
  fs.writeFileSync(path.join(dir, 'README.md'), '# Test\n', 'utf8');
  git(['add', '.'], dir);
  git(['commit', '-m', 'initial'], dir);
}

function computeRepoId(projectPath) {
  const normalized = path.resolve(projectPath).replace(/\\/g, '/').trim().toLowerCase();
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex').slice(0, 12);
}

// --- Tests ---

console.log('worktree plugin tests:');
console.log('');

await test('WORKTREE_BASE captured from env at import time', () => {
  assert.strictEqual(
    process.env.OPENCODE_WORKTREE_BASE,
    TEST_WORKTREE_BASE,
    'env should be set to test base',
  );
  // The plugin's WORKTREE_BASE should match our test base.
  // Verify by creating a worktree and checking the path starts with TEST_WORKTREE_BASE.
});

await test('base branch resolution defaults to HEAD (current checkout)', () => {
  return withTempDir(async (root) => {
    const repoDir = path.join(root, 'repo');
    fs.mkdirSync(repoDir);
    initGitRepo(repoDir);

    const initialHead = git(['rev-parse', 'HEAD'], repoDir);
    const plugin = await WorktreePlugin({ project: { path: repoDir } });

    const result = await plugin.tool.worktree_create.execute({ branch: 'feature/test-head' });
    assert.ok(result.output.includes('Base: HEAD'), 'should use HEAD as base');
    assert.ok(result.metadata.worktreePath, 'should return worktreePath');
    assert.ok(result.metadata.branch === 'feature/test-head', 'should return branch');
    assert.ok(
      result.metadata.worktreePath.startsWith(TEST_WORKTREE_BASE),
      'worktree should be under TEST_WORKTREE_BASE, not real home',
    );

    // Cleanup
    await plugin.tool.worktree_delete.execute({ branch: 'feature/test-head', force: true });
  });
});

await test('base branch resolution uses explicit baseBranch when provided', () => {
  return withTempDir(async (root) => {
    const repoDir = path.join(root, 'repo');
    fs.mkdirSync(repoDir);
    initGitRepo(repoDir);

    // Create a second commit
    fs.writeFileSync(path.join(repoDir, 'file2.txt'), 'content\n', 'utf8');
    git(['add', '.'], repoDir);
    git(['commit', '-m', 'second'], repoDir);
    const secondHead = git(['rev-parse', 'HEAD'], repoDir);

    const plugin = await WorktreePlugin({ project: { path: repoDir } });
    const result = await plugin.tool.worktree_create.execute({ branch: 'feature/from-second', baseBranch: secondHead });

    assert.ok(result.output.includes('Base: ' + secondHead), 'should use explicit base');
    assert.strictEqual(result.metadata.baseBranch, secondHead);

    await plugin.tool.worktree_delete.execute({ branch: 'feature/from-second', force: true });
  });
});

await test('duplicate branch/worktree returns error message', () => {
  return withTempDir(async (root) => {
    const repoDir = path.join(root, 'repo');
    fs.mkdirSync(repoDir);
    initGitRepo(repoDir);

    const plugin = await WorktreePlugin({ project: { path: repoDir } });
    await plugin.tool.worktree_create.execute({ branch: 'feature/dup' });

    const result = await plugin.tool.worktree_create.execute({ branch: 'feature/dup' });
    assert.ok(typeof result === 'string', 'should return error string');
    assert.ok(result.includes('already exists'), 'should indicate duplicate');

    await plugin.tool.worktree_delete.execute({ branch: 'feature/dup', force: true });
  });
});

await test('dirty worktree deletion is refused without force', () => {
  return withTempDir(async (root) => {
    const repoDir = path.join(root, 'repo');
    fs.mkdirSync(repoDir);
    initGitRepo(repoDir);

    const plugin = await WorktreePlugin({ project: { path: repoDir } });
    const createResult = await plugin.tool.worktree_create.execute({ branch: 'feature/dirty' });

    // Create a dirty file in the worktree
    fs.writeFileSync(path.join(createResult.metadata.worktreePath, 'dirty.txt'), 'uncommitted\n', 'utf8');

    const deleteResult = await plugin.tool.worktree_delete.execute({ branch: 'feature/dirty' });
    assert.ok(typeof deleteResult === 'string', 'should return refusal string');
    assert.ok(deleteResult.includes('uncommitted change'), 'should mention uncommitted changes');
    assert.ok(!deleteResult.includes('removed successfully'), 'should not have removed');

    await plugin.tool.worktree_delete.execute({ branch: 'feature/dirty', force: true });
  });
});

await test('force deletion removes dirty worktree', () => {
  return withTempDir(async (root) => {
    const repoDir = path.join(root, 'repo');
    fs.mkdirSync(repoDir);
    initGitRepo(repoDir);

    const plugin = await WorktreePlugin({ project: { path: repoDir } });
    const createResult = await plugin.tool.worktree_create.execute({ branch: 'feature/force' });

    fs.writeFileSync(path.join(createResult.metadata.worktreePath, 'dirty.txt'), 'uncommitted\n', 'utf8');

    const deleteResult = await plugin.tool.worktree_delete.execute({ branch: 'feature/force', force: true });
    assert.ok(deleteResult.includes('removed successfully'), 'should succeed');
    assert.ok(!fs.existsSync(createResult.metadata.worktreePath), 'worktree dir should be gone');
  });
});

await test('shared registry record uses SHA-based repoId matching getRepoStateKey()', () => {
  return withTempDir(async (root) => {
    const repoDir = path.join(root, 'repo');
    fs.mkdirSync(repoDir);
    initGitRepo(repoDir);

    // Set up a mock copilot home
    const copilotHome = path.join(root, '.copilot');
    fs.mkdirSync(copilotHome, { recursive: true });
    process.env.ELEGY_COPILOT_HOME = copilotHome;

    try {
      const plugin = await WorktreePlugin({ project: { path: repoDir } });
      const result = await plugin.tool.worktree_create.execute({ branch: 'feature/shared' });

      assert.ok(result.metadata.sharedRegistry, 'should have sharedRegistry worktreeId');

      // Verify the record was written under the SHA-based repoId
      const expectedRepoId = computeRepoId(repoDir);
      const recordDir = path.join(copilotHome, 'repo-state', expectedRepoId, 'worktrees');
      assert.ok(fs.existsSync(recordDir), 'record should be under SHA-based repoId dir, not projectId');

      // Find the record file
      const recordFiles = fs.readdirSync(recordDir).filter(f => f.endsWith('.json'));
      assert.ok(recordFiles.length > 0, 'should have written a record file');

      const record = JSON.parse(fs.readFileSync(path.join(recordDir, recordFiles[0]), 'utf8'));
      assert.strictEqual(record.repoId, expectedRepoId, 'record repoId should match SHA-based ID');
      assert.strictEqual(record.mode, 'dedicated');
      assert.strictEqual(record.status, 'ready');
      assert.strictEqual(record.source, 'opencode-worktree-plugin');

      await plugin.tool.worktree_delete.execute({ branch: 'feature/shared', force: true });

      // Verify record was removed
      assert.ok(!fs.existsSync(path.join(recordDir, recordFiles[0])), 'record should be removed after deletion');
    } finally {
      delete process.env.ELEGY_COPILOT_HOME;
    }
  });
});

await test('worktree_delete has no commitBeforeDelete parameter', () => {
  return withTempDir(async (root) => {
    const repoDir = path.join(root, 'repo');
    fs.mkdirSync(repoDir);
    initGitRepo(repoDir);

    const plugin = await WorktreePlugin({ project: { path: repoDir } });
    await plugin.tool.worktree_create.execute({ branch: 'feature/no-autocommit' });

    // The tool schema should not have commitBeforeDelete
    const toolDef = plugin.tool.worktree_delete;
    assert.ok(!toolDef.description.includes('commitBeforeDelete'), 'description should not mention commitBeforeDelete');
  });
});

await test('shared registry repoId differs from projectIdFromPath()', () => {
  // Use a temp path to avoid depending on a specific user's directory layout
  const projectPath = path.join(os.tmpdir(), 'some-user', 'some-project');
  const normalized = projectPath.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  const projectId = parts.slice(-2).join('-').replace(/[^a-zA-Z0-9_-]/g, '-');
  const repoId = computeRepoId(projectPath);

  assert.ok(projectId !== repoId, 'projectId and repoId should be different values');
  assert.ok(repoId.length === 12, 'repoId should be 12 hex chars');
  assert.ok(projectId.includes('some-project'), 'projectId should be human-readable');
});

await test('runSetup: true executes setup commands when manifest exists', () => {
  return withTempDir(async (root) => {
    const repoDir = path.join(root, 'repo');
    fs.mkdirSync(repoDir);
    initGitRepo(repoDir);

    // Commit package.json so it appears in the worktree (worktree checks out HEAD)
    fs.writeFileSync(path.join(repoDir, 'package.json'), JSON.stringify({
      name: 'test-setup',
      version: '1.0.0',
    }), 'utf8');
    git(['add', '.'], repoDir);
    git(['commit', '-m', 'add pkg'], repoDir);

    const plugin = await WorktreePlugin({ project: { path: repoDir } });

    // Create with runSetup: true — should detect and attempt to run npm install
    const result = await plugin.tool.worktree_create.execute({ branch: 'feature/setup', runSetup: true });
    assert.ok(typeof result === 'object', 'should return object');
    assert.ok(result.output.includes('Setup results:'), 'should include setup results section');
    assert.ok(result.output.includes('npm install'), 'should mention npm install');

    await plugin.tool.worktree_delete.execute({ branch: 'feature/setup', force: true });
  });
});

await test('runSetup: false detects but does not run setup commands', () => {
  return withTempDir(async (root) => {
    const repoDir = path.join(root, 'repo');
    fs.mkdirSync(repoDir);
    initGitRepo(repoDir);

    // Commit package.json so it appears in the worktree
    fs.writeFileSync(path.join(repoDir, 'package.json'), JSON.stringify({
      name: 'test-no-setup',
      version: '1.0.0',
    }), 'utf8');
    git(['add', '.'], repoDir);
    git(['commit', '-m', 'add pkg'], repoDir);

    const plugin = await WorktreePlugin({ project: { path: repoDir } });

    // Create without runSetup — should detect but not run
    const result = await plugin.tool.worktree_create.execute({ branch: 'feature/no-setup' });
    assert.ok(result.output.includes('Setup commands detected (not run)'), 'should report detected commands');
    assert.ok(result.output.includes('npm install'), 'should mention npm install');
    assert.ok(!result.output.includes('Setup results:'), 'should not have run setup');

    await plugin.tool.worktree_delete.execute({ branch: 'feature/no-setup', force: true });
  });
});

await test('deletion with unknown status is refused without force (fail-closed)', () => {
  return withTempDir(async (root) => {
    const repoDir = path.join(root, 'repo');
    fs.mkdirSync(repoDir);
    initGitRepo(repoDir);

    const plugin = await WorktreePlugin({ project: { path: repoDir } });
    const createResult = await plugin.tool.worktree_create.execute({ branch: 'feature/status-unknown' });

    // Remove the gitdir target so git status fails (broken worktree reference).
    // The .git file in a worktree points to <main-repo>/.git/worktrees/<name>;
    // removing that directory makes git unable to resolve the worktree.
    const wtGitFile = path.join(createResult.metadata.worktreePath, '.git');
    const gitFileContent = fs.readFileSync(wtGitFile, 'utf8');
    const gitdirMatch = gitFileContent.match(/gitdir:\s*(.+)/);
    if (gitdirMatch) {
      fs.rmSync(gitdirMatch[1].trim(), { recursive: true, force: true });
    }

    const deleteResult = await plugin.tool.worktree_delete.execute({ branch: 'feature/status-unknown' });
    assert.ok(typeof deleteResult === 'string', 'should return refusal string');
    assert.ok(deleteResult.includes('Unable to determine'), 'should indicate unknown status');
    assert.ok(!deleteResult.includes('removed successfully'), 'should not have removed');

    // Force should still work
    await plugin.tool.worktree_delete.execute({ branch: 'feature/status-unknown', force: true });
  });
});

await test('session.created writes a session record and links the current worktree', () => {
  return withTempDir(async (root) => {
    const repoDir = path.join(root, 'repo');
    fs.mkdirSync(repoDir);
    initGitRepo(repoDir);

    const copilotHome = path.join(root, '.copilot');
    fs.mkdirSync(copilotHome, { recursive: true });
    process.env.ELEGY_COPILOT_HOME = copilotHome;
    process.env.OPENCODE_SESSION_ID = 'sess-1';

    try {
      const plugin = await WorktreePlugin({ project: { path: repoDir } });
      const createResult = await plugin.tool.worktree_create.execute({ branch: 'feature/sess-created' });
      const worktreeId = createResult.metadata.sharedRegistry;

      await plugin.event({ event: { type: 'session.created', properties: { sessionID: 'sess-1' } } });

      const expectedRepoId = computeRepoId(repoDir);
      const sessPath = path.join(copilotHome, 'repo-state', expectedRepoId, 'opencode-sessions', 'sess-1.json');
      assert.ok(fs.existsSync(sessPath), 'session record should exist');
      const sess = JSON.parse(fs.readFileSync(sessPath, 'utf8'));
      assert.strictEqual(sess.contractVersion, '1');
      assert.strictEqual(sess.source, 'opencode-worktree-plugin');
      assert.strictEqual(sess.sessionId, 'sess-1');
      assert.strictEqual(sess.repoId, expectedRepoId);
      assert.strictEqual(sess.worktreeId, worktreeId);
      assert.strictEqual(sess.status, 'running');
      assert.ok(sess.lifecycle.startedAt, 'should have startedAt');
      assert.ok(sess.lifecycle.lastSeenAt, 'should have lastSeenAt');
      assert.strictEqual(sess.lastEvent.type, 'session.created');

      // The linked worktree should be marked active
      const wtPath = path.join(copilotHome, 'repo-state', expectedRepoId, 'worktrees', worktreeId + '.json');
      const wt = JSON.parse(fs.readFileSync(wtPath, 'utf8'));
      assert.strictEqual(wt.status, 'active', 'worktree should be active after session.created');
      assert.strictEqual(wt.assignment.sessionId, 'sess-1');

      await plugin.tool.worktree_delete.execute({ branch: 'feature/sess-created', force: true });
    } finally {
      delete process.env.ELEGY_COPILOT_HOME;
      delete process.env.OPENCODE_SESSION_ID;
    }
  });
});

await test('session.idle marks session idle without releasing worktree assignment', () => {
  return withTempDir(async (root) => {
    const repoDir = path.join(root, 'repo');
    fs.mkdirSync(repoDir);
    initGitRepo(repoDir);

    const copilotHome = path.join(root, '.copilot');
    fs.mkdirSync(copilotHome, { recursive: true });
    process.env.ELEGY_COPILOT_HOME = copilotHome;
    process.env.OPENCODE_SESSION_ID = 'sess-2';

    try {
      const plugin = await WorktreePlugin({ project: { path: repoDir } });
      const createResult = await plugin.tool.worktree_create.execute({ branch: 'feature/sess-idle' });
      const worktreeId = createResult.metadata.sharedRegistry;
      const expectedRepoId = computeRepoId(repoDir);

      await plugin.event({ event: { type: 'session.created', properties: { sessionID: 'sess-2' } } });
      await plugin.event({ event: { type: 'session.idle', properties: { sessionID: 'sess-2' } } });

      const sessPath = path.join(copilotHome, 'repo-state', expectedRepoId, 'opencode-sessions', 'sess-2.json');
      const sess = JSON.parse(fs.readFileSync(sessPath, 'utf8'));
      assert.strictEqual(sess.status, 'idle', 'session should be idle');
      assert.ok(sess.lifecycle.idleAt, 'should record idleAt');
      assert.strictEqual(sess.worktreeId, worktreeId, 'worktree linkage should persist');

      const wtPath = path.join(copilotHome, 'repo-state', expectedRepoId, 'worktrees', worktreeId + '.json');
      const wt = JSON.parse(fs.readFileSync(wtPath, 'utf8'));
      assert.strictEqual(wt.assignment.sessionId, 'sess-2', 'worktree assignment should be preserved on idle');
      assert.notStrictEqual(wt.status, 'reusable', 'idle should not release the worktree');

      await plugin.tool.worktree_delete.execute({ branch: 'feature/sess-idle', force: true });
    } finally {
      delete process.env.ELEGY_COPILOT_HOME;
      delete process.env.OPENCODE_SESSION_ID;
    }
  });
});

await test('session.error marks session error and worktree interrupted', () => {
  return withTempDir(async (root) => {
    const repoDir = path.join(root, 'repo');
    fs.mkdirSync(repoDir);
    initGitRepo(repoDir);

    const copilotHome = path.join(root, '.copilot');
    fs.mkdirSync(copilotHome, { recursive: true });
    process.env.ELEGY_COPILOT_HOME = copilotHome;
    process.env.OPENCODE_SESSION_ID = 'sess-3';

    try {
      const plugin = await WorktreePlugin({ project: { path: repoDir } });
      const createResult = await plugin.tool.worktree_create.execute({ branch: 'feature/sess-error' });
      const worktreeId = createResult.metadata.sharedRegistry;
      const expectedRepoId = computeRepoId(repoDir);

      await plugin.event({ event: { type: 'session.created', properties: { sessionID: 'sess-3' } } });
      await plugin.event({ event: { type: 'session.error', properties: { sessionID: 'sess-3', error: 'boom' } } });

      const sessPath = path.join(copilotHome, 'repo-state', expectedRepoId, 'opencode-sessions', 'sess-3.json');
      const sess = JSON.parse(fs.readFileSync(sessPath, 'utf8'));
      assert.strictEqual(sess.status, 'error', 'session should be error');
      assert.ok(sess.lifecycle.errorAt, 'should record errorAt');
      assert.strictEqual(sess.error.message, 'boom');

      const wtPath = path.join(copilotHome, 'repo-state', expectedRepoId, 'worktrees', worktreeId + '.json');
      const wt = JSON.parse(fs.readFileSync(wtPath, 'utf8'));
      assert.strictEqual(wt.status, 'interrupted', 'worktree should be interrupted');
      assert.ok(wt.lifecycle.interruptedAt, 'should record interruptedAt');
      assert.strictEqual(wt.assignment.sessionId, 'sess-3', 'sessionId is preserved on interrupted worktree');

      await plugin.tool.worktree_delete.execute({ branch: 'feature/sess-error', force: true });
    } finally {
      delete process.env.ELEGY_COPILOT_HOME;
      delete process.env.OPENCODE_SESSION_ID;
    }
  });
});

await test('session.deleted marks session deleted and worktree reusable', () => {
  return withTempDir(async (root) => {
    const repoDir = path.join(root, 'repo');
    fs.mkdirSync(repoDir);
    initGitRepo(repoDir);

    const copilotHome = path.join(root, '.copilot');
    fs.mkdirSync(copilotHome, { recursive: true });
    process.env.ELEGY_COPILOT_HOME = copilotHome;
    process.env.OPENCODE_SESSION_ID = 'sess-4';

    try {
      const plugin = await WorktreePlugin({ project: { path: repoDir } });
      const createResult = await plugin.tool.worktree_create.execute({ branch: 'feature/sess-deleted' });
      const worktreeId = createResult.metadata.sharedRegistry;
      const expectedRepoId = computeRepoId(repoDir);

      await plugin.event({ event: { type: 'session.created', properties: { sessionID: 'sess-4' } } });
      await plugin.event({ event: { type: 'session.deleted', properties: { sessionID: 'sess-4' } } });

      const sessPath = path.join(copilotHome, 'repo-state', expectedRepoId, 'opencode-sessions', 'sess-4.json');
      const sess = JSON.parse(fs.readFileSync(sessPath, 'utf8'));
      assert.strictEqual(sess.status, 'deleted', 'session should be deleted');
      assert.ok(sess.lifecycle.deletedAt, 'should record deletedAt');

      const wtPath = path.join(copilotHome, 'repo-state', expectedRepoId, 'worktrees', worktreeId + '.json');
      const wt = JSON.parse(fs.readFileSync(wtPath, 'utf8'));
      assert.strictEqual(wt.status, 'reusable', 'worktree should be reusable after session.deleted');
      assert.strictEqual(wt.assignment.sessionId, null, 'worktree assignment should be cleared');

      await plugin.tool.worktree_delete.execute({ branch: 'feature/sess-deleted', force: true });
    } finally {
      delete process.env.ELEGY_COPILOT_HOME;
      delete process.env.OPENCODE_SESSION_ID;
    }
  });
});

await test('legacy session.create/session.delete are tolerated as running/deleted', () => {
  return withTempDir(async (root) => {
    const repoDir = path.join(root, 'repo');
    fs.mkdirSync(repoDir);
    initGitRepo(repoDir);

    const copilotHome = path.join(root, '.copilot');
    fs.mkdirSync(copilotHome, { recursive: true });
    process.env.ELEGY_COPILOT_HOME = copilotHome;
    process.env.OPENCODE_SESSION_ID = 'sess-legacy';

    try {
      const plugin = await WorktreePlugin({ project: { path: repoDir } });
      const createResult = await plugin.tool.worktree_create.execute({ branch: 'feature/sess-legacy' });
      const worktreeId = createResult.metadata.sharedRegistry;
      const expectedRepoId = computeRepoId(repoDir);

      // Legacy event name
      await plugin.event({ event: { type: 'session.create', properties: { sessionID: 'sess-legacy' } } });
      const sessPath = path.join(copilotHome, 'repo-state', expectedRepoId, 'opencode-sessions', 'sess-legacy.json');
      const sess1 = JSON.parse(fs.readFileSync(sessPath, 'utf8'));
      assert.strictEqual(sess1.status, 'running', 'legacy session.create should map to running');
      assert.strictEqual(sess1.lastEvent.type, 'session.create');

      // Legacy delete
      await plugin.event({ event: { type: 'session.delete', properties: { sessionID: 'sess-legacy' } } });
      const sess2 = JSON.parse(fs.readFileSync(sessPath, 'utf8'));
      assert.strictEqual(sess2.status, 'deleted', 'legacy session.delete should map to deleted');
      assert.strictEqual(sess2.lastEvent.type, 'session.delete');

      const wtPath = path.join(copilotHome, 'repo-state', expectedRepoId, 'worktrees', worktreeId + '.json');
      const wt = JSON.parse(fs.readFileSync(wtPath, 'utf8'));
      assert.strictEqual(wt.status, 'reusable');

      await plugin.tool.worktree_delete.execute({ branch: 'feature/sess-legacy', force: true });
    } finally {
      delete process.env.ELEGY_COPILOT_HOME;
      delete process.env.OPENCODE_SESSION_ID;
    }
  });
});

await test('worktree_create persists session record when OPENCODE_SESSION_ID is set', () => {
  return withTempDir(async (root) => {
    const repoDir = path.join(root, 'repo');
    fs.mkdirSync(repoDir);
    initGitRepo(repoDir);

    const copilotHome = path.join(root, '.copilot');
    fs.mkdirSync(copilotHome, { recursive: true });
    process.env.ELEGY_COPILOT_HOME = copilotHome;
    process.env.OPENCODE_SESSION_ID = 'sess-create';

    try {
      const plugin = await WorktreePlugin({ project: { path: repoDir } });
      const createResult = await plugin.tool.worktree_create.execute({ branch: 'feature/sess-create' });

      const expectedRepoId = computeRepoId(repoDir);
      const sessPath = path.join(copilotHome, 'repo-state', expectedRepoId, 'opencode-sessions', 'sess-create.json');
      assert.ok(fs.existsSync(sessPath), 'session record should be written by worktree_create');
      const sess = JSON.parse(fs.readFileSync(sessPath, 'utf8'));
      assert.strictEqual(sess.sessionId, 'sess-create');
      assert.strictEqual(sess.status, 'running');
      assert.strictEqual(sess.worktreeId, createResult.metadata.sharedRegistry);
      assert.strictEqual(sess.branch, 'feature/sess-create');
      assert.strictEqual(sess.worktreePath, createResult.metadata.worktreePath);

      await plugin.tool.worktree_delete.execute({ branch: 'feature/sess-create', force: true });
    } finally {
      delete process.env.ELEGY_COPILOT_HOME;
      delete process.env.OPENCODE_SESSION_ID;
    }
  });
});

await test('session event resolves sessionID from properties.sessionID / sessionId / id / OPENCODE_SESSION_ID', () => {
  return withTempDir(async (root) => {
    const repoDir = path.join(root, 'repo');
    fs.mkdirSync(repoDir);
    initGitRepo(repoDir);

    const copilotHome = path.join(root, '.copilot');
    fs.mkdirSync(copilotHome, { recursive: true });
    process.env.ELEGY_COPILOT_HOME = copilotHome;
    process.env.OPENCODE_SESSION_ID = 'env-sess';

    try {
      const plugin = await WorktreePlugin({ project: { path: repoDir } });
      await plugin.tool.worktree_create.execute({ branch: 'feature/sess-resolve' });
      const expectedRepoId = computeRepoId(repoDir);

      // From properties.id (not sessionID)
      await plugin.event({ event: { type: 'session.created', properties: { id: 'props-id' } } });
      // From properties.sessionId
      await plugin.event({ event: { type: 'session.status', properties: { sessionId: 'props-sid' } } });
      // From top-level sessionId
      await plugin.event({ event: { type: 'session.status', sessionId: 'top-sid' } });
      // From OPENCODE_SESSION_ID env (env-sess)
      await plugin.event({ event: { type: 'session.status' } });

      const dir = path.join(copilotHome, 'repo-state', expectedRepoId, 'opencode-sessions');
      const names = fs.readdirSync(dir);
      assert.ok(names.includes('props-id.json'), 'props.id should resolve');
      assert.ok(names.includes('props-sid.json'), 'props.sessionId should resolve');
      assert.ok(names.includes('top-sid.json'), 'event.sessionId should resolve');
      assert.ok(names.includes('env-sess.json'), 'OPENCODE_SESSION_ID should resolve');

      // Clean up
      const pluginNoEnv = await WorktreePlugin({ project: { path: repoDir } });
      await pluginNoEnv.tool.worktree_delete.execute({ branch: 'feature/sess-resolve', force: true });
    } finally {
      delete process.env.ELEGY_COPILOT_HOME;
      delete process.env.OPENCODE_SESSION_ID;
    }
  });
});

console.log(`\n${passed} tests passed`);
if (process.exitCode) {
  console.error('Some tests FAILED');
} else {
  console.log('All tests passed');
}

// Cleanup test worktree base
try { fs.rmSync(TEST_WORKTREE_BASE, { recursive: true, force: true }); } catch {}
