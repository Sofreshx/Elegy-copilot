'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const { verifyStableDesktopPromotionPreflight } = require('./desktop-stable-promotion-preflight');

const DESKTOP_PACKAGE_NAME = 'elegy-copilot-desktop';
const DESKTOP_PACKAGE_PATH = 'copilot-ui/package.json';
const EXPLICIT_DESKTOP_RELEASE_FLAG = '--desktop-release';

function run(command, options = {}) {
  return execSync(command, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  }).trim();
}

function runOptional(command, options = {}) {
  try {
    return {
      ok: true,
      output: run(command, options),
    };
  } catch (error) {
    return {
      ok: false,
      output: (error.stderr || error.message || '').toString().trim(),
    };
  }
}

function getVersionFromGitObject(gitObjectPath) {
  const result = runOptional(`git show ${gitObjectPath}`);
  if (!result.ok || !result.output) return null;

  try {
    const parsed = JSON.parse(result.output);
    return parsed.version || null;
  } catch (_error) {
    return null;
  }
}

function printUsage() {
  console.log(
    [
      'Usage: node scripts/create-desktop-release-tag.js --desktop-release [--dry-run]',
      '',
      'Explicit helper for manual desktop release flows only.',
    ].join('\n')
  );
}

async function main(args = process.argv.slice(2)) {
  const dryRun = args.includes('--dry-run');
  const showHelp = args.includes('--help') || args.includes('-h');
  const explicitDesktopRelease = args.includes(EXPLICIT_DESKTOP_RELEASE_FLAG);

  if (showHelp) {
    printUsage();
    return;
  }

  if (!explicitDesktopRelease) {
    throw new Error(
      `Refusing to run desktop tag helper outside an explicit desktop release flow. Re-run with ${EXPLICIT_DESKTOP_RELEASE_FLAG}.`
    );
  }

  const repoRoot = run('git rev-parse --show-toplevel');
  const packageJsonPath = path.join(repoRoot, DESKTOP_PACKAGE_PATH);
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

  if (packageJson.name !== DESKTOP_PACKAGE_NAME) {
    throw new Error(
      `Expected ${DESKTOP_PACKAGE_PATH} to be '${DESKTOP_PACKAGE_NAME}', received '${packageJson.name || '(missing)'}'.`
    );
  }

  if (!packageJson.version) {
    throw new Error(`Missing version in ${DESKTOP_PACKAGE_PATH}.`);
  }

  const currentVersion = packageJson.version;
  const previousVersion = getVersionFromGitObject(`HEAD^:${DESKTOP_PACKAGE_PATH}`);
  const tagName = `desktop-v${currentVersion}`;

  const preflight = await verifyStableDesktopPromotionPreflight({
    repoRoot,
    desktopTag: tagName,
    selectedRef: 'HEAD',
    releaseApiBaseUrl: process.env.DESKTOP_RELEASE_GITHUB_API_BASE_URL,
    assetVisibilityAttempts: process.env.DESKTOP_RELEASE_ASSET_RETRY_ATTEMPTS,
    assetVisibilityDelayMs: process.env.DESKTOP_RELEASE_ASSET_RETRY_DELAY_MS,
  });
  console.log(preflight.message);

  runOptional('git fetch --tags origin');

  const remoteTag = runOptional(`git ls-remote --tags --refs origin refs/tags/${tagName}`);
  if (remoteTag.ok && remoteTag.output) {
    console.log(`Tag '${tagName}' already exists on origin; skipping.`);
    return;
  }

  const localTag = runOptional(`git rev-parse --verify --quiet refs/tags/${tagName}`);
  if (!localTag.ok || !localTag.output) {
    if (previousVersion === currentVersion) {
      console.log(`No desktop version bump detected (${currentVersion}); creating missing tag '${tagName}' anyway.`);
    }

    if (dryRun) {
      console.log(`[dry-run] Would create local tag '${tagName}'.`);
    } else {
      run(`git tag ${tagName}`);
      console.log(`Created local tag '${tagName}'.`);
    }
  } else {
    if (previousVersion === currentVersion) {
      console.log(`No desktop version bump detected (${currentVersion}); reusing existing local tag '${tagName}'.`);
    }
    console.log(`Tag '${tagName}' already exists locally.`);
  }

  if (dryRun) {
    console.log(`[dry-run] Would push '${tagName}' to origin.`);
    return;
  }

  run(`git push origin refs/tags/${tagName}`);
  console.log(`Pushed '${tagName}' to origin.`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}

module.exports = {
  main,
};
