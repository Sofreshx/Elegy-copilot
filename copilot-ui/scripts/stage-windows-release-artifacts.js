'use strict';

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function ensureCleanDir(targetPath) {
  fs.rmSync(targetPath, { recursive: true, force: true });
  fs.mkdirSync(targetPath, { recursive: true });
}

function readLatestManifest(releaseRoot) {
  const latestManifestPath = path.join(releaseRoot, 'latest.yml');
  assert(fs.existsSync(latestManifestPath), `Missing Windows release manifest: ${latestManifestPath}`);
  const latestManifest = yaml.load(fs.readFileSync(latestManifestPath, 'utf8'));
  assert(latestManifest && typeof latestManifest === 'object', `Invalid Windows release manifest: ${latestManifestPath}`);

  const installerRelativePath = String(latestManifest.path || '').trim();
  assert(installerRelativePath, 'latest.yml does not declare a Windows installer path.');

  const installerPath = path.resolve(releaseRoot, installerRelativePath);
  const normalizedReleaseRoot = `${path.resolve(releaseRoot)}${path.sep}`;
  assert(installerPath.startsWith(normalizedReleaseRoot), `Installer resolves outside release root: ${installerPath}`);
  assert(fs.existsSync(installerPath), `Installer declared in latest.yml was not found: ${installerPath}`);

  return {
    latestManifestPath,
    latestManifest,
    installerRelativePath,
    installerPath,
    installerName: path.basename(installerPath),
    blockmapPath: `${installerPath}.blockmap`,
  };
}

function copyRequiredFile(sourcePath, targetPath) {
  assert(fs.existsSync(sourcePath), `Required artifact not found: ${sourcePath}`);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
}

function stageWindowsReleaseArtifacts(options = {}) {
  const releaseRoot = path.resolve(options.releaseRoot || path.join(__dirname, '..', 'release'));
  const outputRoot = path.resolve(options.outputRoot || path.join(__dirname, '..', '..', 'release-artifacts', 'windows'));
  const includeEvidence = Array.isArray(options.includeEvidence) ? options.includeEvidence : [];

  const {
    latestManifestPath,
    installerRelativePath,
    installerPath,
    installerName,
    blockmapPath,
  } = readLatestManifest(releaseRoot);

  ensureCleanDir(outputRoot);

  copyRequiredFile(latestManifestPath, path.join(outputRoot, 'latest.yml'));
  copyRequiredFile(installerPath, path.join(outputRoot, installerRelativePath));
  copyRequiredFile(installerPath, path.join(outputRoot, installerName));
  copyRequiredFile(blockmapPath, path.join(outputRoot, `${installerRelativePath}.blockmap`));

  for (const entry of includeEvidence) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }

    const sourcePath = path.resolve(String(entry.sourcePath || ''));
    const relativeTarget = String(entry.relativeTarget || '').trim();
    if (!sourcePath || !relativeTarget) {
      continue;
    }

    copyRequiredFile(sourcePath, path.join(outputRoot, relativeTarget));
  }

  return {
    outputRoot,
    installerRelativePath,
    installerName,
  };
}

if (require.main === module) {
  try {
    const includeEvidence = [];
    for (const value of process.argv.slice(2)) {
      const [sourcePath, relativeTarget] = String(value).split('::');
      includeEvidence.push({ sourcePath, relativeTarget });
    }

    const result = stageWindowsReleaseArtifacts({ includeEvidence });
    console.log(`[stage-windows-release-artifacts] staged ${result.installerRelativePath} into ${result.outputRoot}`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[stage-windows-release-artifacts] ${detail}`);
    process.exit(1);
  }
}

module.exports = {
  readLatestManifest,
  stageWindowsReleaseArtifacts,
};
