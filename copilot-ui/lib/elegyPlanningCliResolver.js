'use strict';

const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const GITHUB_REPO = 'Sofreshx/Elegy';
const GITHUB_RELEASE_TAG = 'main-snapshot';
const GITHUB_REPO_URL = `https://github.com/${GITHUB_REPO}.git`;
const BINARY_NAME = 'elegy-planning';
const INSTALL_METADATA_NAME = 'elegy-planning.install.json';
const ELEGY_ASSETS_METADATA_NAME = 'elegy-assets.install.json';
const GITHUB_ELEGY_SKILL_ASSETS = [
  {
    id: 'elegy-planning',
    source: 'src/Elegy-planning/skills/elegy-planning',
    destination: 'skills/elegy-planning',
  },
  {
    id: 'elegy-skills',
    source: 'src/Elegy-skills/skills/elegy-skills',
    destination: 'skills/elegy-skills',
  },
  {
    id: 'elegy-obsidian',
    source: 'skills/elegy-obsidian',
    destination: 'skills/elegy-obsidian',
  },
];

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isWindows() {
  return process.platform === 'win32';
}

function binaryName() {
  return isWindows() ? 'elegy-planning.exe' : 'elegy-planning';
}

function isMsvcLinkerAvailable(spawnSyncImpl) {
  if (process.platform !== 'win32') {
    return true;
  }
  const spawn = typeof spawnSyncImpl === 'function' ? spawnSyncImpl : childProcess.spawnSync;
  try {
    const result = spawn('where', ['link.exe'], {
      windowsHide: true,
      stdio: 'pipe',
    });
    return Number(result && result.status) === 0;
  } catch {
    return false;
  }
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

function candidatePaths(runtimeRoot, elegyHome) {
  const exe = binaryName();
  const candidates = [];

  if (runtimeRoot) {
    candidates.push(
      path.join(runtimeRoot, 'elegy-planning', exe),
      path.join(runtimeRoot, 'elegy-planning', 'bin', exe),
      path.join(runtimeRoot, 'copilot-ui', 'resources', 'elegy-planning', exe),
    );
  }

  if (elegyHome) {
    candidates.push(
      path.join(elegyHome, 'managed-cli', 'planning', 'bin', exe),
      path.join(elegyHome, 'managed-cli', 'planning', exe),
      path.join(elegyHome, 'bin', exe),
      path.join(elegyHome, 'elegy-planning', exe),
    );
  }

  return candidates;
}

function findExistingBinary(runtimeRoot, elegyHome, existsSyncImpl) {
  const existsSyncFn = typeof existsSyncImpl === 'function' ? existsSyncImpl : fs.existsSync;
  for (const candidate of candidatePaths(runtimeRoot, elegyHome)) {
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

function buildDownloadDir(elegyHome) {
  return path.join(elegyHome, 'managed-cli', 'planning');
}

function buildDownloadPath(elegyHome) {
  return path.join(buildDownloadDir(elegyHome), binaryName());
}

function buildManagedSourceDir(elegyHome) {
  return path.join(buildDownloadDir(elegyHome), 'source', 'Elegy');
}

function buildInstallMetadataPath(elegyHome) {
  return path.join(buildDownloadDir(elegyHome), INSTALL_METADATA_NAME);
}

function buildElegyAssetsMetadataPath(targetHome) {
  return path.join(targetHome, ELEGY_ASSETS_METADATA_NAME);
}

function isElegyRustWorkspace(candidate) {
  const normalized = normalizeString(candidate);
  if (!normalized) {
    return false;
  }

  return fs.existsSync(path.join(normalized, 'rust', 'Cargo.toml'))
    && fs.existsSync(path.join(normalized, 'rust', 'crates', 'elegy-planning', 'Cargo.toml'));
}

async function syncGitHubElegySource(options = {}) {
  const elegyHome = normalizeString(options.elegyHome);
  if (!elegyHome) {
    throw new Error('elegyHome is required to sync Elegy source from GitHub.');
  }

  const sourceDir = normalizeString(options.sourceDir) || buildManagedSourceDir(elegyHome);
  const childProcessModule = options.childProcess || childProcess;
  const execFile = typeof childProcessModule.execFile === 'function'
    ? childProcessModule.execFile.bind(childProcessModule)
    : childProcess.execFile;
  const logger = typeof options.logger === 'function' ? options.logger : () => {};

  await fs.promises.mkdir(path.dirname(sourceDir), { recursive: true });

  const runGit = (args, cwd) => new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      {
        cwd,
        env: options.env,
        windowsHide: true,
        timeout: options.gitTimeoutMs || 180_000,
        maxBuffer: 1024 * 1024 * 8,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`git ${args.join(' ')} failed: ${error.message}\n${stderr || stdout || ''}`.trim()));
          return;
        }
        resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') });
      },
    );
  });

  if (fs.existsSync(path.join(sourceDir, '.git'))) {
    logger(`Refreshing Elegy source from GitHub: ${sourceDir}`);
    await runGit(['fetch', '--depth', '1', 'origin', 'main'], sourceDir);
    await runGit(['checkout', '--force', 'FETCH_HEAD'], sourceDir);
  } else {
    safeRmSync(sourceDir);
    logger(`Cloning Elegy source from GitHub: ${GITHUB_REPO_URL}`);
    await runGit(['clone', '--depth', '1', '--branch', 'main', GITHUB_REPO_URL, sourceDir], path.dirname(sourceDir));
  }

  if (!isElegyRustWorkspace(sourceDir)) {
    throw new Error(`GitHub Elegy checkout is missing the elegy-planning Rust workspace: ${sourceDir}`);
  }

  return sourceDir;
}

