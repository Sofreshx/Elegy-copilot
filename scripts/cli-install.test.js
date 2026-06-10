#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { createTestElegyCliShim, withWorkingDirectory } = require('./test-elegy-cli-shim.js');
let passed = 0;
function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-cli-install-'));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
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
async function main() {
  const installerPath = pathToFileURL(path.resolve(__dirname, 'cli-install.mjs')).href;
  const installer = await import(installerPath);
  await test('installer creates manifest-driven Elegy assets and installs planning skills by default', async () => {
    withTempDir((root) => {
      const elegyHome = path.join(root, '.elegy');
      const summary = installer.runInstall({
        force: true,
        doCli: true,
        elegyHome,
      });
      assert.ok(fs.existsSync(path.join(elegyHome, 'agents', 'search.agent.md')));
      assert.ok(fs.existsSync(path.join(elegyHome, 'skills', 'skill-discovery', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(elegyHome, 'skills', 'core-guardrails', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(elegyHome, 'skills', 'roadmap-authoring', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(elegyHome, 'skills-vault', 'spec-dev', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(elegyHome, 'skills-vault', 'spec-authoring', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(elegyHome, 'skills-vault', 'spec-review', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(elegyHome, 'skills-vault', 'rubberduck-plan-review', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(elegyHome, 'skills-vault', 'implementation-review', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(elegyHome, 'skills-vault', 'implementation-handoff', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(elegyHome, 'copilot-instructions.md')));
      const installState = JSON.parse(fs.readFileSync(path.join(elegyHome, '.instruction-engine-install-state.json'), 'utf8'));
      assert.equal(installState.installProfile, 'minimal');
      assert.ok(Array.isArray(installState.vaultSkills) && installState.vaultSkills.includes('spec-dev'));
      assert.ok(Array.isArray(summary.surfaces) && summary.surfaces.length === 1);
    });
  });
  await test('installer bootstraps opt-in spec-driven repo files', async () => {
    withTempDir((root) => {
      const shim = createTestElegyCliShim(root);
      const elegyHome = path.join(root, '.elegy');
      const repoRoot = path.join(root, 'target-repo');
      fs.mkdirSync(path.join(repoRoot, 'docs', 'system'), { recursive: true });
      fs.mkdirSync(path.join(repoRoot, '.github', 'skills', 'repo-helper'), { recursive: true });
      fs.writeFileSync(path.join(repoRoot, 'README.md'), '# Target Repo\n', 'utf8');
      fs.writeFileSync(path.join(repoRoot, 'docs', 'system', 'index.md'), '# System Docs\n', 'utf8');
      fs.writeFileSync(path.join(repoRoot, 'package.json'), `${JSON.stringify({ name: 'target-repo', scripts: {} }, null, 2)}\n`, 'utf8');
      fs.writeFileSync(path.join(repoRoot, '.github', 'skills', 'repo-helper', 'SKILL.md'), '---\nname: repo-helper\ndescription: Repo helper\n---\n', 'utf8');
      const summary = withWorkingDirectory(shim.shimDir, () => installer.runInstall({
        force: true,
        doCli: true,
        elegyHome,
        repoRoot,
        elegyCliPath: shim.elegyCliPath,
        setupProfile: 'spec-driven',
      }));
      assert.ok(fs.existsSync(path.join(repoRoot, 'docs', 'specs', 'index.md')));
      assert.ok(fs.existsSync(path.join(repoRoot, 'scripts', 'validate-specs.js')));
      assert.ok(fs.existsSync(path.join(repoRoot, '.github', 'copilot-instructions.md')));
      assert.ok(summary.repoSetup);
      assert.equal(summary.repoSetup.profileKey, 'spec-driven');
    });
  });
  await test('installer dry-run resolves explicit homes without creating files', async () => {
    withTempDir((root) => {
      const elegyHome = path.join(root, 'elegy-home');
      const summary = installer.runInstall({
        dryRun: true,
        force: true,
        doCli: true,
        elegyHome,
      });
      assert.ok(!fs.existsSync(elegyHome));
      assert.ok(summary.surfaces.some((surface) => surface.counts.wouldInstall > 0 || surface.counts.wouldUpdate > 0));
    });
  });
  console.log(`\n${passed} tests passed`);
  if (process.exitCode) {
    console.error('Some tests FAILED');
    process.exit(process.exitCode);
  }
}
main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
