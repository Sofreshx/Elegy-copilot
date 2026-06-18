'use strict';
const assert = require('assert');
const os = require('os');
const path = require('path');
const {
  resolveElegyHome,
  resolveSandboxesHome,
  resolveSessionsHome,
} = require('./paths');
let passed = 0;
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
async function run() {
  await test('resolveElegyHome honors CLI, XDG config, and home fallback precedence', async () => {
    const root = path.join(os.tmpdir(), 'ie-server-paths-precedence');
    assert.strictEqual(
      resolveElegyHome(
        { elegyHome: path.join(root, 'cli-home') },
        { env: { XDG_CONFIG_HOME: path.join(root, 'xdg-home'), HOME: path.join(root, 'env-home') }, homeDir: path.join(root, 'home-dir') }
      ),
      path.resolve(path.join(root, 'cli-home'))
    );
    assert.strictEqual(
      resolveElegyHome(
        {},
        { env: { XDG_CONFIG_HOME: path.join(root, 'xdg-home'), HOME: path.join(root, 'env-home') }, homeDir: path.join(root, 'home-dir') }
      ),
      path.resolve(path.join(root, 'xdg-home'))
    );
    assert.strictEqual(
      resolveElegyHome({}, { env: {}, homeDir: path.join(root, 'home-dir') }),
      path.resolve(path.join(root, 'home-dir', '.elegy'))
    );
  });
  await test('resolveSandboxesHome and resolveSessionsHome keep existing defaults', async () => {
    const homeDir = path.join(os.tmpdir(), 'ie-server-paths-home');
    assert.strictEqual(resolveSandboxesHome({}, { env: {}, homeDir }), path.resolve(path.join(homeDir, '.elegy', 'sandboxes')));
    assert.deepStrictEqual(resolveSessionsHome('sandbox', 'cli-home', 'sandbox-home'), {
      source: 'sandbox',
      home: 'sandbox-home',
    });
  });
  if (!process.exitCode) {
    console.log(`Passed ${passed} path module tests`);
  }
}
run().catch((error) => {
  console.error(error);
  process.exit(1);
});
