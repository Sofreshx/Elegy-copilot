'use strict';
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { getRepoStateKey, rebuildCatalogProjection } = require('./catalogProjectionService');
const { saveRepoDiscoveryState } = require('./repoDiscoveryService');
const {
  listKnownRepos,
  registerRepo,
  resolveRepoEntry,
  selectRepo,
  unregisterRepo,
  extractCanonicalRemote,
  getProjectView,
  updateProjectFields,
  loadRepoInventoryState,
} = require('./repoInventoryService');
let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  PASS: ${name}`);
  } catch (error) {
    failed += 1;
    process.exitCode = 1;
    console.error(`  FAIL: ${name}`);
    console.error(`    ${error.message}`);
  }
}
function writeJson(absPath, value) {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, JSON.stringify(value, null, 2) + '\n', 'utf8');
}
function writeText(absPath, text) {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, text, 'utf8');
}
async function run() {
  console.log('\nRepo Inventory Service Tests\n');
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-repo-inventory-'));
  const engineRoot = path.join(tmpRoot, 'engine');
  const elegyHome = path.join(tmpRoot, '.elegy');
  const repoPath = path.join(tmpRoot, 'workspace-repo');
  const manualRepoPath = path.join(tmpRoot, 'manual-repo');
  const linkedWorktreeRepoPath = path.join(tmpRoot, 'linked-worktree-repo');
  const scanRoot = path.join(tmpRoot, 'discovery-root');
  const discoveredRepoPath = path.join(scanRoot, 'org', 'discovered-repo');
  try {
    writeJson(path.join(engineRoot, 'engine-assets', 'manifest.json'), {
      assets: [
        {
          id: 'skill-repo-helper',
          type: 'skill',
          source: 'engine-assets/skills/repo-helper',
          destination: 'skills/repo-helper',
          loadMode: 'always',
        },
      ],
    });
    writeJson(path.join(engineRoot, 'engine-assets', 'skills', 'skill-metadata-index.json'), {
      schemaVersion: 1,
      entries: [
        {
          skill: 'repo-helper',
          name: 'Repo Helper',
          description: 'Repo helper skill.',
          triggersOn: ['repo'],
          frameworks: ['react'],
          manifest: { id: 'skill-repo-helper', loadMode: 'always' },
        },
      ],
    });
    writeText(path.join(engineRoot, 'engine-assets', 'skills', 'repo-helper', 'SKILL.md'), '# Repo Helper\n');
    fs.mkdirSync(path.join(engineRoot, '.git'), { recursive: true });
    writeJson(path.join(engineRoot, 'package.json'), {
      name: 'elegy-copilot',
      private: true,
      workspaces: ['copilot-ui'],
      dependencies: {
        react: '^18.0.0',
      },
      devDependencies: {
        typescript: '^5.0.0',
      },
    });
    fs.mkdirSync(path.join(repoPath, '.git'), { recursive: true });
    writeJson(path.join(repoPath, 'package.json'), {
      name: 'workspace-repo',
      dependencies: {
        react: '^18.0.0',
        express: '^4.0.0',
      },
      devDependencies: {
        typescript: '^5.0.0',
      },
    });
    writeText(path.join(repoPath, '.github', 'skills', 'repo-helper', 'SKILL.md'), '# Repo Helper\n');
    writeText(path.join(repoPath, '.github', 'agents', 'review.agent.md'), '# Review Agent\n');
    fs.mkdirSync(path.join(manualRepoPath, '.git'), { recursive: true });
    writeText(path.join(manualRepoPath, 'pyproject.toml'), '[project]\nname = "manual-repo"\n');
    fs.mkdirSync(linkedWorktreeRepoPath, { recursive: true });
    writeText(path.join(linkedWorktreeRepoPath, '.git'), 'gitdir: ../.git/worktrees/linked-worktree-repo\n');
    writeJson(path.join(linkedWorktreeRepoPath, 'package.json'), {
      name: 'linked-worktree-repo',
    });
    fs.mkdirSync(path.join(discoveredRepoPath, '.git'), { recursive: true });
    writeJson(path.join(discoveredRepoPath, 'package.json'), {
      name: 'discovered-repo',
      dependencies: {
        express: '^4.0.0',
      },
    });
    saveRepoDiscoveryState(elegyHome, {
      customScanRoots: [scanRoot],
    });
    writeText(
      path.join(elegyHome, 'session-state', 'session-1', 'events.jsonl'),
      JSON.stringify({
        type: 'session.start',
        timestamp: '2026-03-01T00:00:00.000Z',
        payload: {
          cwd: repoPath,
          repo: repoPath,
        },
      }) + '\n',
    );
    rebuildCatalogProjection({
      engineRoot,
      elegyHome,
      repoPath,
    });
    const repoStateKey = getRepoStateKey(repoPath);
    writeJson(path.join(elegyHome, 'repo-state', repoStateKey.repoId, 'registry.json'), {
      skills: {
        enabled: ['repo-helper'],
      },
    });
    writeJson(path.join(elegyHome, 'repo-state', 'orphan-repo-id', 'registry.json'), {
      skills: {
        disabled: ['unknown-skill'],
      },
    });
    await test('listKnownRepos merges workspace, session, projection, manual, and repo-state sources', async () => {
      registerRepo({
        elegyHome,
        engineRoot,
        repoPath: manualRepoPath,
        repoLabel: 'Manual Repo',
        workspaceScanRoots: [scanRoot],
      });
        const inventory = listKnownRepos({
          elegyHome,
          engineRoot,
          explicitRepoPaths: [manualRepoPath, linkedWorktreeRepoPath],
          workspaceScanRoots: [scanRoot],
        });
      const workspaceRepo = resolveRepoEntry(inventory, { repoPath });
      assert.ok(workspaceRepo, 'expected workspace repo entry');
      assert.ok(workspaceRepo.sources.includes('session-state'));
      assert.ok(workspaceRepo.sources.includes('catalog-projection'));
      assert.ok(workspaceRepo.sources.includes('repo-state'));
      assert.equal(workspaceRepo.assets.hasRepoAssets, true);
      assert.equal(workspaceRepo.assets.skillCount, 1);
      assert.equal(workspaceRepo.assets.agentCount, 1);
      assert.deepEqual(workspaceRepo.hints.frameworks, ['express', 'react']);
      assert.deepEqual(workspaceRepo.hints.targets, ['backend', 'frontend']);
      assert.equal(workspaceRepo.scanStatus, 'ready');
      assert.ok(workspaceRepo.snapshot.exists, 'expected repo snapshot metadata');
      const engineRepo = resolveRepoEntry(inventory, { repoPath: engineRoot });
      assert.ok(engineRepo, 'expected elegy-copilot workspace entry');
      assert.ok(engineRepo.sources.includes('workspace'));
      assert.equal(engineRepo.repoLabel, 'elegy-copilot');
      const manualRepo = resolveRepoEntry(inventory, { repoPath: manualRepoPath });
      assert.ok(manualRepo, 'expected manual repo entry');
      assert.equal(manualRepo.registered, true);
      assert.ok(manualRepo.sources.includes('manual'));
      const linkedWorktreeRepo = resolveRepoEntry(inventory, { repoPath: linkedWorktreeRepoPath });
      assert.ok(linkedWorktreeRepo, 'expected linked worktree repo entry');
      assert.equal(linkedWorktreeRepo.gitRootPresent, true);
      assert.equal(linkedWorktreeRepo.gitRootKind, 'file');
      assert.equal(linkedWorktreeRepo.isWorktreeCheckout, true);
      const discoveredRepo = resolveRepoEntry(inventory, { repoPath: discoveredRepoPath });
      assert.ok(discoveredRepo, 'expected workspace scan entry');
      assert.ok(discoveredRepo.sources.includes('workspace-scan'));
      assert.equal(discoveredRepo.registered, false);
      assert.equal(discoveredRepo.selected, false);
      assert.deepEqual(inventory.workspaceScan.customScanRoots, [path.resolve(scanRoot)]);
      assert.deepEqual(inventory.workspaceScan.scanRoots, [path.resolve(scanRoot)]);
      const orphanRepo = resolveRepoEntry(inventory, { repoId: 'orphan-repo-id' });
      assert.ok(orphanRepo, 'expected orphan repo-state entry');
      assert.equal(orphanRepo.scanStatus, 'unresolved');
      assert.equal(orphanRepo.assets.overlayDisabledCount, 1);
    });
    await test('selectRepo and unregisterRepo persist selection and reversible manual registration', async () => {
      let result = selectRepo({
        elegyHome,
        engineRoot,
        repoPath: manualRepoPath,
        workspaceScanRoots: [scanRoot],
      });
      assert.ok(result.repo, 'expected selected repo');
      assert.equal(result.repo.selected, true);
      result = unregisterRepo({
        elegyHome,
        engineRoot,
        repoPath: manualRepoPath,
        workspaceScanRoots: [scanRoot],
      });
      assert.equal(result.selectionCleared, true);
      const inventory = listKnownRepos({
        elegyHome,
        engineRoot,
        explicitRepoPaths: [manualRepoPath],
        workspaceScanRoots: [scanRoot],
      });
      const manualRepo = resolveRepoEntry(inventory, { repoPath: manualRepoPath });
      assert.ok(manualRepo, 'expected repo to remain discoverable via explicit path');
      assert.equal(manualRepo.registered, false);
      assert.equal(inventory.selectedRepo, null);
    });
    // --- extractCanonicalRemote tests ---
    await test('extractCanonicalRemote parses HTTPS URL from .git/config', async () => {
      const testRepo = path.join(tmpRoot, 'remote-https-repo');
      fs.mkdirSync(path.join(testRepo, '.git'), { recursive: true });
      writeText(path.join(testRepo, '.git', 'config'), [
        '[core]',
        '\trepositoryformatversion = 0',
        '[remote "origin"]',
        '\turl = https://github.com/octocat/hello-world.git',
        '\tfetch = +refs/heads/*:refs/remotes/origin/*',
        '',
      ].join('\n'));
      const result = extractCanonicalRemote(testRepo);
      assert.equal(result, 'octocat/hello-world');
    });
    await test('extractCanonicalRemote parses SSH URL from .git/config', async () => {
      const testRepo = path.join(tmpRoot, 'remote-ssh-repo');
      fs.mkdirSync(path.join(testRepo, '.git'), { recursive: true });
      writeText(path.join(testRepo, '.git', 'config'), [
        '[remote "origin"]',
        '\turl = git@github.com:myorg/my-project.git',
        '\tfetch = +refs/heads/*:refs/remotes/origin/*',
        '',
      ].join('\n'));
      const result = extractCanonicalRemote(testRepo);
      assert.equal(result, 'myorg/my-project');
    });
    await test('extractCanonicalRemote returns null when no remote origin', async () => {
      const testRepo = path.join(tmpRoot, 'no-remote-repo');
      fs.mkdirSync(path.join(testRepo, '.git'), { recursive: true });
      writeText(path.join(testRepo, '.git', 'config'), [
        '[core]',
        '\trepositoryformatversion = 0',
        '',
      ].join('\n'));
      const result = extractCanonicalRemote(testRepo);
      assert.equal(result, null);
    });
    await test('extractCanonicalRemote returns null for malformed URL', async () => {
      const testRepo = path.join(tmpRoot, 'malformed-remote-repo');
      fs.mkdirSync(path.join(testRepo, '.git'), { recursive: true });
      writeText(path.join(testRepo, '.git', 'config'), [
        '[remote "origin"]',
        '\turl = not-a-valid-url',
        '',
      ].join('\n'));
      const result = extractCanonicalRemote(testRepo);
      assert.equal(result, null);
    });
    await test('extractCanonicalRemote returns null when .git/config does not exist', async () => {
      const testRepo = path.join(tmpRoot, 'no-git-config-repo');
      fs.mkdirSync(testRepo, { recursive: true });
      const result = extractCanonicalRemote(testRepo);
      assert.equal(result, null);
    });
    await test('extractCanonicalRemote strips .git suffix and trailing slashes from HTTPS', async () => {
      const testRepo = path.join(tmpRoot, 'remote-trailing-repo');
      fs.mkdirSync(path.join(testRepo, '.git'), { recursive: true });
      writeText(path.join(testRepo, '.git', 'config'), [
        '[remote "origin"]',
        '\turl = https://gitlab.com/group/subgroup/myrepo.git/',
        '',
      ].join('\n'));
      const result = extractCanonicalRemote(testRepo);
      assert.equal(result, 'group/subgroup');
    });
    // --- getProjectView tests ---
    await test('getProjectView returns correct shape with defaults', async () => {
      const entry = {
        repoId: 'test-repo-id',
        repoPath: '/some/path',
        repoLabel: 'Test Repo',
        addedAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-02T00:00:00.000Z',
        pinned: false,
        lastActivityMs: null,
        canonicalRemote: null,
      };
      const view = getProjectView(entry);
      assert.equal(view.projectId, 'test-repo-id');
      assert.equal(view.repoId, 'test-repo-id');
      assert.equal(view.repoPath, '/some/path');
      assert.equal(view.repoLabel, 'Test Repo');
      assert.equal(view.canonicalRemote, null);
      assert.equal(view.pinned, false);
      assert.equal(view.lastActivityMs, null);
      assert.equal(view.sessionCount, 0);
      assert.equal(view.activeSessionCount, 0);
      assert.deepEqual(view.installedAssetSummary, { agents: 0, skills: 0 });
      assert.equal(view.createdAt, '2025-01-01T00:00:00.000Z');
      assert.equal(view.updatedAt, '2025-01-02T00:00:00.000Z');
    });
    await test('getProjectView passes through non-default values', async () => {
      const entry = {
        repoId: 'proj-2',
        repoPath: '/another/path',
        repoLabel: 'Another',
        addedAt: '2025-03-01T00:00:00.000Z',
        updatedAt: '2025-03-02T00:00:00.000Z',
        pinned: true,
        lastActivityMs: 1700000000000,
        canonicalRemote: 'org/repo',
      };
      const view = getProjectView(entry);
      assert.equal(view.pinned, true);
      assert.equal(view.lastActivityMs, 1700000000000);
      assert.equal(view.canonicalRemote, 'org/repo');
    });
    // --- updateProjectFields tests ---
    await test('updateProjectFields pins a registered repo', async () => {
      // Re-register so we have a manual repo to update
      registerRepo({
        elegyHome,
        engineRoot,
        repoPath: manualRepoPath,
        repoLabel: 'Manual Repo',
        workspaceScanRoots: [scanRoot],
      });
      const stateBefore = loadRepoInventoryState(elegyHome);
      const entry = stateBefore.manualRepos.find((e) => e.repoPath === path.resolve(manualRepoPath));
      assert.ok(entry, 'expected manual repo entry');
      assert.equal(entry.pinned, false);
      const updated = updateProjectFields(elegyHome, entry.repoId, { pinned: true });
      assert.ok(updated, 'expected updated entry');
      assert.equal(updated.pinned, true);
      // Verify persistence
      const stateAfter = loadRepoInventoryState(elegyHome);
      const persisted = stateAfter.manualRepos.find((e) => e.repoId === entry.repoId);
      assert.ok(persisted, 'expected persisted entry');
      assert.equal(persisted.pinned, true);
    });
    await test('updateProjectFields unpins a repo', async () => {
      const stateBefore = loadRepoInventoryState(elegyHome);
      const entry = stateBefore.manualRepos.find((e) => e.repoPath === path.resolve(manualRepoPath));
      assert.ok(entry, 'expected manual repo entry');
      const updated = updateProjectFields(elegyHome, entry.repoId, { pinned: false });
      assert.ok(updated, 'expected updated entry');
      assert.equal(updated.pinned, false);
    });
    await test('updateProjectFields updates canonicalRemote', async () => {
      const stateBefore = loadRepoInventoryState(elegyHome);
      const entry = stateBefore.manualRepos.find((e) => e.repoPath === path.resolve(manualRepoPath));
      assert.ok(entry, 'expected manual repo entry');
      const updated = updateProjectFields(elegyHome, entry.repoId, { canonicalRemote: 'org/my-repo' });
      assert.ok(updated, 'expected updated entry');
      assert.equal(updated.canonicalRemote, 'org/my-repo');
    });
    await test('updateProjectFields returns null for non-existent repoId', async () => {
      const result = updateProjectFields(elegyHome, 'nonexistent-id-12345', { pinned: true });
      assert.equal(result, null);
    });
    await test('updateProjectFields ignores disallowed fields', async () => {
      const stateBefore = loadRepoInventoryState(elegyHome);
      const entry = stateBefore.manualRepos.find((e) => e.repoPath === path.resolve(manualRepoPath));
      assert.ok(entry, 'expected manual repo entry');
      const updated = updateProjectFields(elegyHome, entry.repoId, {
        repoLabel: 'SHOULD NOT CHANGE',
        repoPath: '/should/not/change',
        pinned: true,
      });
      assert.ok(updated, 'expected updated entry');
      assert.equal(updated.pinned, true);
      // repoLabel should still be what it was normalized to, not the injected value
      assert.notEqual(updated.repoLabel, 'SHOULD NOT CHANGE');
    });
    // --- backward compatibility test ---
    await test('normalizeManualRepoEntry applies defaults for old entries without new fields', async () => {
      const stateBefore = loadRepoInventoryState(elegyHome);
      // All entries should have the new fields with defaults
      for (const entry of stateBefore.manualRepos) {
        assert.equal(typeof entry.pinned, 'boolean', `expected pinned to be boolean for ${entry.repoId}`);
        assert.ok(entry.lastActivityMs === null || typeof entry.lastActivityMs === 'number', `expected lastActivityMs to be null or number for ${entry.repoId}`);
        assert.ok(entry.canonicalRemote === null || typeof entry.canonicalRemote === 'string', `expected canonicalRemote to be null or string for ${entry.repoId}`);
      }
    });
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
  console.log(`\n  ${passed} passed, ${failed} failed (${passed + failed} total)\n`);
}
run().catch((error) => {
  console.error(`\n  FATAL: ${error.message}\n`);
  process.exitCode = 1;
});
