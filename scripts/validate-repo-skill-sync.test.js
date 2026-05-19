#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { runValidation } = require('./validate-repo-skill-sync.js');

let passed = 0;

function writeFile(root, relativePath, content) {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

async function withTempRepo(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-repo-skill-sync-gate-'));
  try {
    return await fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
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
  await test('repo skill sync validator passes when generated mirrors match canonical source', async () => {
    await withTempRepo(async (repoRoot) => {
      const skillDoc = ['---', 'name: example-skill', 'description: Example.', '---', '', '# Example'].join('\n');
      writeFile(repoRoot, '.github/skills/example-skill/SKILL.md', skillDoc);
      writeFile(repoRoot, '.agents/skills/example-skill/SKILL.md', skillDoc);
      writeFile(repoRoot, '.opencode/skills/example-skill/SKILL.md', skillDoc);
      writeFile(repoRoot, '.gemini/skills/example-skill/SKILL.md', skillDoc);
      writeFile(repoRoot, 'scripts/repo-skill-sync.targets.json', JSON.stringify({
        schemaVersion: 1,
        canonicalSourceRoot: '.github/skills',
        targets: {
          codex: { kind: 'repo-mirror', enabled: true, mirrorRoot: '.agents/skills' },
          opencode: { kind: 'repo-mirror', enabled: true, mirrorRoot: '.opencode/skills' },
          'gemini-cli': { kind: 'repo-mirror', enabled: true, mirrorRoot: '.gemini/skills' },
        },
      }, null, 2));

      const validation = await runValidation({
        repoRoot,
        configPath: path.join(repoRoot, 'scripts', 'repo-skill-sync.targets.json'),
      });
      assert.deepStrictEqual(validation.errors, []);
    });
  });

  await test('repo skill sync validator reports missing and stale mirrors', async () => {
    await withTempRepo(async (repoRoot) => {
      writeFile(repoRoot, '.github/skills/example-skill/SKILL.md', ['---', 'name: example-skill', 'description: Canonical.', '---', '', '# Example'].join('\n'));
      writeFile(repoRoot, '.agents/skills/example-skill/SKILL.md', ['---', 'name: example-skill', 'description: Drifted.', '---', '', '# Example'].join('\n'));
      writeFile(repoRoot, 'scripts/repo-skill-sync.targets.json', JSON.stringify({
        schemaVersion: 1,
        canonicalSourceRoot: '.github/skills',
        targets: {
          codex: { kind: 'repo-mirror', enabled: true, mirrorRoot: '.agents/skills' },
          opencode: { kind: 'repo-mirror', enabled: true, mirrorRoot: '.opencode/skills' },
        },
      }, null, 2));

      const validation = await runValidation({
        repoRoot,
        configPath: path.join(repoRoot, 'scripts', 'repo-skill-sync.targets.json'),
      });
      assert.ok(validation.errors.some((entry) => /codex:example-skill stale/i.test(entry)), validation.errors.join('\n'));
      assert.ok(validation.errors.some((entry) => /opencode:example-skill missing/i.test(entry)), validation.errors.join('\n'));
    });
  });

  console.log(`\n${passed} tests passed`);
  if (process.exitCode) {
    console.error('Some tests FAILED');
  } else {
    console.log('All tests passed');
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
