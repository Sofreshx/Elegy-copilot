#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

let passed = 0;

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-antigravity-install-'));
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
  const modulePath = pathToFileURL(path.resolve(__dirname, 'antigravity-install.mjs')).href;
  const installer = await import(modulePath);

  await test('installer creates Antigravity skills and GEMINI.md block', async () => {
    withTempDir((root) => {
      const geminiHome = path.join(root, '.gemini');
      const antigravityHome = path.join(geminiHome, 'antigravity');
      const skillsHome = path.join(antigravityHome, 'skills');

      const summary = installer.runInstall({
        force: true,
        geminiHome,
        antigravityHome,
        skillsHome,
      });

      assert.ok(fs.existsSync(path.join(skillsHome, 'core-guardrails', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(skillsHome, 'project-guidelines', 'SKILL.md')));
      assert.ok(summary.counts.created > 0);

      const geminiInstructions = fs.readFileSync(path.join(geminiHome, 'GEMINI.md'), 'utf8');
      assert.ok(geminiInstructions.includes('<!-- instruction-engine:begin antigravity -->'));
      assert.ok(geminiInstructions.includes('Use the shared instruction-engine skills installed under'));
      assert.ok(geminiInstructions.includes('<!-- instruction-engine:end antigravity -->'));
    });
  });

  await test('installer updates the managed GEMINI block without touching surrounding user content', async () => {
    withTempDir((root) => {
      const geminiHome = path.join(root, '.gemini');
      const antigravityHome = path.join(geminiHome, 'antigravity');
      const skillsHome = path.join(antigravityHome, 'skills');
      const geminiInstructionsPath = path.join(geminiHome, 'GEMINI.md');
      fs.mkdirSync(geminiHome, { recursive: true });
      fs.writeFileSync(
        geminiInstructionsPath,
        [
          '# Personal Notes',
          '',
          'Keep this section.',
          '',
          '<!-- instruction-engine:begin antigravity -->',
          'Outdated managed content.',
          '<!-- instruction-engine:end antigravity -->',
          '',
          'Keep this footer too.',
          '',
        ].join('\n'),
        'utf8',
      );

      const firstSummary = installer.runInstall({
        geminiHome,
        antigravityHome,
        skillsHome,
      });
      assert.strictEqual(firstSummary.instructions.action, 'updated');

      const updatedInstructions = fs.readFileSync(geminiInstructionsPath, 'utf8');
      assert.ok(updatedInstructions.includes('# Personal Notes'));
      assert.ok(updatedInstructions.includes('Keep this section.'));
      assert.ok(updatedInstructions.includes('Keep this footer too.'));
      assert.ok(!updatedInstructions.includes('Outdated managed content.'));
      assert.strictEqual(updatedInstructions.match(/instruction-engine:begin antigravity/g)?.length || 0, 1);

      const secondSummary = installer.runInstall({
        geminiHome,
        antigravityHome,
        skillsHome,
      });
      assert.strictEqual(secondSummary.instructions.action, 'skipped');
    });
  });

  await test('installer dry-run resolves explicit homes without creating files', async () => {
    withTempDir((root) => {
      const geminiHome = path.join(root, 'gemini-home');
      const antigravityHome = path.join(geminiHome, 'antigravity');
      const skillsHome = path.join(antigravityHome, 'skills');

      const summary = installer.runInstall({
        dryRun: true,
        force: true,
        geminiHome,
        antigravityHome,
        skillsHome,
      });

      assert.ok(!fs.existsSync(geminiHome));
      assert.ok(!fs.existsSync(skillsHome));
      assert.ok(summary.counts.wouldCreate > 0 || summary.counts.wouldUpdate > 0);
    });
  });

  await test('path resolution supports explicit and HOME-derived destinations', async () => {
    const previousHome = process.env.HOME;
    const previousAntigravityHome = process.env.INSTRUCTION_ENGINE_ANTIGRAVITY_HOME;
    const previousSkillsHome = process.env.INSTRUCTION_ENGINE_ANTIGRAVITY_SKILLS_HOME;
    try {
      process.env.HOME = path.join(os.tmpdir(), 'gemini-home-base');
      delete process.env.INSTRUCTION_ENGINE_ANTIGRAVITY_HOME;
      delete process.env.INSTRUCTION_ENGINE_ANTIGRAVITY_SKILLS_HOME;

      assert.strictEqual(
        installer.resolveGeminiHome(path.join('C:\\temp', 'gemini')),
        path.resolve(path.join('C:\\temp', 'gemini')),
      );
      assert.strictEqual(
        installer.resolveAntigravityHome('', path.join(process.env.HOME, '.gemini')),
        path.join(process.env.HOME, '.gemini', 'antigravity'),
      );
      assert.strictEqual(
        installer.resolveSkillsHome('', path.join(process.env.HOME, '.gemini', 'custom-antigravity')),
        path.join(process.env.HOME, '.gemini', 'custom-antigravity', 'skills'),
      );
    } finally {
      if (previousHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = previousHome;
      }
      if (previousAntigravityHome === undefined) {
        delete process.env.INSTRUCTION_ENGINE_ANTIGRAVITY_HOME;
      } else {
        process.env.INSTRUCTION_ENGINE_ANTIGRAVITY_HOME = previousAntigravityHome;
      }
      if (previousSkillsHome === undefined) {
        delete process.env.INSTRUCTION_ENGINE_ANTIGRAVITY_SKILLS_HOME;
      } else {
        process.env.INSTRUCTION_ENGINE_ANTIGRAVITY_SKILLS_HOME = previousSkillsHome;
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
