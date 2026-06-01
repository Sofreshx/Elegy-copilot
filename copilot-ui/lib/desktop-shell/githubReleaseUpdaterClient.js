'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeChannel(value) {
  const normalized = normalizeString(value).toLowerCase();
  return normalized === 'stable' || normalized === 'prerelease' ? normalized : '';
}

function isValidSha256(value) {
  return /^[a-f0-9]{64}$/i.test(normalizeString(value));
}

function parseSemver(version) {
  const value = normalizeString(version);
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value);
  if (!match) {
    return null;
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : [],
  };
}

function comparePrerelease(left, right) {
  if (!left.length && !right.length) {
    return 0;
  }
  if (!left.length) {
    return 1;
  }
  if (!right.length) {
    return -1;
  }

  const maxLength = Math.max(left.length, right.length);
  for (let index = 0; index < maxLength; index += 1) {
    const leftValue = left[index];
    const rightValue = right[index];
    if (leftValue === undefined) {
      return -1;
    }
    if (rightValue === undefined) {
      return 1;
    }
    if (leftValue === rightValue) {
      continue;
    }

    const leftNumeric = /^\d+$/.test(leftValue);
    const rightNumeric = /^\d+$/.test(rightValue);
    if (leftNumeric && rightNumeric) {
      const leftNumber = Number(leftValue);
      const rightNumber = Number(rightValue);
      if (leftNumber > rightNumber) {
        return 1;
      }
      if (leftNumber < rightNumber) {
        return -1;
      }
      continue;
    }
    if (leftNumeric) {
      return -1;
    }
    if (rightNumeric) {
      return 1;
    }
    return leftValue > rightValue ? 1 : -1;
  }

  return 0;
}

function compareSemver(left, right) {
  const leftVersion = parseSemver(left);
  const rightVersion = parseSemver(right);
  if (!leftVersion || !rightVersion) {
    return 0;
  }
  if (leftVersion.major !== rightVersion.major) {
    return leftVersion.major > rightVersion.major ? 1 : -1;
  }
  if (leftVersion.minor !== rightVersion.minor) {
    return leftVersion.minor > rightVersion.minor ? 1 : -1;
  }
  if (leftVersion.patch !== rightVersion.patch) {
    return leftVersion.patch > rightVersion.patch ? 1 : -1;
  }
  return comparePrerelease(leftVersion.prerelease, rightVersion.prerelease);
}

function sortBySemverDesc(left, right) {
  return compareSemver(right, left);
}

function isStableDesktopReleaseTag(tagName) {
  return /^desktop-v\d+\.\d+\.\d+$/.test(normalizeString(tagName));
}

function createBlockedResult(reason, message, extra = {}) {
  return {
    outcome: 'blocked',
    reason,
    message,
    ...extra,
  };
}

function createAvailableResult(candidate) {
  return {
    outcome: 'available',
    candidate,
  };
}

function createUpToDateResult(currentVersion) {
  return {
    outcome: 'up-to-date',
    currentVersion,
  };
}

function parsePublishRepository(value) {
  const normalized = normalizeString(value);
  const match = /^([^/\s]+)\/([^/\s]+)$/.exec(normalized);
  if (!match) {
    return null;
  }

  return {
    owner: match[1],
    repo: match[2],
  };
}

function splitAssetFileNameParts(value) {
  const fileName = normalizeString(value);
  if (!fileName) {
    return null;
  }

  const extension = path.extname(fileName).toLowerCase();
  return {
    fileName,
    extension,
    stem: extension ? fileName.slice(0, -extension.length) : fileName,
  };
}

