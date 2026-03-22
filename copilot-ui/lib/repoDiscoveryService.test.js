'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  discoverReposFromRoots,
  loadRepoDiscoveryState,
  resolveRepoDiscoveryStatePath,
  resolveWorkspaceScanRoots,
  saveRepoDiscoveryState,
} = require('./repoDiscoveryService');

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

function writeText(absPath, text) {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, text, 'utf8');
}

async function run() {
  console.log('\nRepo Discovery Service Tests\n');

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-repo-discovery-'));
  const copilotHome = path.join(tmpRoot, '.copilot');
  const scanRoot = path.join(tmpRoot, 'scan-root');
  const nestedOrgRoot = path.join(scanRoot, 'org');

  try {
    await test('saveRepoDiscoveryState persists deterministic custom scan roots', async () => {
      const repoADiscoveryRoot = path.join(tmpRoot, 'repos-b');
      const repoBDiscoveryRoot = path.join(tmpRoot, 'repos-a');
      const saved = saveRepoDiscoveryState(copilotHome, {
        customScanRoots: [
          repoADiscoveryRoot,
          repoBDiscoveryRoot,
          repoADiscoveryRoot,
        ],
      });

      assert.deepEqual(saved.customScanRoots, [
        path.resolve(repoBDiscoveryRoot),
        path.resolve(repoADiscoveryRoot),
      ]);

      const reloaded = loadRepoDiscoveryState(copilotHome);
      assert.deepEqual(reloaded, saved);
      assert.equal(fs.existsSync(resolveRepoDiscoveryStatePath(copilotHome)), true);

      const resolved = resolveWorkspaceScanRoots({
        copilotHome,
        roots: [],
      });
      assert.deepEqual(resolved.customScanRoots, saved.customScanRoots);
      assert.deepEqual(resolved.scanRoots, []);
    });

    await test('discoverReposFromRoots scans the root and two nested levels with .git file or directory markers', async () => {
      fs.mkdirSync(path.join(scanRoot, '.git'), { recursive: true });
      fs.mkdirSync(path.join(scanRoot, 'repo-one', '.git'), { recursive: true });
      writeText(path.join(nestedOrgRoot, 'repo-two', '.git'), 'gitdir: ../.bare\n');
      fs.mkdirSync(path.join(nestedOrgRoot, 'team', 'repo-three', '.git'), { recursive: true });

      const discovery = discoverReposFromRoots({
        roots: [scanRoot],
      });

      assert.deepEqual(
        discovery.roots.map((root) => root.scanRoot),
        [path.resolve(scanRoot)],
      );
      assert.deepEqual(
        discovery.repos.map((repo) => repo.repoPath),
        [
          path.resolve(scanRoot),
          path.resolve(path.join(scanRoot, 'org', 'repo-two')),
          path.resolve(path.join(scanRoot, 'repo-one')),
        ],
      );
      assert.deepEqual(
        discovery.repos.map((repo) => repo.repoLabel),
        [
          path.basename(scanRoot),
          'org/repo-two',
          'repo-one',
        ],
      );
      assert.equal(
        discovery.repos.some((repo) => repo.repoPath === path.resolve(path.join(scanRoot, 'org', 'team', 'repo-three'))),
        false,
      );
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
