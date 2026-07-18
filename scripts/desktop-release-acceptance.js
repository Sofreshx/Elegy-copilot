'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function normalizeString(value) {
  return String(value || '').trim();
}

function parseJsonAsset(assetContents, name) {
  const raw = assetContents[name];
  assert(raw !== undefined, `Published release is missing ${name}.`);
  try {
    return JSON.parse(Buffer.from(raw).toString('utf8'));
  } catch (error) {
    throw new Error(`${name} is not valid JSON: ${error.message}`);
  }
}

function getAssetNames(release) {
  const assets = Array.isArray(release && release.assets) ? release.assets : [];
  const names = assets.map((asset) => normalizeString(asset && asset.name)).filter(Boolean);
  assert(names.length > 0, 'Published desktop release has no assets.');
  const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
  assert(duplicates.length === 0, `Published desktop release contains duplicate asset names: ${[...new Set(duplicates)].join(', ')}.`);
  return names;
}

function decodeUrlAssetName(value) {
  const parsed = new URL(value);
  const pathSegments = parsed.pathname.split('/').filter(Boolean);
  assert(pathSegments.length > 0, 'Updater feed URL has no downloadable asset path.');
  return decodeURIComponent(pathSegments[pathSegments.length - 1]);
}

function resolveDownloadTag(value) {
  const parsed = new URL(value);
  const pathSegments = parsed.pathname.split('/').filter(Boolean);
  const downloadIndex = pathSegments.indexOf('download');
  assert(downloadIndex >= 0 && pathSegments[downloadIndex + 1], 'Updater feed URL is not a GitHub release download URL.');
  return decodeURIComponent(pathSegments[downloadIndex + 1]);
}

function validatePublishedDesktopRelease({
  release,
  assetContents,
  expectedVersion,
  expectedTag,
  expectedFeedTag = expectedTag,
  expectedPrerelease = false,
}) {
  assert(release && typeof release === 'object', 'Published desktop release metadata is required.');
  assert(normalizeString(release.tag_name) === expectedTag, `Expected GitHub release tag ${expectedTag}, received ${release.tag_name || '(missing)'}.`);
  assert(release.draft !== true, `GitHub release ${expectedTag} is still a draft.`);
  assert(release.prerelease === expectedPrerelease, `GitHub release ${expectedTag} prerelease flag drifted from ${expectedPrerelease}.`);

  const assetNames = getAssetNames(release);
  const manifest = parseJsonAsset(assetContents, 'release-manifest.json');
  const installerName = normalizeString(manifest.artifact && manifest.artifact.relativePath);
  const signatureName = normalizeString(manifest.updateLane && manifest.updateLane.updaterSignatureRelativePath);
  const feedName = normalizeString(manifest.updateLane && manifest.updateLane.updaterFeedRelativePath);
  assert(installerName, 'release-manifest.json is missing artifact.relativePath.');
  assert(signatureName, 'release-manifest.json is missing updateLane.updaterSignatureRelativePath.');
  assert(feedName, 'release-manifest.json is missing updateLane.updaterFeedRelativePath.');
  assert(assetNames.includes(installerName), `Published release is missing the installer named by release-manifest.json: ${installerName}.`);
  assert(assetNames.includes(signatureName), `Published release is missing the installer signature named by release-manifest.json: ${signatureName}.`);
  assert(assetNames.includes(feedName), `Published release is missing the updater feed named by release-manifest.json: ${feedName}.`);
  assert(assetNames.includes('windows-installation-guide.md'), 'Published release is missing windows-installation-guide.md.');
  assert(normalizeString(manifest.version) === expectedVersion, `release-manifest.json version drifted from ${expectedVersion}.`);

  const installer = assetContents[installerName];
  assert(installer !== undefined, `Downloaded release asset is missing the installer: ${installerName}.`);
  const installerHash = crypto.createHash('sha256').update(installer).digest('hex');
  assert(normalizeString(manifest.artifact && manifest.artifact.sha256) === installerHash, 'release-manifest.json installer SHA256 does not match the downloaded installer.');

  const signature = normalizeString(Buffer.from(assetContents[signatureName]).toString('utf8'));
  assert(signature, `Downloaded installer signature is empty: ${signatureName}.`);
  const feed = parseJsonAsset(assetContents, feedName);
  assert(normalizeString(feed.version) === expectedVersion, `${feedName} version drifted from ${expectedVersion}.`);
  const windowsPlatform = feed.platforms && feed.platforms['windows-x86_64'];
  assert(windowsPlatform && typeof windowsPlatform === 'object', `${feedName} is missing platforms.windows-x86_64.`);
  assert(normalizeString(windowsPlatform.signature) === signature, `${feedName} signature does not match ${signatureName}.`);
  assert(decodeUrlAssetName(windowsPlatform.url) === installerName, `${feedName} updater feed URL does not resolve to the published installer.`);
  assert(resolveDownloadTag(windowsPlatform.url) === expectedFeedTag, `${feedName} updater feed URL targets ${resolveDownloadTag(windowsPlatform.url)} instead of ${expectedFeedTag}.`);

  return {
    releaseTag: expectedTag,
    version: expectedVersion,
    installerName,
    assetCount: assetNames.length,
  };
}

