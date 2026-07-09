'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');

const DEFAULT_REPOSITORY = 'Sofreshx/Elegy';
const DEFAULT_RELEASE_TAG = 'main-snapshot';
const DEFAULT_MARKETPLACE_NAME = 'elegy';
const DEFAULT_PLUGIN_NAMES = Object.freeze([
  'elegy-planning',
  'elegy-skills',
  'elegy-obsidian',
  'elegy-opencode-workers',
]);
const INSTALL_METADATA_NAME = 'elegy-codex-marketplace.install.json';

function resolveTargetTriple(options = {}) {
  const platform = options.platform || process.platform;
  const arch = options.arch || process.arch;
  if (platform === 'win32' && arch === 'x64') return 'x86_64-pc-windows-msvc';
  if (platform === 'linux' && arch === 'x64') return 'x86_64-unknown-linux-gnu';
  if (platform === 'darwin' && arch === 'arm64') return 'aarch64-apple-darwin';
  throw new Error(`Unsupported Elegy Codex marketplace target: ${platform}/${arch}`);
}

function marketplaceArchiveName(target) {
  return `elegy-codex-marketplace-${target}.zip`;
}

function resolveCodexHome(options = {}) {
  return path.resolve(options.codexHome || options.env?.CODEX_HOME || process.env.CODEX_HOME || path.join(os.homedir(), '.codex'));
}

function resolveMarketplaceRoot(options = {}) {
  return path.join(resolveCodexHome(options), 'marketplaces', DEFAULT_MARKETPLACE_NAME);
}

function releaseAssetUrl(options = {}, fileName) {
  const repository = options.repository || options.env?.ELEGY_RELEASE_REPOSITORY || DEFAULT_REPOSITORY;
  const releaseTag = options.releaseTag || options.env?.ELEGY_RELEASE_TAG || DEFAULT_RELEASE_TAG;
  return `https://github.com/${repository}/releases/download/${encodeURIComponent(releaseTag)}/${fileName}`;
}

function parseSha256(text) {
  const match = String(text || '').match(/[a-fA-F0-9]{64}/);
  return match ? match[0].toLowerCase() : null;
}

