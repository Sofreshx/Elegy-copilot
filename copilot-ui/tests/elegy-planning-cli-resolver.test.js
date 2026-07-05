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
  isMsvcLinkerAvailable,
  installLatestElegyPlanningCli,
  probePlanningBinaryHealth,
  binaryName,
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
    await test('resolveElegyPlanningCliPath skips a schema-incompatible explicit binary', () => {
      const runtimeRoot = path.join(tmpRoot, 'compatible-runtime');
      const elegyHome = path.join(tmpRoot, 'compatible-home');
      const dbPath = path.join(elegyHome, 'planning.db');
      const explicitPath = path.join(tmpRoot, 'stale', binaryName());
      const managedPath = path.join(elegyHome, 'managed-cli', 'planning', binaryName());
      fs.mkdirSync(path.dirname(explicitPath), { recursive: true });
      fs.mkdirSync(path.dirname(managedPath), { recursive: true });
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
      fs.writeFileSync(explicitPath, 'stale', 'utf8');
      fs.writeFileSync(managedPath, 'current', 'utf8');
      fs.writeFileSync(dbPath, 'db', 'utf8');

      const resolved = resolveElegyPlanningCliPath({
        cliPath: explicitPath,
        runtimeRoot,
        elegyHome,
        dbPath,
        spawnSyncImpl(command) {
          if (command === explicitPath) {
            return { status: 1, stdout: '', stderr: 'unsupported planning schema version' };
          }
          if (command === managedPath) {
            return {
              status: 0,
              stdout: JSON.stringify({ status: 'ok', data: { schemaVersion: '11', dbPath } }),
              stderr: '',
            };
          }
          return { status: 1, stdout: '', stderr: '' };
        },
      });
      assert.strictEqual(resolved, managedPath);
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
    await test('isMsvcLinkerAvailable returns false when where link.exe fails on win32', () => {
      const result = isMsvcLinkerAvailable(() => ({ status: 1 }));
      if (process.platform === 'win32') {
        assert.strictEqual(result, false);
      }
      // On non-Windows, this always returns true regardless of mock
    });

    await test('isMsvcLinkerAvailable returns true when where link.exe succeeds on win32', () => {
      const result = isMsvcLinkerAvailable(() => ({ status: 0 }));
      // Always true: non-Windows returns true, win32 with linker returns true
      assert.strictEqual(result, true);
    });

    await test('isMsvcLinkerAvailable handles spawn throwing gracefully', () => {
      const result = isMsvcLinkerAvailable(() => { throw new Error('ENOENT'); });
      if (process.platform === 'win32') {
        assert.strictEqual(result, false);
      }
      // On non-Windows, this always returns true regardless of throw
    });

    await test('installLatestElegyPlanningCli skips cargo build when MSVC linker is unavailable', async () => {
      const elegyHome = path.join(tmpRoot, 'skip-cargo-home');
      let cargoCalled = false;
      let gitCalled = false;

      const childProcessMock = {
        execFile(command, args, options, callback) {
          if (command === 'cargo') {
            cargoCalled = true;
            callback(new Error('should not happen'), '', '');
          } else if (command === 'git') {
            gitCalled = true;
            callback(null, '', '');
          }
        },
        spawnSync(command, args) {
          if (command === 'where' && args && args[0] === 'link.exe') {
            return { status: 1 };
          }
          if (command === 'git') {
            return { status: 0, stdout: 'abc\n' };
          }
          return { status: 1 };
        },
      };

      // MSVC unavailable -> will try downloadElegyPlanningCli which needs fetch
      // Without mock fetch, it will throw, but cargo should NOT have been called
      try {
        await installLatestElegyPlanningCli({
          elegyHome,
          childProcess: childProcessMock,
        });
      } catch (error) {
        // Expected: downloadElegyPlanningCli fails without fetch mock
      }

      assert.strictEqual(cargoCalled, false, 'cargo build must NOT be called when MSVC unavailable');
      assert.strictEqual(gitCalled, false, 'git clone must NOT be called when MSVC unavailable');
    });

    await test('probeBinaryVersion exports as a function', () => {
      const { probeBinaryVersion } = require('../lib/elegyPlanningCliResolver');
      assert.strictEqual(typeof probeBinaryVersion, 'function');
    });
    await test('probePlanningBinaryHealth reads the CLI schema contract', () => {
      const health = probePlanningBinaryHealth('elegy-planning', 'planning.db', () => ({
        status: 0,
        stdout: JSON.stringify({
          status: 'ok',
          data: { schemaVersion: '11', dbPath: 'planning.db' },
        }),
      }));
      assert.deepStrictEqual(health, { schemaVersion: '11', dbPath: 'planning.db' });
    });

    await test('buildElegyPlanningCliFromSource builds and installs managed binary metadata (legacy layout)', async () => {
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
          if (command === 'git' && args[0] === '-C') {
            return { status: 0, stdout: 'abc123\n' };
          }
          if (args && Array.isArray(args) && args.includes('--version')) {
            return { status: 0, stdout: 'elegy-planning 0.1.0\n', stderr: '' };
          }
          return { status: 0, stdout: '' };
        },
      });
      assert.ok(fs.existsSync(result.installedPath));
      assert.strictEqual(result.metadata.source, 'github-source');
      assert.strictEqual(result.metadata.sourceGitHead, 'abc123');
      // version field may be null since probeBinaryVersion runs against a fake binary
      assert.ok(Object.prototype.hasOwnProperty.call(result.metadata, 'version'));
      assert.strictEqual(result.metadata.version, '0.1.0', 'version should be extracted from fake binary');
      const metadata = readInstallMetadata(elegyHome);
      assert.strictEqual(metadata.source, 'github-source');
      assert.strictEqual(metadata.sourceGitHead, 'abc123');
      assert.ok(Object.prototype.hasOwnProperty.call(metadata, 'version'));
    });
    await test('buildElegyPlanningCliFromSource builds with new layout (Cargo.toml at repo root)', async () => {
      const elegyRoot = path.join(tmpRoot, 'source-elegy-new');
      const elegyHome = path.join(tmpRoot, 'copilot-home-new');
      const pluginDir = path.join(elegyRoot, 'plugins', 'planning');
      fs.mkdirSync(pluginDir, { recursive: true });
      fs.writeFileSync(path.join(elegyRoot, 'Cargo.toml'), '[workspace]\nmembers = ["plugins/planning"]', 'utf8');
      fs.writeFileSync(path.join(pluginDir, 'Cargo.toml'), '[package]\nname = "elegy-planning"', 'utf8');
      const builtBinary = path.join(
        elegyRoot,
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
            assert.strictEqual(options.cwd, elegyRoot, 'cwd should be repo root for new layout');
            fs.mkdirSync(path.dirname(builtBinary), { recursive: true });
            fs.writeFileSync(builtBinary, 'binary', 'utf8');
            callback(null, '', '');
          },
        },
        spawnSyncImpl(command, args) {
          if (command === 'git' && args[0] === '-C') {
            return { status: 0, stdout: 'def456\n' };
          }
          if (args && Array.isArray(args) && args.includes('--version')) {
            return { status: 0, stdout: 'elegy-planning 0.2.0\n', stderr: '' };
          }
          return { status: 0, stdout: '' };
        },
      });
      assert.ok(fs.existsSync(result.installedPath));
      assert.strictEqual(result.metadata.source, 'github-source');
      assert.strictEqual(result.metadata.sourceGitHead, 'def456');
      assert.strictEqual(result.metadata.version, '0.2.0');
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
            // New layout: Cargo.toml at repo root, crate at plugins/planning/
            fs.mkdirSync(path.join(destination, 'plugins', 'planning'), { recursive: true });
            fs.writeFileSync(path.join(destination, 'Cargo.toml'), '[workspace]\nmembers = ["plugins/planning"]', 'utf8');
            fs.writeFileSync(path.join(destination, 'plugins', 'planning', 'Cargo.toml'), '[package]\nname = "elegy-planning"', 'utf8');
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
