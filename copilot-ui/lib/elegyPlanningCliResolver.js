'use strict';

const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const GITHUB_REPO = 'AnomalycoAgent/elegy-planning';
const GITHUB_RELEASE_TAG = 'latest';

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isWindows() {
  return process.platform === 'win32';
}

function binaryName() {
  return isWindows() ? 'elegy-planning.exe' : 'elegy-planning';
}

function isPathLikeCommand(candidate) {
  const normalized = normalizeString(candidate);
  if (!normalized) {
    return false;
  }

  if (/^[a-zA-Z]:[\\/]/.test(normalized)) {
    return true;
  }

  if (normalized.startsWith('./') || normalized.startsWith('../') || normalized.startsWith('~/')) {
    return true;
  }

  return normalized.includes('/') || normalized.includes('\\');
}

function commandExistsOnPath(command, options = {}) {
  const normalized = normalizeString(command);
  if (!normalized || isPathLikeCommand(normalized)) {
    return false;
  }

  const platform = normalizeString(options.platform) || process.platform;
  const env = options.env && typeof options.env === 'object' ? options.env : process.env;
  const spawnSyncImpl = typeof options.spawnSyncImpl === 'function'
    ? options.spawnSyncImpl
    : childProcess.spawnSync;
  const resolverCommand = platform === 'win32' ? 'where' : 'which';

  try {
    const result = spawnSyncImpl(resolverCommand, [normalized], {
      env,
      windowsHide: true,
      stdio: 'pipe',
    });
    return Number(result && result.status) === 0;
  } catch {
    return false;
  }
}

function candidatePaths(runtimeRoot, copilotHome) {
  const exe = binaryName();
  const candidates = [];

  if (runtimeRoot) {
    candidates.push(
      path.join(runtimeRoot, 'elegy-planning', exe),
      path.join(runtimeRoot, 'elegy-planning', 'bin', exe),
      path.join(runtimeRoot, 'copilot-ui', 'resources', 'elegy-planning', exe),
    );
  }

  if (copilotHome) {
    candidates.push(
      path.join(copilotHome, 'managed-cli', 'planning', 'bin', exe),
      path.join(copilotHome, 'managed-cli', 'planning', exe),
      path.join(copilotHome, 'bin', exe),
      path.join(copilotHome, 'elegy-planning', exe),
    );
  }

  return candidates;
}

function findExistingBinary(runtimeRoot, copilotHome, existsSyncImpl) {
  const existsSyncFn = typeof existsSyncImpl === 'function' ? existsSyncImpl : fs.existsSync;
  for (const candidate of candidatePaths(runtimeRoot, copilotHome)) {
    try {
      if (existsSyncFn(candidate)) {
        return candidate;
      }
    } catch {
      // continue
    }
  }
  return null;
}

function buildDownloadDir(copilotHome) {
  return path.join(copilotHome, 'managed-cli', 'planning');
}

function buildDownloadPath(copilotHome) {
  return path.join(buildDownloadDir(copilotHome), binaryName());
}

function buildGitHubReleaseUrl() {
  return `https://api.github.com/repos/${GITHUB_REPO}/releases/${GITHUB_RELEASE_TAG}`;
}

function buildAssetDownloadUrl(version) {
  const exe = binaryName();
  const platform = isWindows() ? 'windows' : 'linux';
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const assetName = `elegy-planning-${version}-${platform}-${arch}${isWindows() ? '.exe' : ''}`;
  return `https://github.com/${GITHUB_REPO}/releases/download/v${version}/${assetName}`;
}

function buildFallbackAssetUrls(version) {
  const exe = binaryName();
  const urls = [];

  if (isWindows()) {
    urls.push(
      `https://github.com/${GITHUB_REPO}/releases/download/v${version}/elegy-planning-windows-x64.exe`,
      `https://github.com/${GITHUB_REPO}/releases/download/v${version}/${exe}`,
      `https://github.com/${GITHUB_REPO}/releases/download/v${version}/elegy-planning.exe`,
    );
  } else {
    urls.push(
      `https://github.com/${GITHUB_REPO}/releases/download/v${version}/elegy-planning-linux-x64`,
      `https://github.com/${GITHUB_REPO}/releases/download/v${version}/${exe}`,
    );
  }

  return urls;
}

function hashFileSha256Sync(filePath) {
  try {
    const data = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(data).digest('hex');
  } catch {
    return null;
  }
}