function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function downloadBuffer(url, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('Fetch is unavailable; cannot download Elegy Codex marketplace assets.');
  }
  const response = await fetchImpl(url);
  if (!response || response.ok !== true) {
    throw new Error(`Download failed: HTTP ${response?.status || 'unknown'} ${url}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function downloadText(url, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('Fetch is unavailable; cannot download Elegy Codex marketplace checksums.');
  }
  const response = await fetchImpl(url);
  if (!response || response.ok !== true) {
    throw new Error(`Checksum download failed: HTTP ${response?.status || 'unknown'} ${url}`);
  }
  return response.text();
}

function runCommand(command, args, options = {}) {
  const spawnSyncImpl = options.spawnSyncImpl || options.childProcess?.spawnSync || childProcess.spawnSync;
  const result = spawnSyncImpl(command, args, {
    cwd: options.cwd || process.cwd(),
    env: { ...process.env, ...(options.env || {}) },
    encoding: 'utf8',
    timeout: options.timeoutMs || 120_000,
    windowsHide: true,
  });
  return {
    command,
    args,
    status: result?.status ?? null,
    stdout: String(result?.stdout || ''),
    stderr: String(result?.stderr || result?.error?.message || ''),
    ok: result?.status === 0,
  };
}

function parseJsonOutput(stdout) {
  const text = String(stdout || '').trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const first = text.indexOf('{');
    const last = text.lastIndexOf('}');
    if (first >= 0 && last > first) {
      try {
        return JSON.parse(text.slice(first, last + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function runCodex(args, options = {}) {
  const command = options.codexCommand || options.env?.CODEX_COMMAND || process.env.CODEX_COMMAND || 'codex';
  const result = runCommand(command, args, options);
  return {
    ...result,
    json: parseJsonOutput(result.stdout),
  };
}

function extractZipWithShell(archivePath, destination, options = {}) {
  fs.mkdirSync(destination, { recursive: true });
  const tar = runCommand('tar', ['-xf', archivePath, '-C', destination], options);
  if (tar.ok) return;

  if (process.platform === 'win32') {
    const powershell = runCommand('powershell', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      'Expand-Archive -LiteralPath $args[0] -DestinationPath $args[1] -Force',
      archivePath,
      destination,
    ], options);
    if (powershell.ok) return;
    throw new Error(`Unable to extract ${archivePath}: ${powershell.stderr || tar.stderr}`);
  }

  const unzip = runCommand('unzip', ['-q', archivePath, '-d', destination], options);
  if (unzip.ok) return;
  throw new Error(`Unable to extract ${archivePath}: ${unzip.stderr || tar.stderr}`);
}

function replaceDirectory(staging, destination) {
  const parent = path.dirname(destination);
  fs.mkdirSync(parent, { recursive: true });
  const backup = `${destination}.previous-${Date.now()}`;
  if (fs.existsSync(backup)) fs.rmSync(backup, { recursive: true, force: true });
  if (fs.existsSync(destination)) fs.renameSync(destination, backup);
  try {
    fs.renameSync(staging, destination);
    if (fs.existsSync(backup)) fs.rmSync(backup, { recursive: true, force: true });
  } catch (error) {
    if (!fs.existsSync(destination) && fs.existsSync(backup)) {
      fs.renameSync(backup, destination);
    }
    throw error;
  }
}

function readJson(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeInstallMetadata(marketplaceRoot, metadata) {
  const filePath = path.join(marketplaceRoot, INSTALL_METADATA_NAME);
  fs.writeFileSync(filePath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
  return filePath;
}

function readMarketplacePlugins(marketplaceRoot) {
  const marketplace = readJson(path.join(marketplaceRoot, '.agents', 'plugins', 'marketplace.json'), null);
  const plugins = Array.isArray(marketplace?.plugins) ? marketplace.plugins : [];
  return plugins.map((plugin) => ({
    name: String(plugin.name || '').trim(),
    category: plugin.category || null,
    sourcePath: plugin.source?.path || null,
  })).filter((plugin) => plugin.name);
}

function flattenPluginList(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  for (const key of ['plugins', 'available', 'installed', 'items']) {
    if (Array.isArray(value[key])) return value[key];
  }
  return [];
}

function pluginRecordName(record) {
  return String(record?.name || record?.plugin || record?.id || '').split('@')[0].trim();
}

function pluginRecordVersion(record) {
  return typeof record?.version === 'string' ? record.version : null;
}

function normalizePluginRecords(value) {
  return flattenPluginList(value)
    .map((record) => ({
      raw: record,
      name: pluginRecordName(record),
      version: pluginRecordVersion(record),
      installed: record?.installed === true || record?.enabled === true || record?.status === 'installed',
      enabled: record?.enabled === true || record?.status === 'enabled',
    }))
    .filter((record) => record.name);
}

function buildPluginStatus({ marketplaceRoot, pluginNames = DEFAULT_PLUGIN_NAMES, installedJson = null, availableJson = null, codexError = null }) {
  const metadata = readJson(path.join(marketplaceRoot, INSTALL_METADATA_NAME), null);
  const marketplacePlugins = readMarketplacePlugins(marketplaceRoot);
  const marketplaceByName = new Map(marketplacePlugins.map((plugin) => [plugin.name, plugin]));
  const installedByName = new Map(normalizePluginRecords(installedJson).map((record) => [record.name, record]));
  const availableByName = new Map(normalizePluginRecords(availableJson).map((record) => [record.name, record]));

  const names = pluginNames && pluginNames.length ? pluginNames : DEFAULT_PLUGIN_NAMES;
  const records = names.map((name) => {
    const marketplacePlugin = marketplaceByName.get(name);
    const installed = installedByName.get(name);
    const available = availableByName.get(name);
    const manifest = readJson(path.join(marketplaceRoot, 'plugins', name, '.codex-plugin', 'plugin.json'), null);
    const marketplaceVersion = typeof manifest?.version === 'string' ? manifest.version : available?.version || null;
    const installedVersion = installed?.version || null;
    let status = 'notInstalled';
    if (!marketplacePlugin) {
      status = fs.existsSync(marketplaceRoot) ? 'missingArtifact' : 'notInstalled';
    } else if (codexError) {
      status = 'unknown';
    } else if (installed) {
      status = marketplaceVersion && installedVersion && marketplaceVersion !== installedVersion ? 'stale' : 'current';
    }
    return {
      plugin: name,
      marketplace: DEFAULT_MARKETPLACE_NAME,
      target: metadata?.target || null,
      marketplaceVersion,
      installedVersion,
      status,
      installed: status === 'current' || status === 'stale',
      enabled: installed?.enabled === true || installed?.installed === true,
      available: Boolean(marketplacePlugin || available),
      installDir: path.join(marketplaceRoot, 'plugins', name),
      recommendedCommand: `codex plugin add ${name}@${DEFAULT_MARKETPLACE_NAME} --json`,
      error: codexError || null,
    };
  });
  const statusPriority = [
    'checksumUnavailable',
    'identityMismatch',
    'unsupportedTarget',
    'missingArtifact',
    'stale',
    'unknown',
    'notInstalled',
  ];
  const aggregateStatus = records.every((record) => record.status === 'current')
    ? 'current'
    : statusPriority.find((status) => records.some((record) => record.status === status)) || 'unknown';
  const repairableStatuses = new Set(['notInstalled', 'stale', 'missingArtifact', 'unknown']);
  const integrityStatuses = new Set(['missingArtifact', 'checksumUnavailable', 'identityMismatch', 'unsupportedTarget']);
  const integrityError = records.find((record) => integrityStatuses.has(record.status));

  return {
    marketplaceName: DEFAULT_MARKETPLACE_NAME,
    marketplaceRoot,
    target: metadata?.target || null,
    releaseTag: metadata?.releaseTag || null,
    archiveSha256: metadata?.archiveSha256 || null,
    installedAt: metadata?.installedAt || null,
    status: aggregateStatus,
    updateAvailable: records.some((record) => repairableStatuses.has(record.status)),
    canUpdate: true,
    plugins: records,
    lastError: codexError || (integrityError ? `${integrityError.plugin} is missing from the Elegy Codex marketplace projection.` : null),
  };
}

async function getElegyPluginMarketplaceStatus(options = {}) {
  const marketplaceRoot = resolveMarketplaceRoot(options);
  const pluginNames = options.pluginNames || DEFAULT_PLUGIN_NAMES;
  let installedJson = null;
  let availableJson = null;
  let codexError = null;
  if (fs.existsSync(path.join(marketplaceRoot, '.agents', 'plugins', 'marketplace.json'))) {
    const installed = runCodex(['plugin', 'list', '--marketplace', DEFAULT_MARKETPLACE_NAME, '--json'], options);
    if (installed.ok) {
      installedJson = installed.json;
    } else {
      codexError = installed.stderr || installed.stdout || 'Unable to list installed Codex plugins.';
    }
    const available = runCodex(['plugin', 'list', '--marketplace', DEFAULT_MARKETPLACE_NAME, '--available', '--json'], options);
    if (available.ok) {
      availableJson = available.json;
    }
  }
  return buildPluginStatus({ marketplaceRoot, pluginNames, installedJson, availableJson, codexError });
}

async function installElegyCodexPlugins(options = {}) {
  const target = options.target || resolveTargetTriple(options);
  const archiveName = marketplaceArchiveName(target);
  const archiveUrl = options.archiveUrl || releaseAssetUrl(options, archiveName);
  const checksumUrl = options.checksumUrl || `${archiveUrl}.sha256`;
  const archiveBuffer = options.archiveBuffer || await downloadBuffer(archiveUrl, options);
  const checksumText = options.checksumText || await downloadText(checksumUrl, options);
  const expectedSha256 = parseSha256(checksumText);
  if (!expectedSha256) {
    throw new Error(`Checksum did not contain a SHA-256 digest: ${checksumUrl}`);
  }
  const actualSha256 = sha256Buffer(archiveBuffer);
  if (actualSha256 !== expectedSha256) {
    throw new Error(`Checksum mismatch for ${archiveName}: expected ${expectedSha256}, got ${actualSha256}`);
  }

  const marketplaceRoot = resolveMarketplaceRoot(options);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'elegy-codex-marketplace-'));
  const archivePath = path.join(tempRoot, archiveName);
  const staging = path.join(tempRoot, 'staging');
  fs.writeFileSync(archivePath, archiveBuffer);
  const extractZip = options.extractZip || extractZipWithShell;
  extractZip(archivePath, staging, options);
  if (!fs.existsSync(path.join(staging, '.agents', 'plugins', 'marketplace.json'))) {
    throw new Error('Elegy Codex marketplace archive is missing .agents/plugins/marketplace.json.');
  }

  replaceDirectory(staging, marketplaceRoot);
  const releaseTag = options.releaseTag || options.env?.ELEGY_RELEASE_TAG || DEFAULT_RELEASE_TAG;
  const metadata = {
    schemaVersion: 'elegy-codex-marketplace-install/v1',
    marketplaceName: DEFAULT_MARKETPLACE_NAME,
    releaseTag,
    target,
    archiveUrl,
    checksumUrl,
    archiveSha256: actualSha256,
    installedAt: new Date().toISOString(),
  };
  const metadataPath = writeInstallMetadata(marketplaceRoot, metadata);

  const marketplaceAdd = runCodex(['plugin', 'marketplace', 'add', marketplaceRoot, '--json'], options);
  if (!marketplaceAdd.ok) {
    throw new Error(`Codex marketplace add failed: ${marketplaceAdd.stderr || marketplaceAdd.stdout}`);
  }

  const pluginNames = options.pluginNames || DEFAULT_PLUGIN_NAMES;
  const installs = [];
  for (const pluginName of pluginNames) {
    const install = runCodex(['plugin', 'add', `${pluginName}@${DEFAULT_MARKETPLACE_NAME}`, '--json'], options);
    installs.push({ plugin: pluginName, ...install });
    if (!install.ok) {
      throw new Error(`Codex plugin add failed for ${pluginName}: ${install.stderr || install.stdout}`);
    }
  }

  const available = runCodex(['plugin', 'list', '--marketplace', DEFAULT_MARKETPLACE_NAME, '--available', '--json'], options);
  const installed = runCodex(['plugin', 'list', '--marketplace', DEFAULT_MARKETPLACE_NAME, '--json'], options);
  return {
    ok: true,
    marketplaceName: DEFAULT_MARKETPLACE_NAME,
    marketplaceRoot,
    target,
    archiveSha256: actualSha256,
    metadataPath,
    marketplaceAdd,
    installs,
    available: available.json,
    installed: installed.json,
    status: buildPluginStatus({
      marketplaceRoot,
      pluginNames,
      installedJson: installed.json,
      availableJson: available.json,
      codexError: installed.ok ? null : (installed.stderr || installed.stdout),
    }),
  };
}

function windowsPluginBinaryName(pluginName, options = {}) {
  const platform = options.platform || process.platform;
  if (platform === 'win32') return `${pluginName}.exe`;
  return pluginName;
}

module.exports = {
  DEFAULT_MARKETPLACE_NAME,
  DEFAULT_PLUGIN_NAMES,
  DEFAULT_RELEASE_TAG,
  INSTALL_METADATA_NAME,
  buildPluginStatus,
  getElegyPluginMarketplaceStatus,
  installElegyCodexPlugins,
  marketplaceArchiveName,
  parseSha256,
  releaseAssetUrl,
  resolveCodexHome,
  resolveMarketplaceRoot,
  resolveTargetTriple,
  sha256Buffer,
  windowsPluginBinaryName,
};