function resolveSourceBinaryPath(elegyRepoRoot, release = true) {
  const profile = release ? 'release' : 'debug';
  return path.join(elegyRepoRoot, 'rust', 'target', profile, binaryName());
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function readInstallMetadata(elegyHome) {
  return readJsonFile(buildInstallMetadataPath(elegyHome));
}

function readElegyAssetsMetadata(targetHome) {
  return readJsonFile(buildElegyAssetsMetadataPath(targetHome));
}

function writeInstallMetadata(elegyHome, metadata) {
  const metadataPath = buildInstallMetadataPath(elegyHome);
  fs.mkdirSync(path.dirname(metadataPath), { recursive: true });
  fs.writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
  return metadataPath;
}

function writeElegyAssetsMetadata(targetHome, metadata) {
  const metadataPath = buildElegyAssetsMetadataPath(targetHome);
  fs.mkdirSync(path.dirname(metadataPath), { recursive: true });
  fs.writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
  return metadataPath;
}

function resolveGitHead(repoRoot, options = {}) {
  const spawnSyncImpl = typeof options.spawnSyncImpl === 'function'
    ? options.spawnSyncImpl
    : childProcess.spawnSync;

  try {
    const result = spawnSyncImpl('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], {
      windowsHide: true,
      stdio: 'pipe',
      encoding: 'utf8',
      env: options.env,
    });
    if (Number(result && result.status) !== 0) {
      return null;
    }
    return normalizeString(result.stdout);
  } catch {
    return null;
  }
}

function copyBinaryToManagedPath(sourcePath, elegyHome) {
  const destinationPath = buildDownloadPath(elegyHome);
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  fs.copyFileSync(sourcePath, destinationPath);

  if (!isWindows()) {
    try {
      fs.chmodSync(destinationPath, 0o755);
    } catch {
      // best-effort
    }
  }

  return destinationPath;
}

function copyDirectorySync(sourceDir, destinationDir) {
  safeRmSync(destinationDir);
  fs.mkdirSync(path.dirname(destinationDir), { recursive: true });
  fs.cpSync(sourceDir, destinationDir, { recursive: true });
}

function resolveGitHubElegySkillAssets(sourceRoot) {
  return GITHUB_ELEGY_SKILL_ASSETS.map((asset) => ({
    ...asset,
    sourcePath: path.join(sourceRoot, ...asset.source.split('/')),
  }));
}

