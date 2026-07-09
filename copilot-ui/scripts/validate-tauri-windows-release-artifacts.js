'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const {
  loadTauriNodeSidecarLayout,
  validateStagedTauriNodeSidecarLayoutMetadata,
  validateTauriBundleConfig,
  validateTauriNodeSidecarLayoutModel,
} = require('./tauri-node-sidecar-layout');
const { resolveDesktopReleaseChannelContract } = require('./desktop-release-policy');

const workspaceRoot = path.resolve(__dirname, '..');

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

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeString(value) {
  return String(value || '').trim();
}

function assertRfc3339Date(value, label) {
  const normalized = normalizeString(value);
  assert(normalized, `${label} is required.`);
  assert(!Number.isNaN(Date.parse(normalized)), `${label} must be a parseable RFC 3339 timestamp.`);
}

function validateTauriWindowsReleaseArtifacts(options = {}) {
  const activeWorkspaceRoot = path.resolve(options.workspaceRoot || workspaceRoot);
  const packageJson = JSON.parse(fs.readFileSync(path.join(activeWorkspaceRoot, 'package.json'), 'utf8'));
  const explicitChannel = process.env.INSTRUCTION_ENGINE_UPDATE_CHANNEL;
  const channelResolution = resolveDesktopReleaseChannelContract({
    appVersion: packageJson.version,
    explicitChannel,
  });
  assert(channelResolution.ok, `Tauri Windows release lane is blocked: ${channelResolution.reason} (${channelResolution.explicitChannel || 'unknown'})`);

  const stagedLayout = options.skipLayoutValidation
    ? {
      bundledRollbackPolicyPath: path.join(activeWorkspaceRoot, 'src-tauri', 'gen', 'resources', 'runtime-manifests', 'default-desktop-rollback-policy.json'),
      nodeRuntimeRelativePath: 'node/node.exe',
    }
    : validateStagedTauriNodeSidecarLayoutMetadata({ workspaceRoot: activeWorkspaceRoot });
  const bundleConfig = options.skipLayoutValidation
    ? { bundleTarget: 'nsis' }
    : validateTauriBundleConfig({ workspaceRoot: activeWorkspaceRoot });
  if (!options.skipLayoutValidation) {
    validateTauriNodeSidecarLayoutModel({ workspaceRoot: activeWorkspaceRoot });
  }
  const stagedRollbackPolicy = fs.existsSync(stagedLayout.bundledRollbackPolicyPath)
    ? JSON.parse(fs.readFileSync(stagedLayout.bundledRollbackPolicyPath, 'utf8'))
    : { updatesEnabled: true };

  const releaseRoot = path.resolve(options.releaseRoot || path.join(activeWorkspaceRoot, 'release', 'tauri', 'windows'));
  const releaseManifestPath = path.join(releaseRoot, 'release-manifest.json');
  const releaseManifest = JSON.parse(fs.readFileSync(releaseManifestPath, 'utf8'));
  const installerPath = path.join(releaseRoot, String(releaseManifest.artifact?.relativePath || '').trim());
  const installationGuidanceRelativePath = String(releaseManifest.updateLane?.installationGuidanceRelativePath || '').trim();
  const installationGuidancePath = path.join(releaseRoot, installationGuidanceRelativePath);
  const { manifest } = loadTauriNodeSidecarLayout({ workspaceRoot: activeWorkspaceRoot });
  const updaterFeedRelativePath = normalizeString(releaseManifest.updateLane?.updaterFeedRelativePath);
  const updaterSignatureRelativePath = normalizeString(releaseManifest.updateLane?.updaterSignatureRelativePath);
  const updaterFeedPath = updaterFeedRelativePath ? path.join(releaseRoot, updaterFeedRelativePath) : '';
  const updaterSignaturePath = updaterSignatureRelativePath ? path.join(releaseRoot, updaterSignatureRelativePath) : '';

  assert(Number(releaseManifest.schemaVersion) === 1, `Expected ${releaseManifestPath} schemaVersion=1.`);
  assert(releaseManifest.platform === 'windows', `Expected ${releaseManifestPath} platform=windows.`);
  assert(releaseManifest.shell === 'tauri', `Expected ${releaseManifestPath} shell=tauri.`);
  assert(releaseManifest.version === packageJson.version, `Expected ${releaseManifestPath} version ${packageJson.version}, received ${releaseManifest.version}.`);
  assert(releaseManifest.releaseChannel === channelResolution.contract.channel, `Expected ${releaseManifestPath} releaseChannel=${channelResolution.contract.channel}.`);
  assert(
    JSON.stringify(releaseManifest.desktopReleaseChannelContract) === JSON.stringify(channelResolution.contract),
    `Expected ${releaseManifestPath} desktopReleaseChannelContract to match the release channel contract.`,
  );
  assert(releaseManifest.artifact?.packaging === manifest.releaseLane.packaging, `Expected ${releaseManifestPath} artifact.packaging=${manifest.releaseLane.packaging}.`);
  assert(fs.existsSync(installerPath), `Missing Tauri Windows installer referenced by ${releaseManifestPath}: ${installerPath}`);
  assert(releaseManifest.artifact.sha256 === toSha256(installerPath), `Tauri Windows installer SHA256 drifted from ${releaseManifestPath}.`);
  assert(releaseManifest.updateLane?.mode === 'tauri_signed_updater', `Expected ${releaseManifestPath} updateLane.mode=tauri_signed_updater.`);
  assert(releaseManifest.updateLane?.autoCheckEnabled === true, `Expected ${releaseManifestPath} updateLane.autoCheckEnabled=true.`);
  assert(releaseManifest.updateLane?.autoUpdateEnabled === true, `Expected ${releaseManifestPath} updateLane.autoUpdateEnabled=true.`);
  assert(releaseManifest.updateLane?.releaseSource === 'tauri_static_json', `Expected ${releaseManifestPath} updateLane.releaseSource=tauri_static_json.`);
  assert(releaseManifest.updateLane?.failClosedChannelPolicy === true, `Expected ${releaseManifestPath} updateLane.failClosedChannelPolicy=true.`);
  assert(releaseManifest.updateLane?.updaterBridgeStatus === 'tauri_signed_updater', `Expected ${releaseManifestPath} updateLane.updaterBridgeStatus=tauri_signed_updater.`);
  assert(updaterFeedRelativePath === `${releaseManifest.releaseChannel}-latest.json`, `Expected ${releaseManifestPath} updateLane.updaterFeedRelativePath=${releaseManifest.releaseChannel}-latest.json.`);
  assert(updaterSignatureRelativePath.endsWith('.sig'), `Expected ${releaseManifestPath} updateLane.updaterSignatureRelativePath to reference a .sig file.`);
  assert(fs.existsSync(updaterFeedPath), `Missing Tauri updater feed referenced by ${releaseManifestPath}: ${updaterFeedPath}`);
  assert(fs.existsSync(updaterSignaturePath), `Missing Tauri updater signature referenced by ${releaseManifestPath}: ${updaterSignaturePath}`);
  const signature = normalizeString(fs.readFileSync(updaterSignaturePath, 'utf8'));
  assert(signature, `Expected ${updaterSignaturePath} to contain a Tauri updater signature.`);
  const updaterFeed = JSON.parse(fs.readFileSync(updaterFeedPath, 'utf8'));
  assert(updaterFeed.version === packageJson.version, `Expected ${updaterFeedPath} version ${packageJson.version}, received ${updaterFeed.version}.`);
  assertRfc3339Date(updaterFeed.pub_date, `${updaterFeedPath} pub_date`);
  assert(isObject(updaterFeed.platforms), `Expected ${updaterFeedPath} platforms object.`);
  const windowsPlatform = updaterFeed.platforms['windows-x86_64'];
  assert(isObject(windowsPlatform), `Expected ${updaterFeedPath} platforms.windows-x86_64 object.`);
  assert(normalizeString(windowsPlatform.url), `Expected ${updaterFeedPath} platforms.windows-x86_64 url.`);
  assert(normalizeString(windowsPlatform.signature), `Expected ${updaterFeedPath} platforms.windows-x86_64 signature.`);
  assert(windowsPlatform.signature === signature, `Expected ${updaterFeedPath} windows-x86_64 signature to match ${updaterSignaturePath}.`);
  if (installationGuidanceRelativePath) {
    assert(fs.existsSync(installationGuidancePath), `Missing Tauri Windows installation guidance referenced by ${releaseManifestPath}: ${installationGuidancePath}`);
    const installationGuidanceText = normalizeText(fs.readFileSync(installationGuidancePath, 'utf8'));
    assert(installationGuidanceText.includes('signed Tauri updater'), `Expected ${installationGuidancePath} to describe the signed Tauri updater flow.`);
    assert(installationGuidanceText.includes('matching-channel update feed'), `Expected ${installationGuidancePath} to keep channel-specific updater guidance.`);
  }
  assert(releaseManifest.runtime?.manifestRelativePath === 'runtime-manifests/windows-tauri-node-sidecar.json', `Expected ${releaseManifestPath} runtime manifest path to stay fixed.`);
  assert(releaseManifest.runtime?.nodeRuntimeRelativePath === manifest.nodeRuntime.relativePath, `Expected ${releaseManifestPath} node runtime path to match the Tauri sidecar manifest.`);
  assert(stagedRollbackPolicy.updatesEnabled === true, `Expected ${stagedLayout.bundledRollbackPolicyPath} updatesEnabled=true.`);

  return {
    releaseManifestPath,
    installerPath,
    installationGuidancePath,
    updaterFeedPath,
    updaterSignaturePath,
    rollbackPolicyPath: stagedLayout.bundledRollbackPolicyPath,
    channel: releaseManifest.releaseChannel,
    stagingNodeRuntime: stagedLayout.nodeRuntimeRelativePath,
    configuredBundleTarget: bundleConfig.bundleTarget,
  };
}

if (require.main === module) {
  try {
    const result = validateTauriWindowsReleaseArtifacts();
    console.log(
      `[tauri-win-release] validated ${path.basename(result.releaseManifestPath)}; `
      + `installer=${path.basename(result.installerPath)}; channel=${result.channel}; `
      + `target=${result.configuredBundleTarget}; node=${result.stagingNodeRuntime}; `
      + `guide=${path.basename(result.installationGuidancePath)}; `
      + `rollback=${path.basename(result.rollbackPolicyPath)}.`,
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[tauri-win-release] ${detail}`);
    process.exit(1);
  }
}

module.exports = {
  validateTauriWindowsReleaseArtifacts,
};
