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

  await test('installer creates Codex assets, generated roles, and reruns idempotently', async () => {
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
      assert.ok(fs.existsSync(path.join(codexHome, 'agents', 'code-reviewer.toml')));
      assert.ok(fs.existsSync(path.join(skillsHome, 'repo-setup', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(skillsHome, 'core-guardrails', 'SKILL.md')));
      assert.ok(firstSummary.generatedRoles > 0, 'expected at least one generated engine role');

      const generatedRole = fs.readFileSync(path.join(codexHome, 'agents', 'code-reviewer.toml'), 'utf8');
      assert.ok(generatedRole.includes('name = "code-reviewer"'));
      assert.ok(generatedRole.includes('developer_instructions = '));

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