function normalizeLooseAssetStem(value) {
  return normalizeString(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function resolveReleaseAsset(assets, name) {
  if (!Array.isArray(assets)) {
    return null;
  }

  const normalizedName = normalizeString(name);
  if (!normalizedName) {
    return null;
  }

  const exactMatch = assets.find((asset) => normalizeString(asset && asset.name) === normalizedName) || null;
  if (exactMatch) {
    return exactMatch;
  }

  const expectedParts = splitAssetFileNameParts(normalizedName);
  if (!expectedParts) {
    return null;
  }

  const expectedStem = normalizeLooseAssetStem(expectedParts.stem);
  if (!expectedStem) {
    return null;
  }

  const compatibleAssets = assets.filter((asset) => {
    const assetParts = splitAssetFileNameParts(asset && asset.name);
    if (!assetParts || assetParts.extension !== expectedParts.extension) {
      return false;
    }
    return normalizeLooseAssetStem(assetParts.stem) === expectedStem;
  });

  return compatibleAssets.length === 1 ? compatibleAssets[0] : null;
}

function validateReleaseManifest(manifest, release, expectedChannel) {
  if (!isObject(manifest) || Number(manifest.schemaVersion) !== 1) {
    return createBlockedResult(
      'github_release_manifest_invalid',
      'Release metadata is invalid or missing schemaVersion=1.',
    );
  }

  if (normalizeString(manifest.platform) !== 'windows' || normalizeString(manifest.shell) !== 'tauri') {
    return createBlockedResult(
      'github_release_manifest_invalid',
      'Release metadata does not describe the supported Windows Tauri installer lane.',
    );
  }

  const manifestChannel = normalizeChannel(manifest.releaseChannel);
  if (!manifestChannel) {
    return createBlockedResult(
      'github_release_manifest_invalid',
      'Release metadata is missing a valid releaseChannel value.',
    );
  }

  if (manifestChannel !== expectedChannel) {
    return createBlockedResult(
      'github_release_channel_mismatch',
      `Release metadata channel ${manifestChannel} does not match the active ${expectedChannel} lane.`,
    );
  }

  const channelContract = isObject(manifest.desktopReleaseChannelContract)
    ? manifest.desktopReleaseChannelContract
    : null;
  if (
    !channelContract
    || normalizeChannel(channelContract.channel) !== expectedChannel
    || normalizeChannel(channelContract.sdkChannel) !== expectedChannel
    || normalizeChannel(channelContract.cliChannel) !== expectedChannel
  ) {
    return createBlockedResult(
      'github_release_channel_mismatch',
      'Release metadata channel contract does not match the active app/SDK/CLI lane.',
    );
  }

  const version = normalizeString(manifest.version);
  if (!parseSemver(version)) {
    return createBlockedResult(
      'github_release_manifest_invalid',
      'Release metadata version is missing or not valid semver.',
    );
  }

  const updateLane = isObject(manifest.updateLane) ? manifest.updateLane : null;
  if (
    !updateLane
    || normalizeString(updateLane.mode) !== 'manual_installer'
    || updateLane.failClosedChannelPolicy !== true
    || updateLane.autoUpdateEnabled !== false
    || updateLane.inPlaceUpgradeSupported !== false
  ) {
    return createBlockedResult(
      'github_release_manifest_invalid',
      'Release metadata does not preserve the approved manual-installer and fail-closed update posture.',
    );
  }

  const artifact = isObject(manifest.artifact) ? manifest.artifact : null;
  const relativePath = normalizeString(artifact && artifact.relativePath);
  if (!artifact || !relativePath || !isValidSha256(artifact.sha256)) {
    return createBlockedResult(
      'github_release_manifest_invalid',
      'Release metadata is missing the installer artifact path or sha256 checksum.',
    );
  }

  const releaseAsset = resolveReleaseAsset(release.assets, relativePath);
  if (!releaseAsset || !normalizeString(releaseAsset.browser_download_url)) {
    return createBlockedResult(
      'github_release_artifact_missing',
      `Release metadata references installer ${relativePath}, but that asset is not published on the GitHub release.`,
    );
  }

  return {
    outcome: 'valid',
    candidate: {
      version,
      channel: manifestChannel,
      releaseId: release.id || null,
      releaseTag: normalizeString(release.tag_name) || null,
      releaseName: normalizeString(release.name) || version,
      releaseUrl: normalizeString(release.html_url) || null,
      publishedAt: normalizeString(release.published_at) || null,
      manifest,
      manifestAssetName: 'release-manifest.json',
      artifact: {
        name: normalizeString(releaseAsset.name) || relativePath,
        declaredName: relativePath,
        sha256: String(artifact.sha256).toLowerCase(),
        size: Number.isFinite(Number(artifact.size)) ? Number(artifact.size) : null,
        downloadUrl: normalizeString(releaseAsset.browser_download_url),
      },
    },
  };
}

async function hashFileSha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => {
      hash.update(chunk);
    });
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function writeResponseBodyToFile(response, destinationPath, totalBytes, onProgress) {
  const body = response.body;
  if (!body || typeof body.getReader !== 'function') {
    throw new Error('GitHub release download response body is unavailable.');
  }

  await fs.promises.mkdir(path.dirname(destinationPath), { recursive: true });
  const writer = fs.createWriteStream(destinationPath);
  const reader = body.getReader();
  let transferredBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      const chunk = Buffer.from(value);
      transferredBytes += chunk.length;
      if (!writer.write(chunk)) {
        await new Promise((resolve) => writer.once('drain', resolve));
      }

      if (typeof onProgress === 'function') {
        onProgress({
          transferredBytes,
          totalBytes,
          progressPercent: totalBytes > 0 ? (transferredBytes / totalBytes) * 100 : null,
        });
      }
    }

    await new Promise((resolve, reject) => {
      writer.end((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  } catch (error) {
    writer.destroy();
    throw error;
  }
}

async function pruneInstallerCache(options = {}) {
  const downloadRoot = normalizeString(options.downloadRoot);
  const channel = normalizeChannel(options.channel);
  const keepCount = Number.isFinite(options.keepCount) && Number(options.keepCount) > 0
    ? Number(options.keepCount)
    : 2;
  const logger = typeof options.logger === 'function' ? options.logger : () => {};
  const keepDirectory = normalizeString(options.keepDirectory);
  if (!downloadRoot || !channel) {
    return;
  }

  const channelRoot = path.join(downloadRoot, channel);
  const entries = await fs.promises.readdir(channelRoot, { withFileTypes: true }).catch(() => []);
  const versionEntries = [];
  const staleEntries = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const entryName = normalizeString(entry.name);
    const entryPath = path.join(channelRoot, entryName);
    if (!entryName) {
      staleEntries.push(entryPath);
      continue;
    }
    if (keepDirectory && path.resolve(entryPath) === path.resolve(keepDirectory)) {
      versionEntries.push({
        version: entryName,
        path: entryPath,
        keep: true,
      });
      continue;
    }
    if (!parseSemver(entryName)) {
      staleEntries.push(entryPath);
      continue;
    }
    versionEntries.push({
      version: entryName,
      path: entryPath,
      keep: false,
    });
  }

  const keepPaths = new Set(
    versionEntries
      .filter((entry) => entry.keep)
      .map((entry) => path.resolve(entry.path)),
  );
  const sortedVersions = versionEntries
    .filter((entry) => !entry.keep)
    .sort((left, right) => sortBySemverDesc(left.version, right.version));
  const remainingSlots = Math.max(0, keepCount - keepPaths.size);

  for (const entry of sortedVersions.slice(0, remainingSlots)) {
    keepPaths.add(path.resolve(entry.path));
  }

  const deletePaths = [
    ...staleEntries,
    ...versionEntries
      .map((entry) => entry.path)
      .filter((entryPath) => !keepPaths.has(path.resolve(entryPath))),
  ];

  for (const entryPath of deletePaths) {
    await fs.promises.rm(entryPath, { force: true, recursive: true }).catch((error) => {
      logger(`[desktop-updater] failed to prune installer cache entry ${entryPath}: ${String(error && error.message ? error.message : error)}`);
    });
  }
}

function createGitHubReleaseUpdaterClient(options = {}) {
  const fetchImpl = options.fetch || global.fetch;
  const publishRepository = parsePublishRepository(options.publishRepository);
  const logger = typeof options.logger === 'function' ? options.logger : () => {};
  const platform = normalizeString(options.platform) || process.platform;
  const releaseApiBaseUrl = normalizeString(options.releaseApiBaseUrl) || 'https://api.github.com';
  const requestTimeoutMs = Number.isFinite(options.requestTimeoutMs) && Number(options.requestTimeoutMs) > 0
    ? Number(options.requestTimeoutMs)
    : 15000;
  const downloadTimeoutMs = Number.isFinite(options.downloadTimeoutMs) && Number(options.downloadTimeoutMs) > 0
    ? Number(options.downloadTimeoutMs)
    : 15 * 60 * 1000;
  const downloadRoot = normalizeString(options.downloadRoot)
    || path.join(os.tmpdir(), 'elegy-copilot-updater');
  const keepInstallersPerChannel = Number.isFinite(options.keepInstallersPerChannel)
    && Number(options.keepInstallersPerChannel) > 0
    ? Number(options.keepInstallersPerChannel)
    : 2;

  if (typeof fetchImpl !== 'function') {
    throw new Error('Global fetch is unavailable; desktop updater cannot query GitHub releases.');
  }

  function createAbortController(timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return {
      signal: controller.signal,
      clear() {
        clearTimeout(timer);
      },
    };
  }

  async function fetchJson(url, timeoutMs) {
    const abortController = createAbortController(timeoutMs);
    try {
      const response = await fetchImpl(url, {
        headers: {
          Accept: 'application/vnd.github+json',
          'Cache-Control': 'no-store',
          'User-Agent': 'elegy-copilot-desktop-updater',
        },
        signal: abortController.signal,
      });
      if (!response.ok) {
        // 404 means no published releases on this channel — treat as empty, not error
        if (response.status === 404) {
          return [];
        }
        throw new Error(`GitHub release request failed with HTTP ${response.status}.`);
      }
      return await response.json();
    } finally {
      abortController.clear();
    }
  }

  async function fetchManifestAsset(assetUrl) {
    const abortController = createAbortController(requestTimeoutMs);
    try {
      const response = await fetchImpl(assetUrl, {
        headers: {
          Accept: 'application/json',
          'Cache-Control': 'no-store',
          'User-Agent': 'elegy-copilot-desktop-updater',
        },
        signal: abortController.signal,
      });
      if (!response.ok) {
        throw new Error(`Release manifest request failed with HTTP ${response.status}.`);
      }
      return await response.json();
    } finally {
      abortController.clear();
    }
  }

  async function findLatestReleaseCandidate(input = {}) {
    if (!publishRepository) {
      return createBlockedResult(
        'publish_repository_unavailable',
        'Desktop release publishRepository is unavailable in copilot-ui/package.json.',
      );
    }

    const expectedChannel = normalizeChannel(input.channel);
    const currentVersion = normalizeString(input.currentVersion);
    if (!expectedChannel) {
      return createBlockedResult(
        'update_channel_invalid',
        'Desktop updater could not resolve a valid update channel.',
      );
    }

    const releases = await fetchJson(
      `${releaseApiBaseUrl}/repos/${publishRepository.owner}/${publishRepository.repo}/releases?per_page=20`,
      requestTimeoutMs,
    );

    if (!Array.isArray(releases) || releases.length === 0) {
      return createUpToDateResult(currentVersion || null);
    }

    for (const release of releases) {
      if (!isObject(release)) {
        continue;
      }

      const isPrerelease = release.prerelease === true;
      if ((expectedChannel === 'stable' && isPrerelease) || (expectedChannel === 'prerelease' && !isPrerelease)) {
        continue;
      }

      if (expectedChannel === 'stable' && !isStableDesktopReleaseTag(release.tag_name)) {
        continue;
      }

      if (release.draft === true) {
        return createBlockedResult(
          'release_draft_unavailable',
          `The latest ${expectedChannel} GitHub release is still a draft and is not safe to surface in-app.`,
        );
      }

      const manifestAsset = resolveReleaseAsset(release.assets, 'release-manifest.json');
      if (!manifestAsset || !normalizeString(manifestAsset.browser_download_url)) {
        return createBlockedResult(
          'github_release_manifest_missing',
          `The latest ${expectedChannel} GitHub release is missing release-manifest.json.`,
        );
      }

      const manifest = await fetchManifestAsset(normalizeString(manifestAsset.browser_download_url));
      const manifestValidation = validateReleaseManifest(manifest, release, expectedChannel);
      if (manifestValidation.outcome !== 'valid') {
        return manifestValidation;
      }

      const candidate = manifestValidation.candidate;
      if (typeof input.isCandidateAllowed === 'function') {
        const decision = input.isCandidateAllowed(candidate.version);
        if (!decision || decision.allowed !== true) {
          return createBlockedResult(
            decision && decision.reason ? decision.reason : 'update_candidate_blocked',
            `Release ${candidate.version} is blocked by desktop update policy.`,
            {
              availableVersion: candidate.version,
            },
          );
        }
      }

      if (currentVersion && parseSemver(currentVersion) && compareSemver(candidate.version, currentVersion) <= 0) {
        return createUpToDateResult(currentVersion);
      }

      logger(`[desktop-updater] found ${expectedChannel} release candidate ${candidate.version}`);
      return createAvailableResult(candidate);
    }

    return createUpToDateResult(currentVersion || null);
  }

  async function downloadInstaller(candidate, options = {}) {
    if (!candidate || !candidate.artifact || !normalizeString(candidate.artifact.downloadUrl)) {
      throw new Error('Desktop updater does not have a valid installer candidate to download.');
    }

    const destinationDir = path.join(downloadRoot, normalizeChannel(candidate.channel) || 'stable', candidate.version);
    const destinationPath = path.join(destinationDir, path.basename(candidate.artifact.name));
    await fs.promises.rm(destinationDir, { force: true, recursive: true });

    const abortController = createAbortController(downloadTimeoutMs);
    try {
      const response = await fetchImpl(candidate.artifact.downloadUrl, {
        headers: {
          Accept: 'application/octet-stream',
          'Cache-Control': 'no-store',
          'User-Agent': 'elegy-copilot-desktop-updater',
        },
        signal: abortController.signal,
      });
      if (!response.ok) {
        throw new Error(`Installer download failed with HTTP ${response.status}.`);
      }

      const totalBytesHeader = Number(response.headers.get('content-length'));
      const totalBytes = Number.isFinite(totalBytesHeader) && totalBytesHeader > 0
        ? totalBytesHeader
        : (Number.isFinite(candidate.artifact.size) && candidate.artifact.size > 0 ? candidate.artifact.size : null);
      await writeResponseBodyToFile(response, destinationPath, totalBytes, options.onProgress);
      const sha256 = await hashFileSha256(destinationPath);
      if (sha256.toLowerCase() !== String(candidate.artifact.sha256).toLowerCase()) {
        await fs.promises.rm(destinationDir, { force: true, recursive: true });
        throw new Error(`Installer checksum mismatch for ${candidate.artifact.name}.`);
      }

      await pruneInstallerCache({
        downloadRoot,
        channel: candidate.channel,
        keepCount: keepInstallersPerChannel,
        keepDirectory: destinationDir,
        logger,
      });

      return {
        installerPath: destinationPath,
        version: candidate.version,
        channel: candidate.channel,
        totalBytes,
        sha256,
      };
    } finally {
      abortController.clear();
    }
  }

  async function launchInstaller(downloadResult) {
    if (platform !== 'win32') {
      throw new Error('Desktop installer launch is only supported on Windows in this slice.');
    }

    const installerPath = normalizeString(downloadResult && downloadResult.installerPath);
    if (!installerPath || !fs.existsSync(installerPath)) {
      throw new Error('Downloaded installer is unavailable. Download the update again before applying it.');
    }

    const child = childProcess.spawn(installerPath, [], {
      detached: true,
      shell: false,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.unref();
    return true;
  }

  return {
    publishRepository,
    findLatestReleaseCandidate,
    downloadInstaller,
    launchInstaller,
  };
}

module.exports = {
  createGitHubReleaseUpdaterClient,
  parsePublishRepository,
};
