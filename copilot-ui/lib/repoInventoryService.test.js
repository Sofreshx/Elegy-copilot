'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { getRepoStateKey, rebuildCatalogProjection } = require('./catalogProjectionService');
const {
  listKnownRepos,
  registerRepo,
  resolveRepoEntry,
  selectRepo,
  unregisterRepo,
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
  const copilotHome = path.join(tmpRoot, '.copilot');
  const repoPath = path.join(tmpRoot, 'workspace-repo');
  const manualRepoPath = path.join(tmpRoot, 'manual-repo');

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
          manifest: { loadMode: 'always' },
        },
      ],
    });
    writeText(path.join(engineRoot, 'engine-assets', 'skills', 'repo-helper', 'SKILL.md'), '# Repo Helper\n');

    fs.mkdirSync(path.join(engineRoot, '.git'), { recursive: true });
    writeJson(path.join(engineRoot, 'package.json'), {
      name: 'instruction-engine',
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

    writeText(
      path.join(copilotHome, 'session-state', 'session-1', 'events.jsonl'),
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
      copilotHome,
      repoPath,
    });
    const repoStateKey = getRepoStateKey(repoPath);
    writeJson(path.join(copilotHome, 'repo-state', repoStateKey.repoId, 'registry.json'), {
      skills: {
        enabled: ['repo-helper'],
      },
    });

    writeJson(path.join(copilotHome, 'repo-state', 'orphan-repo-id', 'registry.json'), {
      skills: {
        disabled: ['unknown-skill'],
      },
    });

    await test('listKnownRepos merges workspace, session, projection, manual, and repo-state sources', async () => {
      registerRepo({
        copilotHome,
        engineRoot,
        repoPath: manualRepoPath,
        repoLabel: 'Manual Repo',
      });

      const inventory = listKnownRepos({
        copilotHome,
        engineRoot,
        explicitRepoPaths: [manualRepoPath],
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
      assert.ok(engineRepo, 'expected instruction-engine workspace entry');
      assert.ok(engineRepo.sources.includes('workspace'));
      assert.equal(engineRepo.repoLabel, 'instruction-engine');

      const manualRepo = resolveRepoEntry(inventory, { repoPath: manualRepoPath });
      assert.ok(manualRepo, 'expected manual repo entry');
      assert.equal(manualRepo.registered, true);
      assert.ok(manualRepo.sources.includes('manual'));

      const orphanRepo = resolveRepoEntry(inventory, { repoId: 'orphan-repo-id' });
      assert.ok(orphanRepo, 'expected orphan repo-state entry');
      assert.equal(orphanRepo.scanStatus, 'unresolved');
      assert.equal(orphanRepo.assets.overlayDisabledCount, 1);
    });

    await test('selectRepo and unregisterRepo persist selection and reversible manual registration', async () => {
      let result = selectRepo({
        copilotHome,
        engineRoot,
        repoPath: manualRepoPath,
      });
      assert.ok(result.repo, 'expected selected repo');
      assert.equal(result.repo.selected, true);

      result = unregisterRepo({
        copilotHome,
        engineRoot,
        repoPath: manualRepoPath,
      });
      assert.equal(result.selectionCleared, true);

      const inventory = listKnownRepos({
        copilotHome,
        engineRoot,
        explicitRepoPaths: [manualRepoPath],
      });
      const manualRepo = resolveRepoEntry(inventory, { repoPath: manualRepoPath });
      assert.ok(manualRepo, 'expected repo to remain discoverable via explicit path');
      assert.equal(manualRepo.registered, false);
      assert.equal(inventory.selectedRepo, null);
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
