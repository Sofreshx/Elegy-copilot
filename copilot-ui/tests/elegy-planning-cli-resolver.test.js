'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  resolveElegyPlanningCliPath,
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
      const copilotHome = path.join(tmpRoot, '.copilot');
      const explicitPath = path.join(runtimeRoot, 'elegy-planning', process.platform === 'win32' ? 'elegy-planning.exe' : 'elegy-planning');

      fs.mkdirSync(path.dirname(explicitPath), { recursive: true });
      fs.writeFileSync(explicitPath, 'binary', 'utf8');

      const resolved = resolveElegyPlanningCliPath({
        cliPath: explicitPath,
        runtimeRoot,
        copilotHome,
      });

      assert.strictEqual(resolved, explicitPath);
    });

    await test('resolveElegyPlanningCliPath accepts explicit command name available on PATH', () => {
      const resolved = resolveElegyPlanningCliPath({
        cliPath: 'elegy-planning',
        runtimeRoot: path.join(tmpRoot, 'missing-runtime'),
        copilotHome: path.join(tmpRoot, 'missing-home'),
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
        copilotHome: path.join(tmpRoot, 'missing-home-2'),
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
        copilotHome: path.join(tmpRoot, 'missing-home-3'),
        platform: 'linux',
        spawnSyncImpl: () => ({ status: 1 }),
      });

      assert.strictEqual(resolved, '');
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