async function fetchLatestReleaseInfo(fetchImpl) {
  const fetchFn = typeof fetchImpl === 'function' ? fetchImpl : globalThis.fetch;
  if (typeof fetchFn !== 'function') {
    throw new Error('Global fetch is unavailable; cannot query GitHub releases.');
  }

  const url = buildGitHubReleaseUrl();
  const response = await fetchFn(url, {
    headers: {
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'instruction-engine',
    },
  });

  if (!response || !response.ok) {
    const status = response ? response.status : 'network_error';
    throw new Error(`GitHub release query failed (${status}): ${url}`);
  }

  const release = await response.json();
  const version = normalizeString(release.tag_name || '').replace(/^v/, '');
  if (!version) {
    throw new Error('GitHub release is missing a version tag.');
  }

  const assets = Array.isArray(release.assets) ? release.assets : [];
  const exe = binaryName();

  let asset = assets.find((a) => normalizeString(a.name) === `elegy-planning-${version}-${isWindows() ? 'windows' : 'linux'}-${process.arch === 'arm64' ? 'arm64' : 'x64'}${isWindows() ? '.exe' : ''}`);
  if (!asset) {
    asset = assets.find((a) => normalizeString(a.name) === exe);
  }
  if (!asset) {
    asset = assets.find((a) => normalizeString(a.name).startsWith('elegy-planning'));
  }

  return { version, asset, assets };
}

async function downloadToFile(fetchImpl, url, destinationPath) {
  const fetchFn = typeof fetchImpl === 'function' ? fetchImpl : globalThis.fetch;
  if (typeof fetchFn !== 'function') {
    throw new Error('Global fetch is unavailable; cannot download elegy-planning binary.');
  }

  await fs.promises.mkdir(path.dirname(destinationPath), { recursive: true });

  const response = await fetchFn(url, {
    headers: { 'User-Agent': 'instruction-engine' },
    redirect: 'follow',
  });

  if (!response || !response.ok) {
    const status = response ? response.status : 'network_error';
    throw new Error(`Download failed (${status}): ${url}`);
  }

  const body = response.body;
  if (!body || typeof body.getReader !== 'function') {
    throw new Error('Download response body is unavailable.');
  }

  const writer = fs.createWriteStream(destinationPath);
  const reader = body.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      if (!writer.write(chunk)) {
        await new Promise((resolve) => writer.once('drain', resolve));
      }
    }
    await new Promise((resolve, reject) => {
      writer.end((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  } catch (error) {
    writer.destroy();
    throw error;
  }

  if (!isWindows()) {
    try {
      fs.chmodSync(destinationPath, 0o755);
    } catch {
      // best-effort
    }
  }
}

async function downloadElegyPlanningCli(options = {}) {
  const copilotHome = normalizeString(options.copilotHome);
  if (!copilotHome) {
    throw new Error('copilotHome is required to download elegy-planning.');
  }

  const fetchImpl = options.fetchImpl;
  const logger = typeof options.logger === 'function' ? options.logger : () => {};

  logger('Querying GitHub for latest elegy-planning release...');
  const release = await fetchLatestReleaseInfo(fetchImpl);
  logger(`Found release v${release.version}`);

  const downloadPath = buildDownloadPath(copilotHome);

  let downloadUrl = null;
  if (release.asset) {
    downloadUrl = normalizeString(release.asset.browser_download_url);
  }
  if (!downloadUrl) {
    const fallbacks = buildFallbackAssetUrls(release.version);
    downloadUrl = fallbacks[0];
  }

  if (!downloadUrl) {
    throw new Error(`No suitable elegy-planning binary found in release v${release.version}.`);
  }

  logger(`Downloading elegy-planning from: ${downloadUrl}`);
  await downloadToFile(fetchImpl, downloadUrl, downloadPath);

  if (!fs.existsSync(downloadPath)) {
    throw new Error(`Download completed but binary not found at ${downloadPath}.`);
  }

  logger(`elegy-planning installed to: ${downloadPath}`);
  return downloadPath;
}

function resolveElegyPlanningCliPath(options = {}) {
  const explicitCliPath = normalizeString(options.cliPath);
  const runtimeRoot = normalizeString(options.runtimeRoot);
  const copilotHome = normalizeString(options.copilotHome);
  const defaultCommand = normalizeString(options.defaultCommand) || 'elegy-planning';
  const existsSyncFn = typeof options.existsSync === 'function' ? options.existsSync : fs.existsSync;
  const commandLookupOptions = {
    env: options.env,
    platform: options.platform,
    spawnSyncImpl: options.spawnSyncImpl,
  };

  if (explicitCliPath) {
    try {
      if (existsSyncFn(explicitCliPath)) {
        return explicitCliPath;
      }
    } catch {
      // continue
    }

    if (commandExistsOnPath(explicitCliPath, commandLookupOptions)) {
      return explicitCliPath;
    }
  }

  const found = findExistingBinary(runtimeRoot, copilotHome, existsSyncFn);
  if (found) {
    return found;
  }

  const downloadedPath = buildDownloadPath(copilotHome);
  try {
    if (existsSyncFn(downloadedPath)) {
      return downloadedPath;
    }
  } catch {
    // continue
  }

  if (commandExistsOnPath(defaultCommand, commandLookupOptions)) {
    return defaultCommand;
  }

  return '';
}

module.exports = {
  resolveElegyPlanningCliPath,
  downloadElegyPlanningCli,
  fetchLatestReleaseInfo,
  findExistingBinary,
  candidatePaths,
  buildDownloadPath,
  commandExistsOnPath,
  isPathLikeCommand,
};