async function fetchReleaseAsset(asset, fetchImpl) {
  const response = await fetchImpl(asset.browser_download_url, {
    headers: { Accept: 'application/octet-stream' },
    redirect: 'follow',
  });
  assert(response.ok, `Could not download release asset ${asset.name}: HTTP ${response.status}.`);
  return Buffer.from(await response.arrayBuffer());
}

async function validateGitHubDesktopRelease({ repo, tag, expectedVersion, expectedFeedTag = tag, expectedPrerelease = false, fetchImpl = global.fetch, githubToken = '' }) {
  assert(typeof fetchImpl === 'function', 'Global fetch is unavailable; GitHub release acceptance cannot run.');
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'elegy-copilot-desktop-release-acceptance',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (githubToken) headers.Authorization = `Bearer ${githubToken}`;
  const releaseResponse = await fetchImpl(`https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`, { headers });
  assert(releaseResponse.ok, `Could not load GitHub release ${repo}@${tag}: HTTP ${releaseResponse.status}.`);
  const release = await releaseResponse.json();
  const assetContents = {};
  for (const asset of release.assets || []) {
    assetContents[asset.name] = await fetchReleaseAsset(asset, fetchImpl);
  }
  return validatePublishedDesktopRelease({
    release,
    assetContents,
    expectedVersion,
    expectedTag: tag,
    expectedFeedTag,
    expectedPrerelease,
  });
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--repo') options.repo = args[++index];
    else if (arg === '--tag') options.tag = args[++index];
    else if (arg === '--expected-version') options.expectedVersion = args[++index];
    else if (arg === '--feed-tag') options.expectedFeedTag = args[++index];
    else if (arg === '--prerelease') options.expectedPrerelease = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

async function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  if (options.help) {
    console.log('Usage: node scripts/desktop-release-acceptance.js --repo owner/repo --tag desktop-v1.2.3 --expected-version 1.2.3 [--feed-tag desktop-v1.2.3] [--prerelease]');
    return;
  }
  const repoRoot = path.resolve(__dirname, '..');
  const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'copilot-ui', 'package.json'), 'utf8'));
  const tag = normalizeString(options.tag);
  const expectedVersion = normalizeString(options.expectedVersion) || packageJson.version;
  const repo = normalizeString(options.repo) || normalizeString(packageJson.desktopRelease && packageJson.desktopRelease.publishRepository);
  assert(repo && tag, 'GitHub release acceptance requires --repo and --tag (or a configured repository for --repo).');
  const result = await validateGitHubDesktopRelease({
    repo,
    tag,
    expectedVersion,
    expectedFeedTag: options.expectedFeedTag || tag,
    expectedPrerelease: options.expectedPrerelease === true,
    githubToken: normalizeString(process.env.GH_TOKEN || process.env.GITHUB_TOKEN),
  });
  console.log(`[desktop-release-acceptance] passed ${result.releaseTag}; version=${result.version}; installer=${result.installerName}; assets=${result.assetCount}.`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[desktop-release-acceptance] ${error.message || error}`);
    process.exit(1);
  });
}

module.exports = {
  validateGitHubDesktopRelease,
  validatePublishedDesktopRelease,
};
