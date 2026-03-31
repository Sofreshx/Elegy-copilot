'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const yaml = require('js-yaml');
const { appBuilderPath } = require('app-builder-bin');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function toBase64Sha512(filePath) {
  const hash = crypto.createHash('sha512');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('base64');
}

function refreshWindowsReleaseMetadata(options = {}) {
  const releaseRoot = path.resolve(options.releaseRoot || path.join(__dirname, '..', 'release'));
  const latestManifestPath = path.join(releaseRoot, 'latest.yml');
  assert(fs.existsSync(latestManifestPath), `Missing Windows release manifest: ${latestManifestPath}`);

  const manifest = yaml.load(fs.readFileSync(latestManifestPath, 'utf8'));
  assert(manifest && typeof manifest === 'object', `Invalid Windows release manifest: ${latestManifestPath}`);

  const installerRelativePath = String(manifest.path || '').trim();
  assert(installerRelativePath, 'latest.yml does not declare a Windows installer path.');

  const installerPath = path.resolve(releaseRoot, installerRelativePath);
  const normalizedReleaseRoot = `${path.resolve(releaseRoot)}${path.sep}`;
  assert(installerPath.startsWith(normalizedReleaseRoot), `Installer resolves outside release root: ${installerPath}`);
  assert(fs.existsSync(installerPath), `Installer declared in latest.yml was not found: ${installerPath}`);

  const blockmapPath = `${installerPath}.blockmap`;
  execFileSync(appBuilderPath, ['blockmap', '--input', installerPath, '--output', blockmapPath], {
    stdio: 'inherit',
  });

  const installerStat = fs.statSync(installerPath);
  const installerSha512 = toBase64Sha512(installerPath);
  manifest.path = installerRelativePath;
  manifest.sha512 = installerSha512;
  manifest.files = [
    {
      url: installerRelativePath.replace(/\\/g, '/'),
      sha512: installerSha512,
      size: installerStat.size,
    },
  ];
  fs.writeFileSync(latestManifestPath, yaml.dump(manifest, { lineWidth: 120 }), 'utf8');

  return {
    latestManifestPath,
    installerPath,
    blockmapPath,
    sha512: installerSha512,
    size: installerStat.size,
  };
}

if (require.main === module) {
  try {
    const result = refreshWindowsReleaseMetadata();
    console.log(`[refresh-windows-release-metadata] refreshed latest.yml and blockmap for ${path.basename(result.installerPath)}`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[refresh-windows-release-metadata] ${detail}`);
    process.exit(1);
  }
}

module.exports = {
  refreshWindowsReleaseMetadata,
};
