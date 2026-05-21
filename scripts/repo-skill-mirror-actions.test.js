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

function readFile(root, relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function withTempRepo(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-repo-skill-mirror-'));
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

function writeConfig(repoRoot, targets) {
  writeFile(repoRoot, 'scripts/repo-skill-sync.targets.json', JSON.stringify({
    schemaVersion: 1,
    canonicalSourceRoot: '.github/skills',
    targets,
  }, null, 2));
  return path.join(repoRoot, 'scripts', 'repo-skill-sync.targets.json');
}

function skillDoc(description) {
  return ['---', 'name: example-skill', `description: ${description}`, '---', '', '# Example'].join('\n');
}

async function main() {
  const quietLog = () => {};
  const checkModule = await import(pathToFileURL(path.resolve(__dirname, 'check-repo-skill-mirrors.mjs')).href);
  const installModule = await import(pathToFileURL(path.resolve(__dirname, 'install-repo-skill-mirrors.mjs')).href);
  const updateModule = await import(pathToFileURL(path.resolve(__dirname, 'update-repo-skill-mirrors.mjs')).href);

  await test('check action reports missing, stale, and unexpected mirrors', async () => {
    withTempRepo((repoRoot) => {
      writeFile(repoRoot, '.github/skills/example-skill/SKILL.md', skillDoc('Canonical version.'));
      writeFile(repoRoot, '.github/skills/missing-skill/SKILL.md', ['---', 'name: missing-skill', 'description: Missing mirror.', '---', '', '# Missing'].join('\n'));
      writeFile(repoRoot, '.agents/skills/example-skill/SKILL.md', skillDoc('Drifted version.'));
      writeFile(repoRoot, '.opencode/skills/orphan-skill/SKILL.md', ['---', 'name: orphan-skill', 'description: Unexpected mirror.', '---', '', '# Orphan'].join('\n'));
      const configPath = writeConfig(repoRoot, {
        codex: { kind: 'repo-mirror', enabled: true, mirrorRoot: '.agents/skills' },
        opencode: { kind: 'repo-mirror', enabled: true, mirrorRoot: '.opencode/skills' },
      });

      const result = checkModule.runCheckRepoSkillMirrors({ repoRoot, configPath, log: quietLog });

      assert.strictEqual(result.ok, false);
      assert.ok(result.results.some((entry) => entry.action === 'stale_mirror' && entry.target === 'codex' && entry.skill === 'example-skill'));
      assert.ok(result.results.some((entry) => entry.action === 'missing_mirror' && entry.skill === 'missing-skill'));
      assert.ok(result.results.some((entry) => entry.action === 'unexpected_mirror' && entry.target === 'opencode' && entry.skill === 'orphan-skill'));
    });
  });

  await test('install action creates missing mirrors without overwriting diverged mirrors or pruning extras', async () => {
    withTempRepo((repoRoot) => {
      writeFile(repoRoot, '.github/skills/example-skill/SKILL.md', skillDoc('Canonical version.'));
      writeFile(repoRoot, '.github/skills/missing-skill/SKILL.md', ['---', 'name: missing-skill', 'description: Missing mirror.', '---', '', '# Missing'].join('\n'));
      writeFile(repoRoot, '.agents/skills/example-skill/SKILL.md', skillDoc('Drifted version.'));
      writeFile(repoRoot, '.opencode/skills/orphan-skill/SKILL.md', ['---', 'name: orphan-skill', 'description: Unexpected mirror.', '---', '', '# Orphan'].join('\n'));
      const configPath = writeConfig(repoRoot, {
        codex: { kind: 'repo-mirror', enabled: true, mirrorRoot: '.agents/skills' },
        opencode: { kind: 'repo-mirror', enabled: true, mirrorRoot: '.opencode/skills' },
      });

      const result = installModule.runInstallRepoSkillMirrors({ repoRoot, configPath, log: quietLog });

      assert.ok(fs.existsSync(path.join(repoRoot, '.agents', 'skills', 'missing-skill', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(repoRoot, '.opencode', 'skills', 'missing-skill', 'SKILL.md')));
      assert.strictEqual(readFile(repoRoot, '.agents/skills/example-skill/SKILL.md'), skillDoc('Drifted version.'));
      assert.ok(fs.existsSync(path.join(repoRoot, '.opencode', 'skills', 'orphan-skill', 'SKILL.md')));
      assert.strictEqual(result.counts.created >= 2, true);
      assert.strictEqual(result.counts.skippedConflict >= 1, true);
      assert.strictEqual(result.counts.unexpectedMirrors >= 1, true);
    });
  });

  await test('update action reconciles mirrors by creating missing, overwriting stale, and pruning unexpected mirrors', async () => {
    withTempRepo((repoRoot) => {
      writeFile(repoRoot, '.github/skills/example-skill/SKILL.md', skillDoc('Canonical version.'));
      writeFile(repoRoot, '.github/skills/missing-skill/SKILL.md', ['---', 'name: missing-skill', 'description: Missing mirror.', '---', '', '# Missing'].join('\n'));
      writeFile(repoRoot, '.agents/skills/example-skill/SKILL.md', skillDoc('Drifted version.'));
      writeFile(repoRoot, '.opencode/skills/orphan-skill/SKILL.md', ['---', 'name: orphan-skill', 'description: Unexpected mirror.', '---', '', '# Orphan'].join('\n'));
      const configPath = writeConfig(repoRoot, {
        codex: { kind: 'repo-mirror', enabled: true, mirrorRoot: '.agents/skills' },
        opencode: { kind: 'repo-mirror', enabled: true, mirrorRoot: '.opencode/skills' },
      });

      const result = updateModule.runUpdateRepoSkillMirrors({ repoRoot, configPath, log: quietLog });

      assert.strictEqual(readFile(repoRoot, '.agents/skills/example-skill/SKILL.md'), skillDoc('Canonical version.'));
      assert.ok(fs.existsSync(path.join(repoRoot, '.agents', 'skills', 'missing-skill', 'SKILL.md')));
      assert.ok(!fs.existsSync(path.join(repoRoot, '.opencode', 'skills', 'orphan-skill')));
      assert.strictEqual(result.counts.updated >= 1, true);
      assert.strictEqual(result.counts.created >= 2, true);
      assert.strictEqual(result.counts.pruned >= 1, true);
    });
  });

  await test('target selection accepts Antigravity CLI aliases without processing the shared mirror root twice', async () => {
    withTempRepo((repoRoot) => {
      writeFile(repoRoot, '.github/skills/example-skill/SKILL.md', skillDoc('Canonical version.'));
      const configPath = writeConfig(repoRoot, {
        antigravity: { kind: 'repo-mirror', enabled: true, mirrorRoot: '.gemini/skills' },
        'antigravity-cli': { kind: 'repo-mirror', enabled: true, mirrorRoot: '.gemini/skills' },
        'gemini-cli': { kind: 'repo-mirror', enabled: true, mirrorRoot: '.gemini/skills' },
      });

      const result = updateModule.runUpdateRepoSkillMirrors({
        repoRoot,
        configPath,
        targets: ['antigravity-cli', 'gemini-cli', 'antigravity'],
        log: quietLog,
      });

      assert.deepStrictEqual(result.targets, ['antigravity-cli']);
      assert.ok(fs.existsSync(path.join(repoRoot, '.gemini', 'skills', 'example-skill', 'SKILL.md')));
    });
  });

  await test('empty canonical directories without SKILL.md are ignored and do not block prune', async () => {
    withTempRepo((repoRoot) => {
      fs.mkdirSync(path.join(repoRoot, '.github', 'skills', 'removed-skill'), { recursive: true });
      writeFile(repoRoot, '.agents/skills/removed-skill/SKILL.md', ['---', 'name: removed-skill', 'description: Old mirror.', '---', '', '# Removed'].join('\n'));
      const configPath = writeConfig(repoRoot, {
        codex: { kind: 'repo-mirror', enabled: true, mirrorRoot: '.agents/skills' },
      });

      const result = updateModule.runUpdateRepoSkillMirrors({ repoRoot, configPath, log: quietLog });

      assert.ok(!fs.existsSync(path.join(repoRoot, '.agents', 'skills', 'removed-skill')));
      assert.strictEqual(result.counts.pruned, 1);
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
