#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

let passed = 0;

function writeFile(root, relativePath, content) {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function withTempRepo(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-repo-skill-sync-'));
  try {
    return fn(root);
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
  const modulePath = pathToFileURL(path.resolve(__dirname, 'sync-repo-skills.mjs')).href;
  const syncModule = await import(modulePath);

  await test('sync script generates Codex, OpenCode, and Gemini mirrors from canonical .github skills', async () => {
    withTempRepo((repoRoot) => {
      writeFile(repoRoot, '.github/skills/example-skill/SKILL.md', ['---', 'name: example-skill', 'description: Example.', '---', '', '# Example'].join('\n'));
      writeFile(repoRoot, 'scripts/repo-skill-sync.targets.json', JSON.stringify({
        schemaVersion: 1,
        canonicalSourceRoot: '.github/skills',
        targets: {
          codex: { kind: 'repo-mirror', enabled: true, mirrorRoot: '.agents/skills' },
          opencode: { kind: 'repo-mirror', enabled: true, mirrorRoot: '.opencode/skills' },
          antigravity: { kind: 'repo-mirror', enabled: true, mirrorRoot: '.gemini/skills' },
          'gemini-cli': { kind: 'repo-mirror', enabled: true, mirrorRoot: '.gemini/skills' },
        },
      }, null, 2));

      const result = syncModule.runRepoSkillSync({
        repoRoot,
        configPath: path.join(repoRoot, 'scripts', 'repo-skill-sync.targets.json'),
        force: true,
      });

      assert.ok(fs.existsSync(path.join(repoRoot, '.agents', 'skills', 'example-skill', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(repoRoot, '.opencode', 'skills', 'example-skill', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(repoRoot, '.gemini', 'skills', 'example-skill', 'SKILL.md')));
      assert.strictEqual(result.counts.created >= 3 || result.counts.updated >= 3 || result.counts.skipped >= 3, true);
    });
  });

  await test('check mode detects stale generated mirrors', async () => {
    withTempRepo((repoRoot) => {
      writeFile(repoRoot, '.github/skills/example-skill/SKILL.md', ['---', 'name: example-skill', 'description: Source version.', '---', '', '# Example'].join('\n'));
      writeFile(repoRoot, '.agents/skills/example-skill/SKILL.md', ['---', 'name: example-skill', 'description: Diverged version.', '---', '', '# Example'].join('\n'));
      writeFile(repoRoot, 'scripts/repo-skill-sync.targets.json', JSON.stringify({
        schemaVersion: 1,
        canonicalSourceRoot: '.github/skills',
        targets: {
          codex: { kind: 'repo-mirror', enabled: true, mirrorRoot: '.agents/skills' },
        },
      }, null, 2));

      const result = syncModule.runRepoSkillSync({
        repoRoot,
        configPath: path.join(repoRoot, 'scripts', 'repo-skill-sync.targets.json'),
        check: true,
      });

      assert.strictEqual(result.ok, false);
      assert.ok(result.results.some((entry) => entry.action === 'stale_mirror' && entry.target === 'codex'));
    });
  });

  await test('target selection accepts gemini-cli and antigravity aliases against the shared .gemini mirror root', async () => {
    withTempRepo((repoRoot) => {
      writeFile(repoRoot, '.github/skills/example-skill/SKILL.md', ['---', 'name: example-skill', 'description: Example.', '---', '', '# Example'].join('\n'));
      writeFile(repoRoot, 'scripts/repo-skill-sync.targets.json', JSON.stringify({
        schemaVersion: 1,
        canonicalSourceRoot: '.github/skills',
        targets: {
          antigravity: { kind: 'repo-mirror', enabled: true, mirrorRoot: '.gemini/skills' },
          'gemini-cli': { kind: 'repo-mirror', enabled: true, mirrorRoot: '.gemini/skills' },
        },
      }, null, 2));

      const result = syncModule.runRepoSkillSync({
        repoRoot,
        configPath: path.join(repoRoot, 'scripts', 'repo-skill-sync.targets.json'),
        targets: ['gemini-cli'],
        force: true,
      });

      assert.deepStrictEqual(result.targets, ['gemini-cli']);
      assert.ok(fs.existsSync(path.join(repoRoot, '.gemini', 'skills', 'example-skill', 'SKILL.md')));
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
