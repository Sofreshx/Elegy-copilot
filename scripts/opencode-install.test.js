#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { createTestElegyCliShim, withWorkingDirectory } = require('./test-elegy-cli-shim.js');

let passed = 0;

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-opencode-install-'));
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
  const installerPath = pathToFileURL(path.resolve(__dirname, 'opencode-install.mjs')).href;
  const utilsPath = pathToFileURL(path.resolve(__dirname, 'install-surface-utils.mjs')).href;
  const installer = await import(installerPath);
  const utils = await import(utilsPath);

  await test('installer creates curated OpenCode assets and reruns idempotently', async () => {
    withTempDir((root) => {
      const opencodeHome = path.join(root, '.config', 'opencode');
      const skillsHome = path.join(opencodeHome, 'skills');

      const firstSummary = installer.runInstall({
        force: true,
        opencodeHome,
        skillsHome,
      });

      assert.ok(fs.existsSync(path.join(opencodeHome, 'AGENTS.md')));
      assert.ok(fs.existsSync(path.join(skillsHome, 'rubberduck-plan-review', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(skillsHome, 'roadmap-planning', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(skillsHome, 'implementation-review', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(skillsHome, 'implementation-handoff', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(skillsHome, 'skill-discovery', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(skillsHome, 'spec-dev', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(skillsHome, 'spec-authoring', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(skillsHome, 'spec-review', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(skillsHome, 'security', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(skillsHome, 'project-conventions-governance', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(skillsHome, 'stack-detector', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(opencodeHome, '.instruction-engine-opencode-managed.json')));
      assert.ok(firstSummary.counts.created > 0);

      const secondSummary = installer.runInstall({
        opencodeHome,
        skillsHome,
      });
      assert.ok(secondSummary.counts.skipped > 0, 'expected idempotent rerun to skip up-to-date assets');
    });
  });

  await test('installer prunes stale managed assets and preserves diverged files', async () => {
    withTempDir((root) => {
      const opencodeHome = path.join(root, '.config', 'opencode');
      const skillsHome = path.join(opencodeHome, 'skills');
      const inventoryPath = path.join(opencodeHome, '.instruction-engine-opencode-managed.json');

      installer.runInstall({
        force: true,
        opencodeHome,
        skillsHome,
      });

      const staleAgentPath = path.join(opencodeHome, 'agents', 'legacy-agent.md');
      fs.writeFileSync(staleAgentPath, 'legacy managed agent\n', 'utf8');

      const divergedAgentPath = path.join(opencodeHome, 'agents', 'edited-agent.md');
      fs.writeFileSync(divergedAgentPath, 'user modified content\n', 'utf8');

      const staleSkillPath = path.join(skillsHome, 'legacy-skill');
      fs.mkdirSync(staleSkillPath, { recursive: true });
      fs.writeFileSync(path.join(staleSkillPath, 'SKILL.md'), '---\nname: legacy-skill\ndescription: legacy\n---\n', 'utf8');

      const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
      inventory.agents['legacy-agent.md'] = utils.shaFile(staleAgentPath);
      inventory.agents['edited-agent.md'] = utils.shaText('original managed content\n');
      inventory.skills['legacy-skill'] = utils.dirHash(staleSkillPath);
      fs.writeFileSync(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`, 'utf8');

      const summary = installer.runInstall({
        opencodeHome,
        skillsHome,
      });

      assert.ok(!fs.existsSync(staleAgentPath), 'stale managed agent should be pruned');
      assert.ok(!fs.existsSync(staleSkillPath), 'stale managed skill should be pruned');
      assert.ok(fs.existsSync(divergedAgentPath), 'diverged agent should be preserved');
      assert.ok(summary.cleanup.pruneResults.some((entry) => entry.action === 'pruned' && entry.path === staleAgentPath));
      assert.ok(summary.cleanup.pruneResults.some((entry) => entry.action === 'pruned' && entry.path === staleSkillPath));
      assert.ok(summary.cleanup.pruneResults.some((entry) => entry.action === 'skipped_prune_conflict' && entry.path === divergedAgentPath));
    });
  });

  await test('installer dry-run resolves explicit homes without creating files', async () => {
    withTempDir((root) => {
      const opencodeHome = path.join(root, 'opencode-home');
      const skillsHome = path.join(opencodeHome, 'skills');

      const summary = installer.runInstall({
        dryRun: true,
        force: true,
        opencodeHome,
        skillsHome,
      });

      assert.ok(!fs.existsSync(opencodeHome));
      assert.ok(!fs.existsSync(skillsHome));
      assert.ok(summary.counts.wouldCreate > 0 || summary.counts.wouldUpdate > 0 || summary.counts.wouldPrune > 0);
    });
  });

  await test('installer bootstraps opt-in spec-driven repo files', async () => {
    withTempDir((root) => {
      const shim = createTestElegyCliShim(root);
      const opencodeHome = path.join(root, '.config', 'opencode');
      const skillsHome = path.join(opencodeHome, 'skills');
      const repoRoot = path.join(root, 'target-repo');
      fs.mkdirSync(path.join(repoRoot, 'docs', 'system'), { recursive: true });
      fs.mkdirSync(path.join(repoRoot, '.github', 'skills', 'repo-helper'), { recursive: true });
      fs.writeFileSync(path.join(repoRoot, 'README.md'), '# Target Repo\n', 'utf8');
      fs.writeFileSync(path.join(repoRoot, 'docs', 'system', 'index.md'), '# System Docs\n', 'utf8');
      fs.writeFileSync(path.join(repoRoot, 'package.json'), `${JSON.stringify({ name: 'target-repo', scripts: {} }, null, 2)}\n`, 'utf8');
      fs.writeFileSync(path.join(repoRoot, '.github', 'skills', 'repo-helper', 'SKILL.md'), '---\nname: repo-helper\ndescription: Repo helper\n---\n', 'utf8');

      const summary = withWorkingDirectory(shim.shimDir, () => installer.runInstall({
        force: true,
        opencodeHome,
        skillsHome,
        repoRoot,
        elegyCliPath: shim.elegyCliPath,
        setupProfile: 'spec-driven',
      }));

      const copilotInstructions = fs.readFileSync(path.join(repoRoot, '.github', 'copilot-instructions.md'), 'utf8');
      const agentsInstructions = fs.readFileSync(path.join(repoRoot, 'AGENTS.md'), 'utf8');
      const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

      assert.ok(copilotInstructions.includes('instruction-engine:begin spec-driven'));
      assert.ok(agentsInstructions.includes('instruction-engine:begin spec-driven'));
      assert.ok(fs.existsSync(path.join(repoRoot, 'specs', 'index.md')));
      assert.ok(fs.existsSync(path.join(repoRoot, 'scripts', 'validate-specs.js')));
      assert.ok(fs.existsSync(path.join(repoRoot, '.github', 'agents')));
      assert.ok(fs.existsSync(path.join(repoRoot, '.opencode', 'skills', 'repo-helper', 'SKILL.md')));
      assert.strictEqual(packageJson.scripts['validate:specs'], 'node scripts/validate-specs.js');
      assert.strictEqual(summary.repoSetup.profileKey, 'spec-driven');
      assert.strictEqual(summary.repoSetup.repoInstructionFile, 'AGENTS.md');
      assert.ok(summary.repoSetup.skillMirrors.counts.created > 0 || summary.repoSetup.skillMirrors.counts.skipped > 0);
    });
  });

  await test('path resolution supports explicit and HOME-derived destinations', async () => {
    const previousHome = process.env.HOME;
    const previousSkillsHome = process.env.INSTRUCTION_ENGINE_OPENCODE_SKILLS_HOME;
    try {
      process.env.HOME = path.join(os.tmpdir(), 'opencode-home-base');
      delete process.env.INSTRUCTION_ENGINE_OPENCODE_SKILLS_HOME;

      assert.strictEqual(
        installer.resolveOpenCodeHome(path.join('C:\\temp', 'opencode')),
        path.resolve(path.join('C:\\temp', 'opencode')),
      );
      assert.strictEqual(
        installer.resolveSkillsHome('', path.join(process.env.HOME, '.config', 'opencode')),
        path.join(process.env.HOME, '.config', 'opencode', 'skills'),
      );
    } finally {
      if (previousHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = previousHome;
      }

      if (previousSkillsHome === undefined) {
        delete process.env.INSTRUCTION_ENGINE_OPENCODE_SKILLS_HOME;
      } else {
        process.env.INSTRUCTION_ENGINE_OPENCODE_SKILLS_HOME = previousSkillsHome;
      }
    }
  });

  console.log(`\n${passed} tests passed`);
  if (process.exitCode) {
    console.error('Some tests FAILED');
  } else {
    console.log('All tests passed');
  }
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