async function syncElegySkillAssetsFromGitHub(options = {}) {
  const targetHome = normalizeString(options.targetHome);
  if (!targetHome) {
    throw new Error('targetHome is required to sync Elegy skill assets from GitHub.');
  }

  const sourceRoot = await syncGitHubElegySource(options);
  const sourceGitHead = resolveGitHead(sourceRoot, {
    env: options.env,
    spawnSyncImpl: options.spawnSyncImpl || (options.childProcess && options.childProcess.spawnSync),
  });
  const logger = typeof options.logger === 'function' ? options.logger : () => {};
  const requestedIds = Array.isArray(options.assetIds) && options.assetIds.length > 0
    ? new Set(options.assetIds.map((id) => normalizeString(id)).filter(Boolean))
    : null;
  const assets = resolveGitHubElegySkillAssets(sourceRoot)
    .filter((asset) => !requestedIds || requestedIds.has(asset.id));
  const installed = [];

  for (const asset of assets) {
    if (!fs.existsSync(asset.sourcePath)) {
      throw new Error(`GitHub Elegy checkout is missing required skill asset ${asset.id}: ${asset.sourcePath}`);
    }
    const destinationPath = path.join(targetHome, ...asset.destination.split('/'));
    logger(`Installing Elegy skill asset ${asset.id} from GitHub source.`);
    copyDirectorySync(asset.sourcePath, destinationPath);
    installed.push({
      id: asset.id,
      source: asset.source,
      destination: asset.destination,
      sourcePath: asset.sourcePath,
      destinationPath,
      installed: true,
      upToDate: true,
    });
  }

  const metadata = {
    source: 'github-source',
    sourceRepoRoot: sourceRoot,
    sourceGitHead,
    sourceRemote: GITHUB_REPO_URL,
    installedAt: new Date().toISOString(),
    assets: installed.map((asset) => ({
      id: asset.id,
      source: asset.source,
      destination: asset.destination,
      destinationPath: asset.destinationPath,
    })),
  };
  writeElegyAssetsMetadata(targetHome, metadata);

  return {
    ok: true,
    source: 'github-source',
    sourceRepoRoot: sourceRoot,
    sourceGitHead,
    sourceRemote: GITHUB_REPO_URL,
    targetHome,
    installed,
  };
}

async function buildElegyPlanningCliFromSource(options = {}) {
  const elegyHome = normalizeString(options.elegyHome);
  if (!elegyHome) {
    throw new Error('elegyHome is required to install elegy-planning from source.');
  }

  const elegyRepoRoot = normalizeString(options.elegyRepoPath || options.sourceRoot);
  if (!elegyRepoRoot || !isElegyRustWorkspace(elegyRepoRoot)) {
    throw new Error('GitHub Elegy source checkout is required to build elegy-planning.');
  }

  const childProcessModule = options.childProcess || childProcess;
  const execFile = typeof childProcessModule.execFile === 'function'
    ? childProcessModule.execFile.bind(childProcessModule)
    : childProcess.execFile;
  const logger = typeof options.logger === 'function' ? options.logger : () => {};
  const release = options.release !== false;
  const rustRoot = path.join(elegyRepoRoot, 'rust');
  const args = ['build', '-p', 'elegy-planning', '--bin', 'elegy-planning'];
  if (release) {
    args.push('--release');
  }

  logger(`Building elegy-planning from source: ${elegyRepoRoot}`);

  await new Promise((resolve, reject) => {
    execFile(
      'cargo',
      args,
      {
        cwd: rustRoot,
        env: options.env,
        windowsHide: true,
        timeout: options.timeoutMs || 300_000,
        maxBuffer: 1024 * 1024 * 8,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`cargo ${args.join(' ')} failed: ${error.message}\n${stderr || stdout || ''}`.trim()));
          return;
        }
        resolve();
      },
    );
  });

  const sourceBinary = resolveSourceBinaryPath(elegyRepoRoot, release);
  if (!fs.existsSync(sourceBinary)) {
    throw new Error(`cargo build completed but binary was not found at ${sourceBinary}.`);
  }

  const installedPath = copyBinaryToManagedPath(sourceBinary, elegyHome);
  const sourceGitHead = resolveGitHead(elegyRepoRoot, {
    env: options.env,
    spawnSyncImpl: options.spawnSyncImpl || childProcessModule.spawnSync,
  });
  const metadata = {
    source: options.sourceKind || 'github-source',
    sourceRepoRoot: elegyRepoRoot,
    sourceGitHead,
    sourceRemote: options.sourceRemote || null,
    installedPath,
    installedAt: new Date().toISOString(),
    binarySha256: hashFileSha256Sync(installedPath),
  };
  writeInstallMetadata(elegyHome, metadata);
  logger(`elegy-planning installed to: ${installedPath}`);

  return {
    installedPath,
    metadata,
  };
}

