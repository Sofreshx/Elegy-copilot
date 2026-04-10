'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DESKTOP_PACKAGE_PATH = 'copilot-ui/package.json';
const DEFAULT_RELEASE_API_BASE_URL = 'https://api.github.com';
const DEFAULT_ASSET_VISIBILITY_ATTEMPTS = 4;
const DEFAULT_ASSET_VISIBILITY_DELAY_MS = 1500;

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function parseInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseDesktopTagInfo(tagName) {
  const normalizedTag = normalizeString(tagName);
  const match = /^desktop-v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(normalizedTag);
  if (!match) {
    return null;
  }

  const version = match[1];
  return {
    tagName: normalizedTag,
    version,
    previewTag: version,
    isStable: !version.includes('-'),
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
    fullName: normalized,
  };
}

function runCommand(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  }).trim();
}

function runCommandOptional(command, args, options = {}) {
  try {
    return {
      ok: true,
      output: runCommand(command, args, options),
    };
  } catch (error) {
    return {
      ok: false,
      output: normalizeString((error.stderr || error.message || '').toString()),
    };
  }
}

function loadDesktopPackageJson(repoRoot) {
  const packageJsonPath = path.join(repoRoot, DESKTOP_PACKAGE_PATH);
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const publishRepository = parsePublishRepository(packageJson.desktopRelease && packageJson.desktopRelease.publishRepository);
  if (!publishRepository) {
    throw new Error(
      `Missing or invalid desktopRelease.publishRepository in ${DESKTOP_PACKAGE_PATH}; expected owner/repo.`,
    );
  }

  const version = normalizeString(packageJson.version);
  if (!version) {
    throw new Error(`Missing version in ${DESKTOP_PACKAGE_PATH}.`);
  }

  return {
    version,
    publishRepository,
  };
}

function resolveGitCommit(ref, options = {}) {
  const gitRunner = options.gitRunner || runCommandOptional;
  const result = gitRunner('git', ['rev-parse', '--verify', `${ref}^{commit}`], options.commandOptions || {});
  return result.ok ? normalizeString(result.output) : '';
}

function resolveGitHubAuthToken(options = {}) {
  const explicitToken = normalizeString(options.githubToken);
  if (explicitToken) {
    return explicitToken;
  }

  const env = options.env || process.env;
  const envToken = normalizeString(env.GH_TOKEN || env.GITHUB_TOKEN);
  if (envToken) {
    return envToken;
  }

  const commandRunner = options.commandRunner || runCommandOptional;
  const ghToken = commandRunner('gh', ['auth', 'token'], options.commandOptions || {});
  if (ghToken.ok && normalizeString(ghToken.output)) {
    return normalizeString(ghToken.output);
  }

  throw new Error(
    'Stable desktop promotion preflight could not authenticate GitHub metadata checks. '
    + 'Set GH_TOKEN or GITHUB_TOKEN, or authenticate the GitHub CLI so `gh auth token` succeeds.',
  );
}

function getMissingPreviewReleaseAssets(release) {
  const assets = Array.isArray(release && release.assets) ? release.assets : [];
  const assetNames = assets.map((asset) => normalizeString(asset && asset.name)).filter(Boolean);
  const hasManifest = assetNames.includes('release-manifest.json');
  const hasInstallationGuide = assetNames.includes('windows-installation-guide.md');
  const hasInstaller = assetNames.some((name) => name.toLowerCase().endsWith('.exe'));
  const missing = [];

  if (!hasManifest) {
    missing.push('release-manifest.json');
  }
  if (!hasInstaller) {
    missing.push('*.exe installer');
  }
  if (!hasInstallationGuide) {
    missing.push('windows-installation-guide.md');
  }

  return missing;
}

