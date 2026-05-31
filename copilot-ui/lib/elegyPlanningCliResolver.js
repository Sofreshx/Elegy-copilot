'use strict';

const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const GITHUB_REPO = 'Sofreshx/Elegy';
const GITHUB_RELEASE_TAG = 'latest';
const BINARY_NAME = 'elegy-planning';

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

function buildTargetTriple() {
  if (isWindows()) {
    return process.arch === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc';
  }
  if (process.platform === 'darwin') {
    return process.arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin';
  }
  return process.arch === 'arm64' ? 'aarch64-unknown-linux-gnu' : 'x86_64-unknown-linux-gnu';
}

function buildAssetDownloadUrl(version, releaseTag) {
  const tag = normalizeString(releaseTag || version);
  const triple = buildTargetTriple();
  const assetName = `${BINARY_NAME}-${version}-${triple}.zip`;
  return `https://github.com/${GITHUB_REPO}/releases/download/${tag}/${assetName}`;
}

function buildFallbackAssetUrls(version, releaseTag) {
  const tag = normalizeString(releaseTag || version);
  const urls = [];
  const triple = buildTargetTriple();

  urls.push(
    `https://github.com/${GITHUB_REPO}/releases/download/${tag}/${BINARY_NAME}-${version}-${triple}.zip`,
  );

  if (!isWindows()) {
    const altTriple = buildTargetTriple().replace('unknown-', '');
    if (altTriple !== triple) {
      urls.push(
        `https://github.com/${GITHUB_REPO}/releases/download/${tag}/${BINARY_NAME}-${version}-${altTriple}.zip`,
      );
    }
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
  const releaseTag = normalizeString(release.tag_name || '');
  const releaseVersion = releaseTag.replace(/^v/, '');
  if (!releaseVersion) {
    throw new Error('GitHub release is missing a version tag.');
  }

  const assets = Array.isArray(release.assets) ? release.assets : [];
  const triple = buildTargetTriple();

  let asset = assets.find((a) =>
    normalizeString(a.name).startsWith(BINARY_NAME) && normalizeString(a.name).includes(triple)
  );
  if (!asset) {
    asset = assets.find((a) =>
      normalizeString(a.name).startsWith(BINARY_NAME) && normalizeString(a.name).endsWith('.zip')
    );
  }
  if (!asset) {
    asset = assets.find((a) =>
      normalizeString(a.name) === binaryName() || normalizeString(a.name) === `${BINARY_NAME}.exe`
    );
  }

  return { version: releaseVersion, releaseTag, asset, assets };
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

function findBinaryInDir(dirPath, targetName) {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isFile() && entry.name === targetName) {
        return fullPath;
      }
      if (entry.isDirectory()) {
        const found = findBinaryInDir(fullPath, targetName);
        if (found) return found;
      }
    }
  } catch {
    // ignore read errors
  }
  return null;
}

function safeRmSync(absPath) {
  try {
    fs.rmSync(absPath, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

async function extractZipTo(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    const targetDir = path.resolve(destDir);
    const cmd = isWindows() ? 'powershell' : 'unzip';
    const args = isWindows()
      ? ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${targetDir.replace(/'/g, "''")}' -Force`]
      : ['-o', zipPath, '-d', targetDir];

    childProcess.execFile(cmd, args, { windowsHide: true, timeout: 60_000 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`Failed to extract zip: ${error.message}`));
        return;
      }
      resolve(targetDir);
    });
  });
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
  logger(`Found release ${release.releaseTag}`);

  const downloadPath = buildDownloadPath(copilotHome);
  const downloadDir = buildDownloadDir(copilotHome);
  const exe = binaryName();

  let downloadUrl = null;
  if (release.asset) {
    downloadUrl = normalizeString(release.asset.browser_download_url);
  }
  if (!downloadUrl) {
    const fallbacks = buildFallbackAssetUrls(release.version, release.releaseTag);
    downloadUrl = fallbacks[0];
  }

  if (!downloadUrl) {
    throw new Error(`No suitable elegy-planning binary found in release ${release.releaseTag}.`);
  }

  const isZip = downloadUrl.endsWith('.zip');

  if (isZip) {
    const zipPath = path.join(downloadDir, `${BINARY_NAME}.zip`);
    logger(`Downloading elegy-planning zip from: ${downloadUrl}`);
    await downloadToFile(fetchImpl, downloadUrl, zipPath);

    if (!fs.existsSync(zipPath)) {
      throw new Error(`Download completed but zip not found at ${zipPath}.`);
    }

    logger(`Extracting elegy-planning from zip...`);
    const extractDir = path.join(downloadDir, `extract-${Date.now()}`);
    await extractZipTo(zipPath, extractDir);

    const found = findBinaryInDir(extractDir, exe);
    if (!found) {
      throw new Error(`Binary ${exe} not found after zip extraction.`);
    }

    try {
      fs.copyFileSync(found, downloadPath);
    } catch {
      fs.renameSync(found, downloadPath);
    }

    safeRmSync(zipPath);
    safeRmSync(extractDir);
  } else {
    logger(`Downloading elegy-planning from: ${downloadUrl}`);
    await downloadToFile(fetchImpl, downloadUrl, downloadPath);
  }

  if (!fs.existsSync(downloadPath)) {
    throw new Error(`Download completed but binary not found at ${downloadPath}.`);
  }

  if (!isWindows()) {
    try {
      fs.chmodSync(downloadPath, 0o755);
    } catch {
      // best-effort
    }
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
  buildDownloadDir,
  buildTargetTriple,
  extractZipTo,
  binaryName,
  commandExistsOnPath,
  isPathLikeCommand,
};
