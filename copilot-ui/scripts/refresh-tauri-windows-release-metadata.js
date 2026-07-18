'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { resolveDesktopReleaseChannelContract } = require('./desktop-release-policy');
const { loadTauriNodeSidecarLayout } = require('./tauri-node-sidecar-layout');

const workspaceRoot = path.resolve(__dirname, '..');
const installationGuidanceFileName = 'windows-installation-guide.md';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function toSha256(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function renderWindowsInstallationGuide({ version, channel, installerName }) {
  return [
    '# Windows Desktop Installation Guide',
    '',
    `- Desktop version: ${version}`,
    `- Release channel: ${channel}`,
    `- Windows installer: ${installerName}`,
    '',
    '## Operator truth',
    '',
    '- Tauri is the only supported desktop shell.',
    '- Stable builds install from the stable channel; prerelease builds install from the prerelease channel.',
    '- This release lane uses the signed Tauri updater for in-app updates.',
    '- The desktop app checks the matching-channel update feed and applies signed updates in app.',
    '- Managed CLI remediation may seed or refresh the approved Windows CLI into `~/.elegy/managed-cli/<channel>/` from the packaged `@github/copilot-win32-x64` dependency when the managed copy is missing or outdated.',
    '',
    '## User steps',
    '',
    `1. Download the matching-channel Windows installer (\`${installerName}\`).`,
    '2. Close any running desktop app instances before starting the installer.',
    '3. Run the installer manually and follow the Windows installation prompts.',
    '4. Launch the app after installation completes.',
    '5. Verify that the app starts successfully against the existing local `~/.elegy` runtime state.',
    '',
    '## Non-goals in this slice',
    '',
    '- No claim that cross-channel installs are supported.',
    '- No claim that the installer can bypass the standard Windows installation flow.',
    '',
    '## Canonical docs',
    '',
    '- `docs/system/desktop-runtime-tauri-migration-contract.md`',
    '- `docs/system/desktop-update-rollback-runbook.md`',
    '- `docs/system/copilot-ui-guide.md`',
    '',
  ].join('\n');
}

function resolveNsisInstallerPath(bundleRoot) {
  const nsisRoot = path.join(bundleRoot, 'nsis');
  const searchRoot = fs.existsSync(nsisRoot) ? nsisRoot : bundleRoot;
  assert(fs.existsSync(searchRoot), `Missing Tauri Windows bundle directory: ${searchRoot}`);
  const installers = fs.readdirSync(searchRoot)
    .filter((fileName) => fileName.toLowerCase().endsWith('.exe'))
    .filter((fileName) => !fileName.toLowerCase().includes('nsis'));
  assert(installers.length > 0, `No Tauri Windows installer .exe files were found in ${searchRoot}`);
  assert(installers.length === 1, `Expected exactly one Tauri Windows installer in ${searchRoot}, found ${installers.join(', ')}`);
  return path.join(searchRoot, installers[0]);
}

function resolveInstallerSignaturePath(installerPath) {
  const signaturePath = `${installerPath}.sig`;
  assert(fs.existsSync(signaturePath), `Missing Tauri updater signature for installer: ${signaturePath}`);
  const signature = fs.readFileSync(signaturePath, 'utf8').trim();
  assert(signature, `Tauri updater signature is empty: ${signaturePath}`);
  return signaturePath;
}

function encodeReleaseAssetName(fileName) {
  return encodeURIComponent(fileName).replace(/%20/g, '%20');
}

function resolvePublishedInstallerName(installerName) {
  return String(installerName || '').replace(/\s+/g, '.');
}

function resolveDownloadBaseUrl(options, packageJson, channel) {
  const explicit = String(options.downloadBaseUrl || '').trim();
  if (explicit) {
    return explicit.replace(/\/+$/, '');
  }

  const publishRepository = String(packageJson.desktopRelease?.publishRepository || '').trim();
  assert(publishRepository, 'Missing desktopRelease.publishRepository for updater feed download URL generation.');
  const tag = channel === 'stable'
    ? `desktop-v${String(packageJson.version || '').trim()}`
    : String(packageJson.version || '').trim();
  return `https://github.com/${publishRepository}/releases/download/${tag}`;
}

function refreshTauriWindowsReleaseMetadata(options = {}) {
  const activeWorkspaceRoot = path.resolve(options.workspaceRoot || workspaceRoot);
  const packageJson = JSON.parse(fs.readFileSync(path.join(activeWorkspaceRoot, 'package.json'), 'utf8'));
  const explicitChannel = process.env.INSTRUCTION_ENGINE_UPDATE_CHANNEL;
  const channelResolution = resolveDesktopReleaseChannelContract({
    appVersion: packageJson.version,
    explicitChannel,
  });
  assert(channelResolution.ok, `Tauri Windows release lane is blocked: ${channelResolution.reason} (${channelResolution.explicitChannel || 'unknown'})`);

  const bundleRoot = path.resolve(options.bundleRoot || path.join(activeWorkspaceRoot, 'src-tauri', 'target', 'release', 'bundle'));
  const installerPath = resolveNsisInstallerPath(bundleRoot);
  const installerSignaturePath = resolveInstallerSignaturePath(installerPath);
  const installerName = resolvePublishedInstallerName(path.basename(installerPath));
  const signatureName = `${installerName}.sig`;
  const installerStat = fs.statSync(installerPath);
  const releaseRoot = path.resolve(options.releaseRoot || path.join(activeWorkspaceRoot, 'release', 'tauri', 'windows'));
  const releaseManifestPath = path.join(releaseRoot, 'release-manifest.json');
  const installerOutputPath = path.join(releaseRoot, installerName);
  const signatureOutputPath = path.join(releaseRoot, signatureName);
  const installationGuidancePath = path.join(releaseRoot, installationGuidanceFileName);
  const { manifest } = loadTauriNodeSidecarLayout({ workspaceRoot: activeWorkspaceRoot });
  const updaterFeedFileName = `${channelResolution.contract.channel}-latest.json`;
  const updaterFeedPath = path.join(releaseRoot, updaterFeedFileName);

  fs.mkdirSync(releaseRoot, { recursive: true });
  fs.copyFileSync(installerPath, installerOutputPath);
  fs.copyFileSync(installerSignaturePath, signatureOutputPath);
  const updaterSignature = fs.readFileSync(signatureOutputPath, 'utf8').trim();
  const downloadBaseUrl = resolveDownloadBaseUrl(options, packageJson, channelResolution.contract.channel);
  const publishedAt = String(options.publishedAt || process.env.GITHUB_RELEASE_PUBLISHED_AT || new Date().toISOString()).trim();
  const installerUrl = `${downloadBaseUrl}/${encodeReleaseAssetName(installerName)}`;

  const releaseManifest = {
    schemaVersion: 1,
    platform: 'windows',
    shell: 'tauri',
    version: String(packageJson.version || '').trim(),
    releaseChannel: channelResolution.contract.channel,
    desktopReleaseChannelContract: channelResolution.contract,
    artifact: {
      packaging: manifest.releaseLane.packaging,
      relativePath: installerName,
      size: installerStat.size,
      sha256: toSha256(installerOutputPath),
    },
    updateLane: {
      mode: 'tauri_signed_updater',
      autoCheckEnabled: true,
      autoUpdateEnabled: true,
      releaseSource: 'tauri_static_json',
      failClosedChannelPolicy: manifest.releaseLane.failClosedChannelPolicy,
      installationGuidanceRelativePath: installationGuidanceFileName,
      updaterFeedRelativePath: updaterFeedFileName,
      updaterSignatureRelativePath: signatureName,
      updaterBridgeStatus: 'tauri_signed_updater',
    },
    runtime: {
      manifestRelativePath: 'runtime-manifests/windows-tauri-node-sidecar.json',
      nodeRuntimeRelativePath: manifest.nodeRuntime.relativePath,
      nodeModulesRelativePath: manifest.nodeModulePayload.targetRoot,
    },
  };

  const updaterFeed = {
    version: releaseManifest.version,
    pub_date: publishedAt,
    platforms: {
      'windows-x86_64': {
        url: installerUrl,
        signature: updaterSignature,
      },
    },
  };

  fs.writeFileSync(
    installationGuidancePath,
    renderWindowsInstallationGuide({
      version: releaseManifest.version,
      channel: releaseManifest.releaseChannel,
      installerName,
    }),
    'utf8',
  );
  fs.writeFileSync(releaseManifestPath, `${JSON.stringify(releaseManifest, null, 2)}\n`, 'utf8');
  fs.writeFileSync(updaterFeedPath, `${JSON.stringify(updaterFeed, null, 2)}\n`, 'utf8');

  return {
    releaseRoot,
    releaseManifestPath,
    installerPath: installerOutputPath,
    installerName,
    updaterSignaturePath: signatureOutputPath,
    updaterFeedPath,
    installationGuidancePath,
    channel: channelResolution.contract.channel,
  };
}

if (require.main === module) {
  try {
    const result = refreshTauriWindowsReleaseMetadata();
    console.log(
      `[refresh-tauri-win-release-metadata] refreshed ${path.basename(result.releaseManifestPath)} `
      + `for ${result.installerName} on ${result.channel}.`,
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[refresh-tauri-win-release-metadata] ${detail}`);
    process.exit(1);
  }
}

module.exports = {
  refreshTauriWindowsReleaseMetadata,
  renderWindowsInstallationGuide,
  resolvePublishedInstallerName,
  resolveNsisInstallerPath,
};
