#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

let passed = 0;

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
  const installer = await import(modulePath);

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
      assert.ok(fs.existsSync(path.join(codexHome, 'agents', 'reviewer.toml')));
      assert.ok(fs.existsSync(path.join(skillsHome, 'repo-setup', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(skillsHome, 'rubberduck-plan-review', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(skillsHome, 'implementation-review', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(skillsHome, 'implementation-handoff', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(skillsHome, 'roadmap-planning', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(skillsHome, 'spec-dev', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(skillsHome, 'spec-authoring', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(skillsHome, 'spec-review', 'SKILL.md')));
      assert.ok(!fs.existsSync(path.join(codexHome, 'agents', 'code-reviewer.toml')));
      assert.ok(!fs.existsSync(path.join(skillsHome, 'core-guardrails', 'SKILL.md')));
      assert.strictEqual(firstSummary.generatedRoles, 0, 'Codex install should not generate engine role wrappers');

      const configToml = fs.readFileSync(path.join(codexHome, 'config.toml'), 'utf8');
      assert.ok(configToml.includes('review_model = "gpt-5.4"'));
      assert.ok(configToml.includes('[profiles.instruction_engine_plan_review]'));

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

  await test('installer bootstraps opt-in spec-driven repo files', async () => {
    withTempDir((root) => {
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

      const summary = installer.runInstall({
        force: true,
        codexHome,
        skillsHome,
        repoRoot,
        setupProfile: 'spec-driven',
      });

      const copilotInstructions = fs.readFileSync(path.join(repoRoot, '.github', 'copilot-instructions.md'), 'utf8');
      const agentsInstructions = fs.readFileSync(path.join(repoRoot, 'AGENTS.md'), 'utf8');
      const specsIndex = fs.readFileSync(path.join(repoRoot, 'specs', 'index.md'), 'utf8');
      const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

      assert.ok(copilotInstructions.includes('instruction-engine:begin spec-driven'));
      assert.ok(copilotInstructions.includes('spec-authoring'));
      assert.ok(agentsInstructions.includes('Keep this section.'));
      assert.ok(agentsInstructions.includes('instruction-engine:begin spec-driven'));
      assert.ok(specsIndex.includes('# Specs'));
      assert.ok(fs.existsSync(path.join(repoRoot, 'scripts', 'validate-specs.js')));
      assert.ok(fs.existsSync(path.join(repoRoot, '.github', 'agents')));
      assert.ok(fs.existsSync(path.join(repoRoot, '.github', 'skills')));
      assert.ok(fs.existsSync(path.join(repoRoot, '.agents', 'skills', 'repo-helper', 'SKILL.md')));
      assert.strictEqual(packageJson.scripts['validate:specs'], 'node scripts/validate-specs.js');
      assert.strictEqual(summary.repoSetup.profileKey, 'spec-driven');
      assert.strictEqual(summary.repoSetup.repoInstructionFile, 'AGENTS.md');
      assert.ok(summary.repoSetup.skillMirrors.counts.created > 0 || summary.repoSetup.skillMirrors.counts.skipped > 0);

      fs.writeFileSync(path.join(repoRoot, 'specs', 'index.md'), '# Specs\n\n- Custom entry\n', 'utf8');
      installer.runInstall({
        codexHome,
        skillsHome,
        repoRoot,
        setupProfile: 'spec-driven',
      });
      assert.ok(fs.readFileSync(path.join(repoRoot, 'specs', 'index.md'), 'utf8').includes('Custom entry'));
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
