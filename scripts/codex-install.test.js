#!/usr/bin/env node
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { createTestElegyCliShim, withWorkingDirectory } = require('./test-elegy-cli-shim.js');

let passed = 0;

function shaText(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-codex-install-'));
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
  const modulePath = pathToFileURL(path.resolve(__dirname, 'codex-install.mjs')).href;
  const utilsPath = pathToFileURL(path.resolve(__dirname, 'install-surface-utils.mjs')).href;
  const installer = await import(modulePath);
  const { dirHash } = await import(utilsPath);

  await test('manifest installs the composed global instructions rather than the home stub', async () => {
    const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'codex-assets', 'manifest.json'), 'utf8'));
    const instructions = manifest.assets.find((asset) => asset.id === 'codex-global-instructions');
    assert.strictEqual(instructions.source, 'catalog-assets/instructions/agent-session-defaults.md');
    assert.strictEqual(instructions.appendix, 'codex-assets/home/AGENTS-appendix.md');
    assert.strictEqual(instructions.destination, 'AGENTS.md');
  });

  await test('installer creates lean Codex assets and reruns idempotently', async () => {
    withTempDir((root) => {
      const codexHome = path.join(root, '.codex');
      const skillsHome = path.join(codexHome, 'skills');

      const firstSummary = installer.runInstall({
        force: true,
        codexHome,
        skillsHome,
      });
      assert.ok(fs.existsSync(path.join(codexHome, 'AGENTS.md')));
      const agentsInstructions = fs.readFileSync(path.join(codexHome, 'AGENTS.md'), 'utf8');
      assert.ok(!agentsInstructions.includes('## Code Mode Batching'));
      assert.ok(agentsInstructions.includes('explicitly requests subagents and parallel agent work'));
      assert.ok(agentsInstructions.includes('separate user request'));
      assert.ok(agentsInstructions.includes('about five meaningful tool'));
      assert.ok(agentsInstructions.includes('Keep smaller,'));
      assert.ok(agentsInstructions.includes('Bypass only for user-requested'));
      assert.ok(agentsInstructions.includes('Independence determines whether review should be delegated'));
      assert.ok(agentsInstructions.includes('complexity and consequence determine whether the reviewer should be Luna or Sol'));
      assert.ok(!agentsInstructions.includes('at least one safe Luna delegation'));
      assert.ok(fs.existsSync(path.join(codexHome, 'agents', 'explorer.toml')));
      assert.ok(fs.existsSync(path.join(codexHome, 'agents', 'reviewer.toml')));
      assert.ok(fs.existsSync(path.join(codexHome, 'agents', 'reviewer_strong.toml')));
      assert.ok(fs.existsSync(path.join(codexHome, 'agents', 'worker.toml')));
      assert.ok(fs.existsSync(path.join(codexHome, 'agents', 'test-runner.toml')));
      assert.ok(fs.existsSync(path.join(codexHome, 'agents', 'sweeper.toml')));
      assert.ok(fs.existsSync(path.join(skillsHome, 'repo-setup', 'SKILL.md')));
      for (const retainedSkill of [
        'repo-backed-obsidian-docs',
        'sweeper-cleanup',
        'repo-quality-setup',
        'agents-md-authoring',
        'tdd',
      ]) {
        assert.ok(fs.existsSync(path.join(skillsHome, retainedSkill, 'SKILL.md')), retainedSkill);
      }
      for (const removedSkill of [
        'skill-discovery',
        'rubberduck-plan-review',
        'implementation-review',
        'implementation-handoff',
        'spec-dev',
        'spec-authoring',
        'spec-review',
        'spec-planning-bridge',
        'elegy-planning',
        'commit-check-setup',
        'brainstorming',
      ]) {
        assert.ok(!fs.existsSync(path.join(skillsHome, removedSkill)), removedSkill);
      }
      assert.ok(!fs.existsSync(path.join(codexHome, 'agents', 'code-reviewer.toml')));
      assert.ok(!fs.existsSync(path.join(skillsHome, 'core-guardrails', 'SKILL.md')));
      assert.strictEqual(firstSummary.generatedRoles, 0, 'Codex install should not generate engine role wrappers');
      const explorerAgent = fs.readFileSync(path.join(codexHome, 'agents', 'explorer.toml'), 'utf8');
      assert.ok(explorerAgent.includes('model = "gpt-5.6-luna"'));
      assert.ok(!explorerAgent.includes('model_reasoning_effort ='));
      assert.doesNotMatch(explorerAgent, /^\[elegy\]$/m);
      assert.ok(explorerAgent.includes('developer_instructions = """'));
      const reviewerAgent = fs.readFileSync(path.join(codexHome, 'agents', 'reviewer.toml'), 'utf8');
      assert.ok(reviewerAgent.includes('model = "gpt-5.6-luna"'));
      assert.ok(reviewerAgent.includes('bounded implementation'));
      assert.ok(!reviewerAgent.includes('complex plans'));
      const strongReviewerAgent = fs.readFileSync(path.join(codexHome, 'agents', 'reviewer_strong.toml'), 'utf8');
      assert.ok(strongReviewerAgent.includes('model = "gpt-5.6-sol"'));
      assert.ok(strongReviewerAgent.includes('sandbox_mode = "read-only"'));
      assert.ok(strongReviewerAgent.includes('architecture'));
      assert.ok(strongReviewerAgent.includes('security'));
      const workerAgent = fs.readFileSync(path.join(codexHome, 'agents', 'worker.toml'), 'utf8');
      assert.ok(workerAgent.includes('model = "gpt-5.6-luna"'));
      assert.ok(!workerAgent.includes('model_reasoning_effort ='));
      assert.ok(workerAgent.includes('Work only within the file or module ownership'));

      const configToml = fs.readFileSync(path.join(codexHome, 'config.toml'), 'utf8');
      const profileToml = fs.readFileSync(path.join(codexHome, 'instruction_engine_plan_review.config.toml'), 'utf8');
      assert.ok(configToml.includes('review_model = "deepseek-v4-pro"'));
      assert.ok(configToml.includes('[agents]'));
      assert.ok(configToml.includes('enabled = true'));
      assert.ok(configToml.includes('max_concurrent_threads_per_session = 6'));
      assert.ok(!configToml.includes('max_threads ='));
      assert.ok(configToml.includes('default_subagent_model = "gpt-5.6-luna"'));
      assert.ok(configToml.includes('default_subagent_reasoning_effort = "high"'));
      assert.ok(configToml.includes('max_depth = 1'));
      assert.ok(configToml.includes('job_max_runtime_seconds = 1800'));
      assert.ok(!configToml.includes('[profiles.instruction_engine_plan_review]'));
      assert.ok(profileToml.includes('model = "mimo-v2-pro"'));
      assert.ok(profileToml.includes('model_provider = "opencode-go"'));
      assert.ok(profileToml.includes('plan_mode_reasoning_effort = "xhigh"'));

      const secondSummary = installer.runInstall({
        codexHome,
        skillsHome,
      });
      const secondConfig = fs.readFileSync(path.join(codexHome, 'config.toml'), 'utf8');
      assert.strictEqual(secondConfig, configToml);
      assert.ok(secondSummary.counts.skipped > 0, 'expected idempotent rerun to skip up-to-date assets');
    });
  });

  await test('installer dry-run resolves explicit homes without creating files', async () => {
    withTempDir((root) => {
      const codexHome = path.join(root, 'codex-home');
      const skillsHome = path.join(codexHome, 'skills');

      const summary = installer.runInstall({
        dryRun: true,
        force: true,
        codexHome,
        skillsHome,
      });

      assert.ok(!fs.existsSync(codexHome));
      assert.ok(!fs.existsSync(skillsHome));
      assert.ok(summary.counts.wouldCreate > 0 || summary.counts.wouldUpdate > 0);
    });
  });

  await test('installer upgrades an older managed AGENTS.md but preserves user edits', async () => {
    withTempDir((root) => {
      const codexHome = path.join(root, '.codex');
      const skillsHome = path.join(codexHome, 'skills');
      const agentsPath = path.join(codexHome, 'AGENTS.md');
      const inventoryPath = path.join(codexHome, '.elegy-copilot-codex-managed.json');

      installer.runInstall({ force: true, codexHome, skillsHome });
      const currentInstructions = fs.readFileSync(agentsPath, 'utf8');

      const oldManagedInstructions = '# Older managed Codex instructions\n';
      fs.writeFileSync(agentsPath, oldManagedInstructions, 'utf8');
      const oldInventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
      oldInventory.instructions['AGENTS.md'] = shaText(oldManagedInstructions);
      fs.writeFileSync(inventoryPath, `${JSON.stringify(oldInventory, null, 2)}\n`, 'utf8');

      const upgradeSummary = installer.runInstall({ codexHome, skillsHome });
      assert.strictEqual(fs.readFileSync(agentsPath, 'utf8'), currentInstructions);
      assert.ok(
        upgradeSummary.assets.some((asset) => asset.id === 'codex-global-instructions' && asset.action === 'updated'),
        'expected the previously managed global instructions to upgrade without --force',
      );

      const userInstructions = `${currentInstructions}\n# Local user customization\n`;
      fs.writeFileSync(agentsPath, userInstructions, 'utf8');
      const preserveSummary = installer.runInstall({ codexHome, skillsHome });
      assert.strictEqual(fs.readFileSync(agentsPath, 'utf8'), userInstructions);
      assert.ok(
        preserveSummary.assets.some((asset) => asset.id === 'codex-global-instructions' && asset.action === 'skipped_conflict'),
        'expected a user-modified global instructions file to remain untouched',
      );
      const preservedInventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
      assert.strictEqual(preservedInventory.instructions['AGENTS.md'], shaText(currentInstructions));
    });
  });

  await test('installer reports a global override that suppresses managed AGENTS.md', async () => {
    withTempDir((root) => {
      const codexHome = path.join(root, '.codex');
      const skillsHome = path.join(codexHome, 'skills');
      fs.mkdirSync(codexHome, { recursive: true });
      fs.writeFileSync(path.join(codexHome, 'AGENTS.override.md'), '# Temporary override\n', 'utf8');

      const summary = installer.runInstall({ force: true, codexHome, skillsHome });
      assert.strictEqual(summary.instructions.overridePresent, true);
      assert.strictEqual(summary.instructions.activeGlobalPath, path.join(codexHome, 'AGENTS.override.md'));
      assert.ok(fs.existsSync(summary.instructions.managedPath));
    });
  });

  await test('installer prunes removed managed skills but preserves diverged copies', async () => {
    withTempDir((root) => {
      const codexHome = path.join(root, '.codex');
      const skillsHome = path.join(codexHome, 'skills');
      const inventoryPath = path.join(codexHome, '.elegy-copilot-codex-managed.json');
      installer.runInstall({ force: true, codexHome, skillsHome });

      const staleSkillPath = path.join(skillsHome, 'spec-dev');
      const staleSourcePath = path.resolve(__dirname, '..', 'catalog-assets', 'shared-skills', 'spec-dev');
      fs.cpSync(staleSourcePath, staleSkillPath, { recursive: true });

      const divergedSkillPath = path.join(skillsHome, 'implementation-review');
      fs.mkdirSync(divergedSkillPath, { recursive: true });
      fs.writeFileSync(path.join(divergedSkillPath, 'SKILL.md'), '# User-owned implementation review\n', 'utf8');

      const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
      inventory.skills['spec-dev'] = dirHash(staleSkillPath);
      inventory.skills['implementation-review'] = dirHash(
        path.resolve(__dirname, '..', 'catalog-assets', 'shared-skills', 'implementation-review'),
      );
      fs.writeFileSync(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`, 'utf8');

      const summary = installer.runInstall({ codexHome, skillsHome });
      assert.ok(!fs.existsSync(staleSkillPath), 'removed managed skill should be pruned');
      assert.ok(fs.existsSync(divergedSkillPath), 'diverged skill should remain user-owned');
      assert.ok(summary.cleanup.pruneResults.some(
        (entry) => entry.action === 'pruned' && entry.path === staleSkillPath,
      ));
      assert.ok(summary.cleanup.pruneResults.some(
        (entry) => entry.action === 'skipped_prune_conflict' && entry.path === divergedSkillPath,
      ));
    });
  });

  await test('installer omits managed OpenCode provider defaults when external providers are disabled', async () => {
    withTempDir((root) => {
      const codexHome = path.join(root, '.codex');
      const skillsHome = path.join(codexHome, 'skills');

      installer.runInstall({
        force: true,
        codexHome,
        skillsHome,
        enableExternalProviders: false,
      });

      const configToml = fs.readFileSync(path.join(codexHome, 'config.toml'), 'utf8');
      const profileToml = fs.readFileSync(path.join(codexHome, 'instruction_engine_plan_review.config.toml'), 'utf8');
      assert.ok(!configToml.includes('[model_providers.'), configToml);
      assert.ok(!profileToml.includes('model_provider = "opencode-go"'), profileToml);
      assert.ok(!profileToml.includes('model = "mimo-v2-pro"'), profileToml);
      assert.ok(profileToml.includes('plan_mode_reasoning_effort = "xhigh"'), profileToml);
    });
  });

  await test('installer bootstraps opt-in spec-driven repo files', async () => {
    withTempDir((root) => {
      const shim = createTestElegyCliShim(root);
      const codexHome = path.join(root, '.codex');
      const skillsHome = path.join(codexHome, 'skills');
      const repoRoot = path.join(root, 'target-repo');
      fs.mkdirSync(path.join(repoRoot, 'docs'), { recursive: true });
      fs.mkdirSync(path.join(repoRoot, '.github', 'skills', 'repo-helper'), { recursive: true });
      fs.writeFileSync(path.join(repoRoot, 'README.md'), '# Target Repo\n', 'utf8');
      fs.writeFileSync(path.join(repoRoot, 'docs', 'index.md'), '# Docs\n', 'utf8');
      fs.writeFileSync(path.join(repoRoot, 'package.json'), `${JSON.stringify({ name: 'target-repo', scripts: {} }, null, 2)}\n`, 'utf8');
      fs.writeFileSync(path.join(repoRoot, 'AGENTS.md'), '# Repo Notes\n\nKeep this section.\n', 'utf8');
      fs.writeFileSync(path.join(repoRoot, '.github', 'skills', 'repo-helper', 'SKILL.md'), '---\nname: repo-helper\ndescription: Repo helper\n---\n', 'utf8');

      const summary = withWorkingDirectory(shim.shimDir, () => installer.runInstall({
        force: true,
        codexHome,
        skillsHome,
        repoRoot,
        elegyCliPath: shim.elegyCliPath,
        setupProfile: 'spec-driven',
      }));

      const copilotInstructions = fs.readFileSync(path.join(repoRoot, '.github', 'copilot-instructions.md'), 'utf8');
      const agentsInstructions = fs.readFileSync(path.join(repoRoot, 'AGENTS.md'), 'utf8');
      const specsIndex = fs.readFileSync(path.join(repoRoot, 'docs', 'specs', 'index.md'), 'utf8');
      assert.ok(copilotInstructions.includes('elegy-copilot:begin spec-driven'));
      assert.ok(copilotInstructions.includes('spec-authoring'));
      assert.ok(agentsInstructions.includes('Keep this section.'));
      assert.ok(agentsInstructions.includes('elegy-copilot:begin spec-driven'));
      assert.ok(specsIndex.includes('# Specs'));
      assert.ok(fs.existsSync(path.join(repoRoot, '.github', 'agents')));
      assert.ok(fs.existsSync(path.join(repoRoot, '.github', 'skills')));
      assert.ok(fs.existsSync(path.join(repoRoot, '.agents', 'skills', 'repo-helper', 'SKILL.md')));
      assert.strictEqual(summary.repoSetup.profileKey, 'spec-driven');
      assert.strictEqual(summary.repoSetup.repoInstructionFile, 'AGENTS.md');
      assert.ok(summary.repoSetup.skillMirrors.counts.created > 0 || summary.repoSetup.skillMirrors.counts.skipped > 0);

      fs.writeFileSync(path.join(repoRoot, 'docs', 'specs', 'index.md'), '# Specs\n\n- Custom entry\n', 'utf8');
      withWorkingDirectory(shim.shimDir, () => installer.runInstall({
        codexHome,
        skillsHome,
        repoRoot,
        elegyCliPath: shim.elegyCliPath,
        setupProfile: 'spec-driven',
      }));
      assert.ok(fs.readFileSync(path.join(repoRoot, 'docs', 'specs', 'index.md'), 'utf8').includes('Custom entry'));
    });
  });

  await test('path resolution supports explicit and HOME-derived destinations', async () => {
    const previousHome = process.env.HOME;
    const previousSkillsHome = process.env.INSTRUCTION_ENGINE_CODEX_SKILLS_HOME;
    try {
      process.env.HOME = path.join(os.tmpdir(), 'codex-home-base');
      delete process.env.INSTRUCTION_ENGINE_CODEX_SKILLS_HOME;

      assert.strictEqual(
        installer.resolveCodexHome(path.join('C:\\temp', 'codex')),
        path.resolve(path.join('C:\\temp', 'codex')),
      );
      assert.strictEqual(
        installer.resolveSkillsHome(''),
        path.join(process.env.HOME, '.codex', 'skills'),
      );
      assert.strictEqual(
        installer.resolveSkillsHome('', path.join(process.env.HOME, 'custom-codex-home')),
        path.join(process.env.HOME, 'custom-codex-home', 'skills'),
      );
    } finally {
      if (previousHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = previousHome;
      }

      if (previousSkillsHome === undefined) {
        delete process.env.INSTRUCTION_ENGINE_CODEX_SKILLS_HOME;
      } else {
        process.env.INSTRUCTION_ENGINE_CODEX_SKILLS_HOME = previousSkillsHome;
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
