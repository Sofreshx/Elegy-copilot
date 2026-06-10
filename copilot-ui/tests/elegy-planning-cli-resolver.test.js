'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  resolveElegyPlanningCliPath,
  buildElegyPlanningCliFromSource,
  syncElegySkillAssetsFromGitHub,
  readInstallMetadata,
  readElegyAssetsMetadata,
  commandExistsOnPath,
  isPathLikeCommand,
} = require('../lib/elegyPlanningCliResolver');
let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  PASS: ${name}`);
  } catch (error) {
    failed += 1;
    process.exitCode = 1;
    console.error(`  FAIL: ${name}`);
    console.error(`    ${error.message}`);
  }
}
async function run() {
  console.log('\nElegy Planning CLI Resolver Tests\n');
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-elegy-cli-resolver-'));
  try {
    await test('isPathLikeCommand identifies filesystem paths and skips command names', () => {
      assert.strictEqual(isPathLikeCommand('elegy-planning'), false);
      assert.strictEqual(isPathLikeCommand('elegy-planning.exe'), false);
      assert.strictEqual(isPathLikeCommand('./elegy-planning'), true);
      assert.strictEqual(isPathLikeCommand('C:/tools/elegy-planning.exe'), true);
    });
    await test('commandExistsOnPath uses resolver command result', () => {
      const found = commandExistsOnPath('elegy-planning', {
        platform: 'win32',
        spawnSyncImpl: () => ({ status: 0 }),
      });
      const missing = commandExistsOnPath('elegy-planning', {
        platform: 'linux',
        spawnSyncImpl: () => ({ status: 1 }),
      });
      assert.strictEqual(found, true);
      assert.strictEqual(missing, false);
    });
    await test('resolveElegyPlanningCliPath returns explicit existing path', () => {
      const runtimeRoot = path.join(tmpRoot, 'runtime-root');
      const elegyHome = path.join(tmpRoot, '.elegy');
      const explicitPath = path.join(runtimeRoot, 'elegy-planning', process.platform === 'win32' ? 'elegy-planning.exe' : 'elegy-planning');
      fs.mkdirSync(path.dirname(explicitPath), { recursive: true });
      fs.writeFileSync(explicitPath, 'binary', 'utf8');
      const resolved = resolveElegyPlanningCliPath({
        cliPath: explicitPath,
        runtimeRoot,
        elegyHome,
      });
      assert.strictEqual(resolved, explicitPath);
    });
    await test('resolveElegyPlanningCliPath accepts explicit command name available on PATH', () => {
      const resolved = resolveElegyPlanningCliPath({
        cliPath: 'elegy-planning',
        runtimeRoot: path.join(tmpRoot, 'missing-runtime'),
        elegyHome: path.join(tmpRoot, 'missing-home'),
        platform: 'win32',
        spawnSyncImpl: (command, args) => {
          assert.strictEqual(command, 'where');
          assert.deepStrictEqual(args, ['elegy-planning']);
          return { status: 0 };
        },
      });
      assert.strictEqual(resolved, 'elegy-planning');
    });
    await test('resolveElegyPlanningCliPath falls back to PATH command when no local binary exists', () => {
      const resolved = resolveElegyPlanningCliPath({
        runtimeRoot: path.join(tmpRoot, 'missing-runtime-2'),
        elegyHome: path.join(tmpRoot, 'missing-home-2'),
        platform: 'linux',
        spawnSyncImpl: (command, args) => {
          assert.strictEqual(command, 'which');
          assert.deepStrictEqual(args, ['elegy-planning']);
          return { status: 0 };
        },
      });
      assert.strictEqual(resolved, 'elegy-planning');
    });
    await test('resolveElegyPlanningCliPath returns empty string when no candidate exists', () => {
      const resolved = resolveElegyPlanningCliPath({
        runtimeRoot: path.join(tmpRoot, 'missing-runtime-3'),
        elegyHome: path.join(tmpRoot, 'missing-home-3'),
        platform: 'linux',
        spawnSyncImpl: () => ({ status: 1 }),
      });
      assert.strictEqual(resolved, '');
    });
    await test('buildElegyPlanningCliFromSource builds and installs managed binary metadata', async () => {
      const elegyRoot = path.join(tmpRoot, 'source-elegy');
      const elegyHome = path.join(tmpRoot, 'copilot-home');
      const rustRoot = path.join(elegyRoot, 'rust');
      const crateRoot = path.join(rustRoot, 'crates', 'elegy-planning');
      fs.mkdirSync(crateRoot, { recursive: true });
      fs.writeFileSync(path.join(rustRoot, 'Cargo.toml'), '[workspace]', 'utf8');
      fs.writeFileSync(path.join(crateRoot, 'Cargo.toml'), '[package]', 'utf8');
      const builtBinary = path.join(
        rustRoot,
        'target',
        'release',
        process.platform === 'win32' ? 'elegy-planning.exe' : 'elegy-planning',
      );
      const result = await buildElegyPlanningCliFromSource({
        elegyHome,
        elegyRepoPath: elegyRoot,
        childProcess: {
          execFile(command, args, options, callback) {
            assert.strictEqual(command, 'cargo');
            assert.deepStrictEqual(args, ['build', '-p', 'elegy-planning', '--bin', 'elegy-planning', '--release']);
            assert.strictEqual(options.cwd, rustRoot);
            fs.mkdirSync(path.dirname(builtBinary), { recursive: true });
            fs.writeFileSync(builtBinary, 'binary', 'utf8');
            callback(null, '', '');
          },
        },
        spawnSyncImpl(command, args) {
          assert.strictEqual(command, 'git');
          assert.deepStrictEqual(args.slice(0, 3), ['-C', elegyRoot, 'rev-parse']);
          return { status: 0, stdout: 'abc123\n' };
        },
      });
      assert.ok(fs.existsSync(result.installedPath));
      assert.strictEqual(result.metadata.source, 'github-source');
      assert.strictEqual(result.metadata.sourceGitHead, 'abc123');
      const metadata = readInstallMetadata(elegyHome);
      assert.strictEqual(metadata.source, 'github-source');
      assert.strictEqual(metadata.sourceGitHead, 'abc123');
    });
    await test('syncElegySkillAssetsFromGitHub installs skills from managed GitHub checkout', async () => {
      const elegyHome = path.join(tmpRoot, 'asset-copilot-home');
      const targetHome = path.join(tmpRoot, 'asset-target-home');
      const sourceRoot = path.join(elegyHome, 'managed-cli', 'planning', 'source', 'Elegy');
      const result = await syncElegySkillAssetsFromGitHub({
        elegyHome,
        targetHome,
        childProcess: {
          execFile(command, args, options, callback) {
            assert.strictEqual(command, 'git');
            assert.strictEqual(args[0], 'clone');
            const destination = args[args.length - 1];
            fs.mkdirSync(path.join(destination, 'rust', 'crates', 'elegy-planning'), { recursive: true });
            fs.writeFileSync(path.join(destination, 'rust', 'Cargo.toml'), '[workspace]', 'utf8');
            fs.writeFileSync(path.join(destination, 'rust', 'crates', 'elegy-planning', 'Cargo.toml'), '[package]', 'utf8');
            for (const rel of [
              path.join('src', 'Elegy-planning', 'skills', 'elegy-planning'),
              path.join('src', 'Elegy-skills', 'skills', 'elegy-skills'),
              path.join('skills', 'elegy-obsidian'),
            ]) {
              fs.mkdirSync(path.join(destination, rel), { recursive: true });
              fs.writeFileSync(path.join(destination, rel, 'SKILL.md'), `# ${rel}`, 'utf8');
            }
            callback(null, '', '');
          },
        },
        spawnSyncImpl(command, args) {
          assert.strictEqual(command, 'git');
          assert.deepStrictEqual(args.slice(0, 3), ['-C', sourceRoot, 'rev-parse']);
          return { status: 0, stdout: 'asset-head\n' };
        },
      });
      assert.strictEqual(result.source, 'github-source');
      assert.strictEqual(result.installed.length, 3);
      assert.ok(fs.existsSync(path.join(targetHome, 'skills', 'elegy-planning', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(targetHome, 'skills', 'elegy-skills', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(targetHome, 'skills', 'elegy-obsidian', 'SKILL.md')));
      const metadata = readElegyAssetsMetadata(targetHome);
      assert.strictEqual(metadata.source, 'github-source');
      assert.strictEqual(metadata.sourceGitHead, 'asset-head');
    });
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
  console.log(`\nCompleted Elegy Planning CLI Resolver Tests: ${passed} passed, ${failed} failed.`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}
run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
