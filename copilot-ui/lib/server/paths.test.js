'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  MESSAGING_GATEWAY_CONFIG_PATH_ENV,
  MESSAGING_GATEWAY_CONFIG_FILENAME,
  resolveElegyHome,
  resolveSandboxesHome,
  resolveMessagingGatewayConfigPath,
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
function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-server-paths-'));
  return Promise.resolve()
    .then(() => fn(dir))
    .finally(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });
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
  await test('resolveMessagingGatewayConfigPath rehomes legacy per-copilot config to canonical home path', async () => {
    await withTempDir(async (root) => {
      const homeDir = path.join(root, 'user-home');
      const elegyHome = path.join(root, 'copilot-home');
      const canonicalPath = path.resolve(path.join(homeDir, '.elegy', MESSAGING_GATEWAY_CONFIG_FILENAME));
      const legacyPath = path.resolve(path.join(elegyHome, MESSAGING_GATEWAY_CONFIG_FILENAME));
      fs.mkdirSync(homeDir, { recursive: true });
      fs.mkdirSync(elegyHome, { recursive: true });
      fs.writeFileSync(legacyPath, JSON.stringify({ mode: 'legacy' }, null, 2), 'utf8');
      const resolved = resolveMessagingGatewayConfigPath(elegyHome, { env: {}, homeDir });
      assert.strictEqual(resolved, canonicalPath);
      assert.ok(fs.existsSync(canonicalPath));
      assert.ok(!fs.existsSync(legacyPath));
      assert.deepStrictEqual(JSON.parse(fs.readFileSync(canonicalPath, 'utf8')), { mode: 'legacy' });
    });
  });
  await test('resolveMessagingGatewayConfigPath honors explicit env override without rehoming', async () => {
    await withTempDir(async (root) => {
      const explicitPath = path.join(root, 'override', 'gateway.json');
      const resolved = resolveMessagingGatewayConfigPath(path.join(root, 'copilot-home'), {
        env: {
          [MESSAGING_GATEWAY_CONFIG_PATH_ENV]: explicitPath,
        },
        homeDir: path.join(root, 'user-home'),
      });
      assert.strictEqual(resolved, path.resolve(explicitPath));
      assert.ok(!fs.existsSync(path.join(root, 'override', 'gateway.json')));
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
