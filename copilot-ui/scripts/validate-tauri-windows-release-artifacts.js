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

function validateTauriWindowsReleaseArtifacts(options = {}) {
  const activeWorkspaceRoot = path.resolve(options.workspaceRoot || workspaceRoot);
  const packageJson = JSON.parse(fs.readFileSync(path.join(activeWorkspaceRoot, 'package.json'), 'utf8'));
  const explicitChannel = process.env.INSTRUCTION_ENGINE_UPDATE_CHANNEL;
  const channelResolution = resolveDesktopReleaseChannelContract({
    appVersion: packageJson.version,
    explicitChannel,
  });
  assert(channelResolution.ok, `Tauri Windows release lane is blocked: ${channelResolution.reason} (${channelResolution.explicitChannel || 'unknown'})`);

  const stagedLayout = validateStagedTauriNodeSidecarLayoutMetadata({ workspaceRoot: activeWorkspaceRoot });
  const bundleConfig = validateTauriBundleConfig({ workspaceRoot: activeWorkspaceRoot });
  validateTauriNodeSidecarLayoutModel({ workspaceRoot: activeWorkspaceRoot });
  const stagedRollbackPolicy = JSON.parse(fs.readFileSync(stagedLayout.bundledRollbackPolicyPath, 'utf8'));

  const releaseRoot = path.resolve(options.releaseRoot || path.join(activeWorkspaceRoot, 'release', 'tauri', 'windows'));
  const releaseManifestPath = path.join(releaseRoot, 'release-manifest.json');
  const releaseManifest = JSON.parse(fs.readFileSync(releaseManifestPath, 'utf8'));
  const installerPath = path.join(releaseRoot, String(releaseManifest.artifact?.relativePath || '').trim());
  const installationGuidanceRelativePath = String(releaseManifest.updateLane?.installationGuidanceRelativePath || '').trim();
  const installationGuidancePath = path.join(releaseRoot, installationGuidanceRelativePath);
  const { manifest } = loadTauriNodeSidecarLayout({ workspaceRoot: activeWorkspaceRoot });

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
  assert(releaseManifest.updateLane?.mode === 'manual_installer', `Expected ${releaseManifestPath} updateLane.mode=manual_installer.`);
  assert(releaseManifest.updateLane?.autoCheckEnabled === true, `Expected ${releaseManifestPath} updateLane.autoCheckEnabled=true.`);
  assert(releaseManifest.updateLane?.autoUpdateEnabled === false, `Expected ${releaseManifestPath} updateLane.autoUpdateEnabled=false.`);
  assert(releaseManifest.updateLane?.downloadRequiresUserAction === true, `Expected ${releaseManifestPath} updateLane.downloadRequiresUserAction=true.`);
  assert(releaseManifest.updateLane?.applyRequiresUserAction === true, `Expected ${releaseManifestPath} updateLane.applyRequiresUserAction=true.`);
  assert(releaseManifest.updateLane?.releaseSource === 'github_release_manifest', `Expected ${releaseManifestPath} updateLane.releaseSource=github_release_manifest.`);
  assert(releaseManifest.updateLane?.failClosedChannelPolicy === true, `Expected ${releaseManifestPath} updateLane.failClosedChannelPolicy=true.`);
  assert(releaseManifest.updateLane?.installationGuidanceRelativePath === 'windows-installation-guide.md', `Expected ${releaseManifestPath} updateLane.installationGuidanceRelativePath=windows-installation-guide.md.`);
  assert(releaseManifest.updateLane?.inPlaceUpgradeSupported === false, `Expected ${releaseManifestPath} updateLane.inPlaceUpgradeSupported=false.`);
  assert(releaseManifest.updateLane?.updaterBridgeStatus === 'bridge_available_github_release_manual_installer', `Expected ${releaseManifestPath} updateLane.updaterBridgeStatus=bridge_available_github_release_manual_installer.`);
  assert(fs.existsSync(installationGuidancePath), `Missing Tauri Windows installation guidance referenced by ${releaseManifestPath}: ${installationGuidancePath}`);
  const installationGuidanceText = normalizeText(fs.readFileSync(installationGuidancePath, 'utf8'));
  assert(installationGuidanceText.includes('manual Windows installer'), `Expected ${installationGuidancePath} to describe the manual Windows installer flow.`);
  assert(installationGuidanceText.includes('matching-channel Windows installer'), `Expected ${installationGuidancePath} to keep channel-specific installation guidance.`);
  assert(installationGuidanceText.includes('automatically checks matching-channel GitHub releases'), `Expected ${installationGuidancePath} to describe the automatic GitHub release check posture.`);
  assert(installationGuidanceText.includes('installer download and apply still require explicit user action'), `Expected ${installationGuidancePath} to preserve the manual-installer handoff wording.`);
  assert(releaseManifest.runtime?.manifestRelativePath === 'runtime-manifests/windows-tauri-node-sidecar.json', `Expected ${releaseManifestPath} runtime manifest path to stay fixed.`);
  assert(releaseManifest.runtime?.nodeRuntimeRelativePath === manifest.nodeRuntime.relativePath, `Expected ${releaseManifestPath} node runtime path to match the Tauri sidecar manifest.`);
  assert(stagedRollbackPolicy.updatesEnabled === true, `Expected ${stagedLayout.bundledRollbackPolicyPath} updatesEnabled=true.`);

  return {
    releaseManifestPath,
    installerPath,
    installationGuidancePath,
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
