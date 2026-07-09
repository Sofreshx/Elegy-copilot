'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  validateTauriWindowsReleaseArtifacts,
} = require('./validate-tauri-windows-release-artifacts');
const {
  refreshTauriWindowsReleaseMetadata,
} = require('./refresh-tauri-windows-release-metadata');

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function createReleaseFixture({ channel = 'stable', signature = 'signed-update' } = {}) {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-tauri-feed-'));
  const releaseRoot = path.join(workspaceRoot, 'release', 'tauri', 'windows');
  const installerName = 'Elegy Copilot_1.2.3_x64-setup.exe';
  const signatureName = `${installerName}.sig`;
  const installerPath = path.join(releaseRoot, installerName);
  const signaturePath = path.join(releaseRoot, signatureName);
  fs.mkdirSync(releaseRoot, { recursive: true });
  fs.writeFileSync(installerPath, 'installer-body');
  fs.writeFileSync(signaturePath, signature);
  writeJson(path.join(workspaceRoot, 'package.json'), {
    version: '1.2.3',
  });
  writeJson(path.join(workspaceRoot, 'resources', 'runtime-manifests', 'windows-tauri-node-sidecar.json'), {
    nodeRuntime: { relativePath: 'node/node.exe' },
    nodeModulePayload: { targetRoot: 'copilot-ui/node_modules' },
    releaseLane: {
      packaging: 'windows_nsis_preview_installer',
      updateMode: 'tauri_signed_updater',
      autoUpdateEnabled: true,
      failClosedChannelPolicy: true,
    },
  });
  writeJson(path.join(workspaceRoot, 'src-tauri', 'gen', 'resources', 'runtime-manifests', 'default-desktop-rollback-policy.json'), {
    updatesEnabled: true,
  });
  writeJson(path.join(workspaceRoot, 'release', 'tauri', 'windows', 'release-manifest.json'), {
    schemaVersion: 1,
    platform: 'windows',
    shell: 'tauri',
    version: '1.2.3',
    releaseChannel: channel,
    desktopReleaseChannelContract: {
      channel,
      sdkChannel: channel,
      cliChannel: channel,
    },
    artifact: {
      packaging: 'windows_nsis_preview_installer',
      relativePath: installerName,
      size: fs.statSync(installerPath).size,
      sha256: require('node:crypto').createHash('sha256').update(fs.readFileSync(installerPath)).digest('hex'),
    },
    updateLane: {
      mode: 'tauri_signed_updater',
      autoCheckEnabled: true,
      autoUpdateEnabled: true,
      releaseSource: 'tauri_static_json',
      failClosedChannelPolicy: true,
      updaterFeedRelativePath: `${channel}-latest.json`,
      updaterSignatureRelativePath: signatureName,
      updaterBridgeStatus: 'tauri_signed_updater',
    },
    runtime: {
      manifestRelativePath: 'runtime-manifests/windows-tauri-node-sidecar.json',
      nodeRuntimeRelativePath: 'node/node.exe',
      nodeModulesRelativePath: 'copilot-ui/node_modules',
    },
  });
  writeJson(path.join(releaseRoot, `${channel}-latest.json`), {
    version: '1.2.3',
    pub_date: '2026-07-09T00:00:00Z',
    platforms: {
      'windows-x86_64': {
        url: `https://github.com/Sofreshx/Elegy-copilot/releases/download/desktop-v1.2.3/${encodeURIComponent(installerName)}`,
        signature,
      },
    },
  });
  return { workspaceRoot, releaseRoot, installerName, signatureName };
}

test('validates signed Tauri updater feed metadata for Windows release artifacts', () => {
  const fixture = createReleaseFixture();

  const result = validateTauriWindowsReleaseArtifacts({
    workspaceRoot: fixture.workspaceRoot,
    releaseRoot: fixture.releaseRoot,
    skipLayoutValidation: true,
  });

  assert.equal(path.basename(result.updaterFeedPath), 'stable-latest.json');
  assert.equal(path.basename(result.updaterSignaturePath), fixture.signatureName);
});

test('fails closed when signed Tauri updater feed is missing a platform signature', () => {
  const fixture = createReleaseFixture();
  const feedPath = path.join(fixture.releaseRoot, 'stable-latest.json');
  const feed = JSON.parse(fs.readFileSync(feedPath, 'utf8'));
  feed.platforms['windows-x86_64'].signature = '';
  writeJson(feedPath, feed);

  assert.throws(
    () => validateTauriWindowsReleaseArtifacts({
      workspaceRoot: fixture.workspaceRoot,
      releaseRoot: fixture.releaseRoot,
      skipLayoutValidation: true,
    }),
    /windows-x86_64 signature/,
  );
});

test('refreshes release metadata with a signed Tauri updater feed', () => {
  const fixture = createReleaseFixture();
  const bundleRoot = path.join(fixture.workspaceRoot, 'bundle');
  const bundleInstaller = path.join(bundleRoot, 'nsis', fixture.installerName);
  const bundleSignature = path.join(bundleRoot, 'nsis', `${fixture.installerName}.sig`);
  fs.mkdirSync(path.dirname(bundleInstaller), { recursive: true });
  fs.copyFileSync(path.join(fixture.releaseRoot, fixture.installerName), bundleInstaller);
  fs.writeFileSync(bundleSignature, 'fresh-signature');

  const result = refreshTauriWindowsReleaseMetadata({
    workspaceRoot: fixture.workspaceRoot,
    bundleRoot,
    releaseRoot: fixture.releaseRoot,
    publishedAt: '2026-07-09T00:00:00Z',
    downloadBaseUrl: 'https://github.com/Sofreshx/Elegy-copilot/releases/download/desktop-v1.2.3',
    skipLayoutValidation: true,
  });

  const releaseManifest = JSON.parse(fs.readFileSync(result.releaseManifestPath, 'utf8'));
  const feed = JSON.parse(fs.readFileSync(result.updaterFeedPath, 'utf8'));

  assert.equal(releaseManifest.updateLane.mode, 'tauri_signed_updater');
  assert.equal(path.basename(result.updaterFeedPath), 'stable-latest.json');
  assert.equal(feed.platforms['windows-x86_64'].signature, 'fresh-signature');
  assert.match(feed.platforms['windows-x86_64'].url, /^https:\/\/github\.com\/Sofreshx\/Elegy-copilot\/releases\/download\/desktop-v1\.2\.3\//);
});