async function fetchPreviewReleaseByTag(options) {
  const fetchImpl = options.fetchImpl || global.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('Global fetch is unavailable; stable desktop promotion preflight cannot query GitHub releases.');
  }

  const response = await fetchImpl(options.url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${options.githubToken}`,
      'Cache-Control': 'no-store',
      'User-Agent': 'elegy-copilot-desktop-stable-preflight',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`GitHub preview release check failed with HTTP ${response.status}.`);
  }

  return response.json();
}

async function waitForDelay(waitImpl, delayMs) {
  if (delayMs <= 0) {
    return;
  }
  await waitImpl(delayMs);
}

async function loadPublishedPreviewRelease(options) {
  const waitImpl = options.wait || ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));
  const maxAttempts = parseInteger(options.assetVisibilityAttempts, DEFAULT_ASSET_VISIBILITY_ATTEMPTS);
  const baseDelayMs = parseInteger(options.assetVisibilityDelayMs, DEFAULT_ASSET_VISIBILITY_DELAY_MS);
  const logger = typeof options.logger === 'function' ? options.logger : () => {};

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const release = await fetchPreviewReleaseByTag(options);
    if (!release) {
      throw new Error(
        `Stable desktop promotion requires a matching preview GitHub release for tag '${options.previewTag}' in ${options.publishRepository.fullName}.`,
      );
    }

    if (release.draft === true) {
      throw new Error(
        `Stable desktop promotion requires preview release '${options.previewTag}' to be published; it is still a draft.`,
      );
    }

    if (release.prerelease !== true) {
      throw new Error(
        `Stable desktop promotion requires preview release '${options.previewTag}' to remain prerelease=true.`,
      );
    }

    const missingAssets = getMissingPreviewReleaseAssets(release);
    if (missingAssets.length === 0) {
      return {
        attempts: attempt,
        release,
      };
    }

    if (attempt === maxAttempts) {
      throw new Error(
        `Stable desktop promotion requires preview release '${options.previewTag}' to publish release-manifest.json, a .exe installer, and windows-installation-guide.md; missing ${missingAssets.join(', ')}.`,
      );
    }

    const delayMs = baseDelayMs * attempt;
    logger(
      `[desktop-stable-preflight] preview release '${options.previewTag}' is visible but still missing ${missingAssets.join(', ')}; retrying in ${delayMs}ms (${attempt}/${maxAttempts}).`,
    );
    await waitForDelay(waitImpl, delayMs);
  }

  throw new Error(`Stable desktop promotion preflight exhausted retries for preview release '${options.previewTag}'.`);
}

async function verifyStableDesktopPromotionPreflight(options = {}) {
  const repoRoot = path.resolve(
    normalizeString(options.repoRoot)
      || runCommand('git', ['rev-parse', '--show-toplevel'], options.commandOptions || {}),
  );
  const packageMetadata = loadDesktopPackageJson(repoRoot);
  const desktopTagInfo = parseDesktopTagInfo(options.desktopTag || `desktop-v${packageMetadata.version}`);

  if (!desktopTagInfo) {
    throw new Error('Stable desktop promotion preflight requires a desktop tag shaped like desktop-vx.y.z or desktop-vx.y.z-suffix.');
  }

  if (!desktopTagInfo.isStable) {
    return {
      status: 'skipped',
      reason: 'desktop_prerelease_tag',
      desktopTag: desktopTagInfo.tagName,
      previewTag: desktopTagInfo.previewTag,
      message: `Skipping stable desktop promotion preflight for prerelease desktop tag '${desktopTagInfo.tagName}'.`,
    };
  }

  const commandOptions = {
    cwd: repoRoot,
  };
  const gitRunner = options.gitRunner || runCommandOptional;
  gitRunner('git', ['fetch', '--tags', 'origin'], commandOptions);

  const previewCommit = resolveGitCommit(`refs/tags/${desktopTagInfo.previewTag}`, {
    gitRunner,
    commandOptions,
  });
  if (!previewCommit) {
    throw new Error(
      `Stable desktop promotion requires matching preview tag '${desktopTagInfo.previewTag}' to exist before '${desktopTagInfo.tagName}'.`,
    );
  }

  const selectedRef = normalizeString(options.selectedRef);
  if (selectedRef) {
    const selectedCommit = resolveGitCommit(selectedRef, {
      gitRunner,
      commandOptions,
    });
    if (!selectedCommit) {
      throw new Error(`Could not resolve selected ref '${selectedRef}' for stable desktop promotion preflight.`);
    }
    if (selectedCommit !== previewCommit) {
      throw new Error(
        `Stable desktop promotion requires preview tag '${desktopTagInfo.previewTag}' (${previewCommit}) to match selected ref '${selectedRef}' (${selectedCommit}).`,
      );
    }
  }

  const desktopTagCommit = resolveGitCommit(`refs/tags/${desktopTagInfo.tagName}`, {
    gitRunner,
    commandOptions,
  });
  if (desktopTagCommit && desktopTagCommit !== previewCommit) {
    throw new Error(
      `Stable desktop promotion requires preview tag '${desktopTagInfo.previewTag}' (${previewCommit}) to match desktop tag '${desktopTagInfo.tagName}' (${desktopTagCommit}).`,
    );
  }

  const githubToken = resolveGitHubAuthToken({
    githubToken: options.githubToken,
    env: options.env,
    commandRunner: options.commandRunner,
    commandOptions,
  });
  const releaseApiBaseUrl = normalizeString(options.releaseApiBaseUrl) || DEFAULT_RELEASE_API_BASE_URL;
  const releaseUrl = `${releaseApiBaseUrl}/repos/${packageMetadata.publishRepository.owner}/${packageMetadata.publishRepository.repo}/releases/tags/${encodeURIComponent(desktopTagInfo.previewTag)}`;
  const previewReleaseResult = await loadPublishedPreviewRelease({
    assetVisibilityAttempts: options.assetVisibilityAttempts,
    assetVisibilityDelayMs: options.assetVisibilityDelayMs,
    fetchImpl: options.fetchImpl,
    githubToken,
    logger: options.logger,
    previewTag: desktopTagInfo.previewTag,
    publishRepository: packageMetadata.publishRepository,
    url: releaseUrl,
    wait: options.wait,
  });

  return {
    status: 'passed',
    desktopTag: desktopTagInfo.tagName,
    previewTag: desktopTagInfo.previewTag,
    previewCommit,
    desktopTagCommit: desktopTagCommit || null,
    publishRepository: packageMetadata.publishRepository.fullName,
    releaseTag: normalizeString(previewReleaseResult.release.tag_name) || desktopTagInfo.previewTag,
    releaseHtmlUrl: normalizeString(previewReleaseResult.release.html_url) || null,
    attempts: previewReleaseResult.attempts,
    message: `Stable desktop promotion preflight passed for '${desktopTagInfo.tagName}' via preview release '${desktopTagInfo.previewTag}'.`,
  };
}

function printUsage() {
  console.log(
    [
      'Usage: node scripts/desktop-stable-promotion-preflight.js [--desktop-tag desktop-v1.2.3] [--selected-ref HEAD]',
      '',
      'Stable desktop promotions require a matching semver preview tag and published prerelease assets.',
    ].join('\n'),
  );
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--desktop-tag') {
      options.desktopTag = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (arg === '--selected-ref') {
      options.selectedRef = argv[index + 1] || '';
      index += 1;
    }
  }

  options.releaseApiBaseUrl = process.env.DESKTOP_RELEASE_GITHUB_API_BASE_URL;
  options.assetVisibilityAttempts = process.env.DESKTOP_RELEASE_ASSET_RETRY_ATTEMPTS;
  options.assetVisibilityDelayMs = process.env.DESKTOP_RELEASE_ASSET_RETRY_DELAY_MS;
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }

  const result = await verifyStableDesktopPromotionPreflight(options);
  console.log(result.message);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}

module.exports = {
  getMissingPreviewReleaseAssets,
  parseDesktopTagInfo,
  resolveGitHubAuthToken,
  verifyStableDesktopPromotionPreflight,
};