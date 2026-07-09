'use strict';

const fs = require('fs');
const path = require('path');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function copyRequiredFile(sourcePath, targetPath) {
  assert(fs.existsSync(sourcePath), `Required artifact not found: ${sourcePath}`);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
}

function stageTauriWindowsReleaseArtifacts(options = {}) {
  const workspaceRoot = path.resolve(options.workspaceRoot || path.join(__dirname, '..'));
  const releaseRoot = path.resolve(options.releaseRoot || path.join(workspaceRoot, 'release', 'tauri', 'windows'));
  const outputRoot = path.resolve(options.outputRoot || path.join(workspaceRoot, '..', 'release-artifacts', 'windows-tauri'));
  const releaseManifestPath = path.join(releaseRoot, 'release-manifest.json');

  assert(fs.existsSync(releaseManifestPath), `Missing Tauri Windows release manifest: ${releaseManifestPath}`);
  const releaseManifest = JSON.parse(fs.readFileSync(releaseManifestPath, 'utf8'));
  const installerRelativePath = String(releaseManifest.artifact?.relativePath || '').trim();
  const installationGuidanceRelativePath = String(
    releaseManifest.updateLane?.installationGuidanceRelativePath
      || '',
  ).trim();
  const updaterFeedRelativePath = String(releaseManifest.updateLane?.updaterFeedRelativePath || '').trim();
  const updaterSignatureRelativePath = String(releaseManifest.updateLane?.updaterSignatureRelativePath || '').trim();
  assert(installerRelativePath, `Tauri Windows release manifest is missing artifact.relativePath: ${releaseManifestPath}`);
  assert(updaterFeedRelativePath, `Tauri Windows release manifest is missing updateLane.updaterFeedRelativePath: ${releaseManifestPath}`);
  assert(updaterSignatureRelativePath, `Tauri Windows release manifest is missing updateLane.updaterSignatureRelativePath: ${releaseManifestPath}`);
  const installerPath = path.join(releaseRoot, installerRelativePath);

  fs.rmSync(outputRoot, { recursive: true, force: true });
  fs.mkdirSync(outputRoot, { recursive: true });

  copyRequiredFile(releaseManifestPath, path.join(outputRoot, 'release-manifest.json'));
  copyRequiredFile(installerPath, path.join(outputRoot, installerRelativePath));
  copyRequiredFile(
    path.join(releaseRoot, updaterFeedRelativePath),
    path.join(outputRoot, updaterFeedRelativePath),
  );
  copyRequiredFile(
    path.join(releaseRoot, updaterSignatureRelativePath),
    path.join(outputRoot, updaterSignatureRelativePath),
  );
  if (installationGuidanceRelativePath) {
    copyRequiredFile(
      path.join(releaseRoot, installationGuidanceRelativePath),
      path.join(outputRoot, installationGuidanceRelativePath),
    );
  }

  return {
    outputRoot,
    installerRelativePath,
    installationGuidanceRelativePath,
  };
}

if (require.main === module) {
  try {
    const result = stageTauriWindowsReleaseArtifacts();
    console.log(`[stage-tauri-win-release-artifacts] staged ${result.installerRelativePath} into ${result.outputRoot}`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[stage-tauri-win-release-artifacts] ${detail}`);
    process.exit(1);
  }
}

module.exports = {
  stageTauriWindowsReleaseArtifacts,
};
