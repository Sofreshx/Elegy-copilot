#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { createTestElegyCliShim, withWorkingDirectory } = require('./test-elegy-cli-shim.js');

let passed = 0;

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-repo-setup-bootstrap-'));
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

function writeText(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function createRepoFixture(root, options = {}) {
  const repoRoot = path.join(root, options.repoName || 'target-repo');
  const canonicalDocEntrypoint = options.canonicalDocEntrypoint || path.join('docs', 'system', 'index.md');
  const packageScripts = options.packageScripts || {};
  fs.mkdirSync(repoRoot, { recursive: true });

  writeText(path.join(repoRoot, 'README.md'), '# Target Repo\n');
  writeText(path.join(repoRoot, canonicalDocEntrypoint), '# Docs\n');

  if (options.includePackageJson !== false) {
    writeText(
      path.join(repoRoot, 'package.json'),
      `${JSON.stringify({ name: 'target-repo', scripts: packageScripts }, null, 2)}\n`
    );
  }

  if (options.instructionFile) {
    writeText(path.join(repoRoot, options.instructionFile), options.instructionText || '# Repo Notes\n\nKeep this section.\n');
  }

  if (options.includeRepoSkill !== false) {
    writeText(
      path.join(repoRoot, '.github', 'skills', 'repo-helper', 'SKILL.md'),
      '---\nname: repo-helper\ndescription: Repo helper\n---\n'
    );
  }

  if (options.specsIndexText) {
    writeText(path.join(repoRoot, 'specs', 'index.md'), options.specsIndexText);
  }

  return repoRoot;
}

function findResult(summary, targetPath) {
  return summary.results.find((entry) => entry.path === targetPath) || null;
}

async function main() {
  const modulePath = pathToFileURL(path.resolve(__dirname, 'repo-setup-profile-bootstrap.mjs')).href;
  const bootstrap = await import(modulePath);

  await test('bootstrap applies spec-driven files with explicit Elegy CLI path', async () => {
    withTempDir((root) => {
      const repoRoot = createRepoFixture(root, { instructionFile: 'AGENTS.md' });
      const shim = createTestElegyCliShim(root);

      const summary = withWorkingDirectory(shim.shimDir, () => bootstrap.runRepoSetupProfileBootstrap({
        surface: 'codex',
        repoRoot,
        profileKey: 'spec-driven',
        elegyCliPath: shim.elegyCliPath,
        force: true,
      }));

      const agentsInstructions = fs.readFileSync(path.join(repoRoot, 'AGENTS.md'), 'utf8');
      const copilotInstructions = fs.readFileSync(path.join(repoRoot, '.github', 'copilot-instructions.md'), 'utf8');
      const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

      assert.ok(summary.ok);
      assert.strictEqual(summary.repoInstructionFile, 'AGENTS.md');
      assert.strictEqual(summary.elegyCliPath, path.resolve(shim.elegyCliPath));
      assert.ok(agentsInstructions.includes('Keep this section.'));
      assert.ok(agentsInstructions.includes('instruction-engine:begin spec-driven'));
      assert.ok(copilotInstructions.includes('spec-authoring'));
      assert.ok(fs.existsSync(path.join(repoRoot, 'specs', 'index.md')));
      assert.ok(fs.existsSync(path.join(repoRoot, 'scripts', 'validate-specs.js')));
      assert.ok(fs.existsSync(path.join(repoRoot, '.agents', 'skills', 'repo-helper', 'SKILL.md')));
      assert.strictEqual(packageJson.scripts['validate:specs'], 'node scripts/validate-specs.js');
    });
  });

  await test('bootstrap falls back to INSTRUCTION_ENGINE_ELEGY_CLI_PATH', async () => {
    withTempDir((root) => {
      const repoRoot = createRepoFixture(root, { includeRepoSkill: false });
      const shim = createTestElegyCliShim(root);
      const previousPath = process.env.INSTRUCTION_ENGINE_ELEGY_CLI_PATH;

      try {
        process.env.INSTRUCTION_ENGINE_ELEGY_CLI_PATH = shim.elegyCliPath;
        const summary = withWorkingDirectory(shim.shimDir, () => bootstrap.runRepoSetupProfileBootstrap({
          surface: 'copilot',
          repoRoot,
          profileKey: 'spec-driven',
          force: true,
        }));

        assert.ok(summary.ok);
        assert.strictEqual(summary.elegyCliPath, path.resolve(shim.elegyCliPath));
        assert.deepStrictEqual(summary.skillMirrors.targets, []);
        assert.ok(fs.existsSync(path.join(repoRoot, 'AGENTS.md')));
      } finally {
        if (previousPath === undefined) {
          delete process.env.INSTRUCTION_ENGINE_ELEGY_CLI_PATH;
        } else {
          process.env.INSTRUCTION_ENGINE_ELEGY_CLI_PATH = previousPath;
        }
      }
    });
  });

  await test('bootstrap requires an Elegy CLI path when no option or env is present', async () => {
    withTempDir((root) => {
      const repoRoot = createRepoFixture(root);
      const previousPath = process.env.INSTRUCTION_ENGINE_ELEGY_CLI_PATH;

      try {
        delete process.env.INSTRUCTION_ENGINE_ELEGY_CLI_PATH;
        assert.throws(
          () => bootstrap.runRepoSetupProfileBootstrap({
            surface: 'codex',
            repoRoot,
            profileKey: 'spec-driven',
          }),
          /Repo setup bootstrap requires Elegy CLI path\. Pass --elegy-cli <path> or set INSTRUCTION_ENGINE_ELEGY_CLI_PATH\./
        );
      } finally {
        if (previousPath === undefined) {
          delete process.env.INSTRUCTION_ENGINE_ELEGY_CLI_PATH;
        } else {
          process.env.INSTRUCTION_ENGINE_ELEGY_CLI_PATH = previousPath;
        }
      }
    });
  });

  await test('bootstrap dry-run maps preview receipt actions without writing files', async () => {
    withTempDir((root) => {
      const repoRoot = createRepoFixture(root);
      const shim = createTestElegyCliShim(root);
      const summary = withWorkingDirectory(shim.shimDir, () => bootstrap.runRepoSetupProfileBootstrap({
        surface: 'opencode',
        repoRoot,
        profileKey: 'spec-driven',
        elegyCliPath: shim.elegyCliPath,
        dryRun: true,
        force: true,
      }));

      assert.ok(summary.ok);
      assert.strictEqual(findResult(summary, path.join(repoRoot, '.github', 'copilot-instructions.md')).action, 'would_create');
      assert.strictEqual(findResult(summary, path.join(repoRoot, 'AGENTS.md')).action, 'would_create');
      assert.strictEqual(findResult(summary, path.join(repoRoot, 'scripts', 'validate-specs.js')).action, 'would_create');
      assert.strictEqual(findResult(summary, path.join(repoRoot, 'package.json')).action, 'would_update');
      assert.ok(summary.counts.wouldCreate > 0);
      assert.ok(summary.counts.wouldUpdate > 0);
      assert.ok(!fs.existsSync(path.join(repoRoot, '.github', 'copilot-instructions.md')));
      assert.ok(!fs.existsSync(path.join(repoRoot, 'AGENTS.md')));
      assert.ok(!fs.existsSync(path.join(repoRoot, 'scripts', 'validate-specs.js')));
      assert.ok(!fs.existsSync(path.join(repoRoot, 'specs', 'index.md')));
      assert.ok(!fs.existsSync(path.join(repoRoot, '.opencode', 'skills', 'repo-helper', 'SKILL.md')));
    });
  });

  await test('bootstrap preserves existing specs index and validate:specs conflicts', async () => {
    withTempDir((root) => {
      const repoRoot = createRepoFixture(root, {
        instructionFile: 'AGENTS.md',
        packageScripts: { 'validate:specs': 'pnpm validate-specs' },
        specsIndexText: '# Specs\n\n- Custom entry\n',
      });
      const shim = createTestElegyCliShim(root);

      const summary = withWorkingDirectory(shim.shimDir, () => bootstrap.runRepoSetupProfileBootstrap({
        surface: 'opencode',
        repoRoot,
        profileKey: 'spec-driven',
        elegyCliPath: shim.elegyCliPath,
        force: true,
      }));

      const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
      const specsIndex = fs.readFileSync(path.join(repoRoot, 'specs', 'index.md'), 'utf8');

      assert.strictEqual(packageJson.scripts['validate:specs'], 'pnpm validate-specs');
      assert.ok(specsIndex.includes('Custom entry'));
      assert.strictEqual(findResult(summary, path.join(repoRoot, 'package.json')).action, 'skipped_conflict');
      assert.strictEqual(findResult(summary, path.join(repoRoot, 'specs', 'index.md')).action, 'skipped');
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