function buildGitHubReleaseUrl() {
  // Use /releases/tags/{tag} for named tags; /releases/latest is a special GitHub API endpoint
  const tag = GITHUB_RELEASE_TAG === 'latest' ? 'latest' : `tags/${GITHUB_RELEASE_TAG}`;
  return `https://api.github.com/repos/${GITHUB_REPO}/releases/${tag}`;
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
      'User-Agent': 'elegy-copilot',
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
    headers: { 'User-Agent': 'elegy-copilot' },
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
  const elegyHome = normalizeString(options.elegyHome);
  if (!elegyHome) {
    throw new Error('elegyHome is required to download elegy-planning.');
  }

  const fetchImpl = options.fetchImpl;
  const logger = typeof options.logger === 'function' ? options.logger : () => {};

  logger('Querying GitHub for latest elegy-planning release...');
  const release = await fetchLatestReleaseInfo(fetchImpl);
  logger(`Found release ${release.releaseTag}`);

  const downloadPath = buildDownloadPath(elegyHome);
  const downloadDir = buildDownloadDir(elegyHome);
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
  writeInstallMetadata(elegyHome, {
    source: 'github-release',
    releaseVersion: release.version,
    releaseTag: release.releaseTag,
    installedPath: downloadPath,
    installedAt: new Date().toISOString(),
    binarySha256: hashFileSha256Sync(downloadPath),
  });
  return downloadPath;
}

async function installLatestElegyPlanningCli(options = {}) {
  const spawnSyncImpl = options.spawnSyncImpl
    || (options.childProcess && options.childProcess.spawnSync);

  if (!isMsvcLinkerAvailable(spawnSyncImpl)) {
    const logger = typeof options.logger === 'function' ? options.logger : () => {};
    logger('MSVC linker not available, skipping source build and downloading prebuilt binary...');
    const downloadPath = await downloadElegyPlanningCli(options);
    return {
      installedPath: downloadPath,
      metadata: readInstallMetadata(options.elegyHome),
    };
  }

  const sourceDir = await syncGitHubElegySource(options);
  return buildElegyPlanningCliFromSource({
    ...options,
    elegyRepoPath: sourceDir,
    sourceKind: 'github-source',
    sourceRemote: GITHUB_REPO_URL,
  });
}

function resolveElegyPlanningCliPath(options = {}) {
  const explicitCliPath = normalizeString(options.cliPath);
  const runtimeRoot = normalizeString(options.runtimeRoot);
  const elegyHome = normalizeString(options.elegyHome);
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

  const found = findExistingBinary(runtimeRoot, elegyHome, existsSyncFn);
  if (found) {
    return found;
  }

  const downloadedPath = buildDownloadPath(elegyHome);
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
  installLatestElegyPlanningCli,
  buildElegyPlanningCliFromSource,
  fetchLatestReleaseInfo,
  findExistingBinary,
  candidatePaths,
  buildDownloadPath,
  buildDownloadDir,
  buildManagedSourceDir,
  buildInstallMetadataPath,
  buildElegyAssetsMetadataPath,
  syncGitHubElegySource,
  syncElegySkillAssetsFromGitHub,
  readInstallMetadata,
  readElegyAssetsMetadata,
  resolveGitHead,
  GITHUB_ELEGY_SKILL_ASSETS,
  buildTargetTriple,
  extractZipTo,
  binaryName,
  commandExistsOnPath,
  isPathLikeCommand,
  isMsvcLinkerAvailable,
};
