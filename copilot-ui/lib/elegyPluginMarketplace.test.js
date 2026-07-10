'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const marketplace = require('./elegyPluginMarketplace');

test('Elegy plugin marketplace includes UI Craft in the default managed set', () => {
  assert.ok(marketplace.DEFAULT_PLUGIN_NAMES.includes('elegy-ui-craft'));
});

function writeMarketplace(root, version = '0.1.0+codex.abc123def456') {
  fs.mkdirSync(path.join(root, '.agents', 'plugins'), { recursive: true });
  fs.mkdirSync(path.join(root, 'plugins', 'elegy-planning', '.codex-plugin'), { recursive: true });
  fs.writeFileSync(path.join(root, '.agents', 'plugins', 'marketplace.json'), JSON.stringify({
    name: 'elegy',
    plugins: [
      {
        name: 'elegy-planning',
        category: 'Productivity',
        source: { source: 'local', path: './plugins/elegy-planning' },
      },
    ],
  }), 'utf8');
  fs.writeFileSync(path.join(root, 'plugins', 'elegy-planning', '.codex-plugin', 'plugin.json'), JSON.stringify({
    name: 'elegy-planning',
    version,
  }), 'utf8');
}

test('Elegy plugin marketplace service installs verified archive and calls Codex in order', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-elegy-plugins-'));
  const codexHome = path.join(temp, 'codex-home');
  const archiveBuffer = Buffer.from('fake zip payload');
  const sha = marketplace.sha256Buffer(archiveBuffer);
  const calls = [];

  const result = await marketplace.installElegyCodexPlugins({
    codexHome,
    target: 'x86_64-pc-windows-msvc',
    releaseTag: 'main-snapshot',
    pluginNames: ['elegy-planning'],
    archiveBuffer,
    checksumText: `${sha}  elegy-codex-marketplace-x86_64-pc-windows-msvc.zip`,
    extractZip(_archive, destination) {
      writeMarketplace(destination);
    },
    spawnSyncImpl(command, args) {
      calls.push([command, ...args]);
      if (args.join(' ') === 'plugin marketplace add ' + path.join(codexHome, 'marketplaces', 'elegy') + ' --json') {
        return { status: 0, stdout: JSON.stringify({ marketplaceName: 'elegy' }), stderr: '' };
      }
      if (args.join(' ') === 'plugin add elegy-planning@elegy --json') {
        return { status: 0, stdout: JSON.stringify({ name: 'elegy-planning', version: '0.1.0+codex.abc123def456' }), stderr: '' };
      }
      if (args.includes('--available')) {
        return { status: 0, stdout: JSON.stringify({ plugins: [{ name: 'elegy-planning', version: '0.1.0+codex.abc123def456' }] }), stderr: '' };
      }
      return { status: 0, stdout: JSON.stringify({ plugins: [{ name: 'elegy-planning', version: '0.1.0+codex.abc123def456', installed: true, enabled: true }] }), stderr: '' };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.marketplaceName, 'elegy');
  assert.equal(result.status.plugins[0].status, 'current');
  assert.ok(fs.existsSync(path.join(codexHome, 'marketplaces', 'elegy', '.agents', 'plugins', 'marketplace.json')));
  assert.deepEqual(calls.map((call) => call.slice(0, 4)), [
    ['codex', 'plugin', 'marketplace', 'add'],
    ['codex', 'plugin', 'add', 'elegy-planning@elegy'],
    ['codex', 'plugin', 'list', '--marketplace'],
    ['codex', 'plugin', 'list', '--marketplace'],
  ]);
});

test('Elegy plugin marketplace status reports notInstalled current and stale', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-elegy-plugin-status-'));
  const root = path.join(temp, 'marketplaces', 'elegy');
  writeMarketplace(root, '0.1.0+codex.111111111111');

  const notInstalled = marketplace.buildPluginStatus({
    marketplaceRoot: root,
    pluginNames: ['elegy-planning'],
    installedJson: { plugins: [] },
    availableJson: { plugins: [{ name: 'elegy-planning', version: '0.1.0+codex.111111111111' }] },
  });
  assert.equal(notInstalled.plugins[0].status, 'notInstalled');

  const current = marketplace.buildPluginStatus({
    marketplaceRoot: root,
    pluginNames: ['elegy-planning'],
    installedJson: { plugins: [{ name: 'elegy-planning', version: '0.1.0+codex.111111111111', installed: true }] },
    availableJson: { plugins: [{ name: 'elegy-planning', version: '0.1.0+codex.111111111111' }] },
  });
  assert.equal(current.plugins[0].status, 'current');

  const stale = marketplace.buildPluginStatus({
    marketplaceRoot: root,
    pluginNames: ['elegy-planning'],
    installedJson: { plugins: [{ name: 'elegy-planning', version: '0.1.0+codex.000000000000', installed: true }] },
    availableJson: { plugins: [{ name: 'elegy-planning', version: '0.1.0+codex.111111111111' }] },
  });
  assert.equal(stale.plugins[0].status, 'stale');
});

test('Elegy plugin marketplace status treats missing artifacts as repairable', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-elegy-plugin-missing-'));
  const root = path.join(temp, 'marketplaces', 'elegy');
  writeMarketplace(root, '0.1.0+codex.111111111111');

  const status = marketplace.buildPluginStatus({
    marketplaceRoot: root,
    pluginNames: ['elegy-planning', 'elegy-opencode-workers'],
    installedJson: { plugins: [{ name: 'elegy-planning', version: '0.1.0+codex.111111111111', installed: true }] },
    availableJson: { plugins: [{ name: 'elegy-planning', version: '0.1.0+codex.111111111111' }] },
  });

  assert.equal(status.plugins[1].plugin, 'elegy-opencode-workers');
  assert.equal(status.plugins[1].status, 'missingArtifact');
  assert.equal(status.status, 'missingArtifact');
  assert.equal(status.updateAvailable, true);
});

test('Elegy plugin marketplace maps Windows target and binary suffix', () => {
  assert.equal(marketplace.resolveTargetTriple({ platform: 'win32', arch: 'x64' }), 'x86_64-pc-windows-msvc');
  assert.equal(
    marketplace.windowsPluginBinaryName('elegy-opencode-workers', { platform: 'win32' }),
    'elegy-opencode-workers.exe',
  );
  assert.equal(
    marketplace.windowsPluginBinaryName('elegy-opencode-workers', { platform: 'linux' }),
    'elegy-opencode-workers',
  );
});
