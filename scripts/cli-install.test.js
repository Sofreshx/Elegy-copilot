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

  await test('installer creates manifest-driven Copilot assets and installs planning skills by default', async () => {
    withTempDir((root) => {
      const copilotHome = path.join(root, '.copilot');
      const vscodeHome = path.join(root, '.copilot-vscode');

      const summary = installer.runInstall({
        force: true,
        doCli: true,
        doVscode: true,
        copilotHome,
        vscodeHome,
      });

      assert.ok(fs.existsSync(path.join(copilotHome, 'agents', 'search.agent.md')));
      assert.ok(fs.existsSync(path.join(copilotHome, 'skills', 'skill-discovery', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(copilotHome, 'skills', 'core-guardrails', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(copilotHome, 'skills', 'planning-feature', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(copilotHome, 'skills', 'roadmap-authoring', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(copilotHome, 'skills', 'roadmap-planning', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(copilotHome, 'skills', 'spec-dev', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(copilotHome, 'skills-vault', 'spec-dev', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(copilotHome, 'skills-vault', 'spec-authoring', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(copilotHome, 'skills-vault', 'spec-review', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(copilotHome, 'skills-vault', 'rubberduck-plan-review', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(copilotHome, 'skills-vault', 'implementation-review', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(copilotHome, 'skills-vault', 'implementation-handoff', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(copilotHome, 'skills-vault', 'roadmap-planning', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(vscodeHome, 'prompts', 'instruction-engine-plan.prompt.md')));
      assert.ok(fs.existsSync(path.join(vscodeHome, 'copilot-instructions.md')));

      const installState = JSON.parse(fs.readFileSync(path.join(copilotHome, '.instruction-engine-install-state.json'), 'utf8'));
      assert.equal(installState.installProfile, 'minimal');
      assert.ok(Array.isArray(installState.vaultSkills) && installState.vaultSkills.includes('spec-dev'));
      assert.ok(Array.isArray(installState.alwaysLoadedSkills) && installState.alwaysLoadedSkills.includes('spec-dev'));
      assert.ok(Array.isArray(installState.alwaysLoadedSkills) && installState.alwaysLoadedSkills.includes('planning-feature'));
      assert.ok(Array.isArray(summary.surfaces) && summary.surfaces.length === 2);
    });
  });

  await test('CLI-only rerun preserves existing VS Code prompts in shared home state', async () => {
    withTempDir((root) => {
      const sharedHome = path.join(root, '.copilot');

      installer.runInstall({
        force: true,
        doCli: true,
        doVscode: true,
        copilotHome: sharedHome,
        vscodeHome: sharedHome,
      });

      assert.ok(fs.existsSync(path.join(sharedHome, 'prompts', 'instruction-engine-plan.prompt.md')));

      installer.runInstall({
        doCli: true,
        doVscode: false,
        copilotHome: sharedHome,
      });

      assert.ok(fs.existsSync(path.join(sharedHome, 'prompts', 'instruction-engine-plan.prompt.md')));
      const installState = JSON.parse(fs.readFileSync(path.join(sharedHome, '.instruction-engine-install-state.json'), 'utf8'));
      assert.ok(Array.isArray(installState.managedPrompts) && installState.managedPrompts.includes('instruction-engine-plan.prompt.md'));
    });
  });

  await test('installer bootstraps opt-in spec-driven repo files', async () => {
    withTempDir((root) => {
      const shim = createTestElegyCliShim(root);
      const copilotHome = path.join(root, '.copilot');
      const vscodeHome = path.join(root, '.copilot-vscode');
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
        doVscode: true,
        copilotHome,
        vscodeHome,
        repoRoot,
        elegyCliPath: shim.elegyCliPath,
        setupProfile: 'spec-driven',
      }));

      assert.ok(fs.existsSync(path.join(repoRoot, 'specs', 'index.md')));
      assert.ok(fs.existsSync(path.join(repoRoot, 'scripts', 'validate-specs.js')));
      assert.ok(fs.existsSync(path.join(repoRoot, '.github', 'copilot-instructions.md')));
      assert.ok(summary.repoSetup);
      assert.equal(summary.repoSetup.profileKey, 'spec-driven');
    });
  });

  await test('installer dry-run resolves explicit homes without creating files', async () => {
    withTempDir((root) => {
      const copilotHome = path.join(root, 'copilot-home');
      const vscodeHome = path.join(root, 'copilot-vscode-home');

      const summary = installer.runInstall({
        dryRun: true,
        force: true,
        doCli: true,
        doVscode: true,
        copilotHome,
        vscodeHome,
      });

      assert.ok(!fs.existsSync(copilotHome));
      assert.ok(!fs.existsSync(vscodeHome));
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
