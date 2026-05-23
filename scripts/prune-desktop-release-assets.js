'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function collectFiles(rootDir, currentDir = rootDir) {
  if (!fs.existsSync(currentDir)) {
    return [];
  }

  const entries = fs.readdirSync(currentDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolutePath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(rootDir, absolutePath));
      continue;
    }
    if (entry.isFile()) {
      files.push(path.relative(rootDir, absolutePath));
    }
  }

  return files.sort();
}

function resolveExpectedReleaseAssetNames(artifactsDir) {
  const resolvedArtifactsDir = path.resolve(artifactsDir);
  const files = collectFiles(resolvedArtifactsDir);
  assert(files.length > 0, `No release artifacts were found under ${resolvedArtifactsDir}.`);

  const seenNames = new Set();
  const duplicateNames = new Set();
  const assetNames = [];
  for (const relativeFilePath of files) {
    const assetName = path.basename(relativeFilePath);
    assert(assetName, `Unable to resolve release asset name for ${relativeFilePath}.`);
    if (seenNames.has(assetName)) {
      duplicateNames.add(assetName);
      continue;
    }
    seenNames.add(assetName);
    assetNames.push(assetName);
  }

  assert(
    duplicateNames.size === 0,
    `Release artifacts under ${resolvedArtifactsDir} contain duplicate asset names: ${Array.from(duplicateNames).sort().join(', ')}.`,
  );

  return assetNames.sort();
}

function determineStaleReleaseAssetNames(existingAssetNames, expectedAssetNames) {
  const expectedNameSet = new Set(expectedAssetNames.map((value) => normalizeString(value)).filter(Boolean));
  return Array.from(new Set(
    existingAssetNames
      .map((value) => normalizeString(value))
      .filter(Boolean)
      .filter((assetName) => !expectedNameSet.has(assetName)),
  )).sort();
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

function parseReleaseAssetNames(viewOutput) {
  const payload = JSON.parse(viewOutput);
  const assets = Array.isArray(payload && payload.assets) ? payload.assets : [];
  return assets
    .map((asset) => normalizeString(asset && asset.name))
    .filter(Boolean)
    .sort();
}

function isMissingReleaseError(detail) {
  return /release not found/i.test(normalizeString(detail));
}

function viewGitHubReleaseAssetNames(options = {}) {
  const releaseTag = normalizeString(options.releaseTag);
  const repo = normalizeString(options.repo);
  const result = runCommandOptional(
    'gh',
    ['release', 'view', releaseTag, '--repo', repo, '--json', 'assets'],
    options.commandOptions || {},
  );

  if (!result.ok) {
    return {
      ok: false,
      missing: isMissingReleaseError(result.output),
      errorMessage: result.output,
      assetNames: [],
    };
  }

  return {
    ok: true,
    missing: false,
    errorMessage: null,
    assetNames: parseReleaseAssetNames(result.output),
  };
}

function deleteGitHubReleaseAsset(options = {}) {
  const releaseTag = normalizeString(options.releaseTag);
  const repo = normalizeString(options.repo);
  const assetName = normalizeString(options.assetName);
  runCommand(
    'gh',
    ['release', 'delete-asset', releaseTag, assetName, '--repo', repo, '--yes'],
    options.commandOptions || {},
  );
}

function pruneDesktopReleaseAssets(options = {}) {
  const repo = normalizeString(options.repo);
  const releaseTag = normalizeString(options.releaseTag);
  const artifactsDir = path.resolve(normalizeString(options.artifactsDir));

  assert(repo, 'GitHub release repository is required (owner/repo).');
  assert(releaseTag, 'GitHub release tag is required.');
  assert(normalizeString(options.artifactsDir), 'Release artifacts directory is required.');

  const expectedAssetNames = resolveExpectedReleaseAssetNames(artifactsDir);
  const viewRelease = typeof options.viewRelease === 'function'
    ? options.viewRelease
    : viewGitHubReleaseAssetNames;
  const deleteAsset = typeof options.deleteAsset === 'function'
    ? options.deleteAsset
    : deleteGitHubReleaseAsset;
  const releaseView = viewRelease({
    repo,
    releaseTag,
    commandOptions: options.commandOptions,
  });

  if (!releaseView.ok) {
    if (releaseView.missing) {
      return {
        status: 'skipped',
        reason: 'release_not_found',
        repo,
        releaseTag,
        artifactsDir,
        expectedAssetNames,
        existingAssetNames: [],
        staleAssetNames: [],
      };
    }

    throw new Error(
      `Unable to inspect GitHub release '${releaseTag}' in ${repo}: ${releaseView.errorMessage || 'unknown error'}`,
    );
  }

  const existingAssetNames = Array.isArray(releaseView.assetNames) ? releaseView.assetNames.slice() : [];
  const staleAssetNames = determineStaleReleaseAssetNames(existingAssetNames, expectedAssetNames);
  if (options.dryRun !== true) {
    for (const assetName of staleAssetNames) {
      deleteAsset({
        repo,
        releaseTag,
        assetName,
        commandOptions: options.commandOptions,
      });
    }
  }

  return {
    status: staleAssetNames.length > 0
      ? (options.dryRun === true ? 'dry_run' : 'pruned')
      : 'noop',
    reason: staleAssetNames.length > 0 ? null : 'release_assets_already_aligned',
    repo,
    releaseTag,
    artifactsDir,
    expectedAssetNames,
    existingAssetNames,
    staleAssetNames,
  };
}

function printUsage() {
  console.log(
    [
      'Usage: node scripts/prune-desktop-release-assets.js --repo owner/repo --release-tag 1.2.3 --artifacts-dir artifacts/windows-tauri [--dry-run]',
      '',
      'Deletes stale GitHub release assets that are not present in the current staged desktop artifact set.',
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
    if (arg === '--repo') {
      options.repo = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (arg === '--release-tag') {
      options.releaseTag = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (arg === '--artifacts-dir') {
      options.artifactsDir = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function describeResult(result) {
  if (result.status === 'skipped') {
    return `Release '${result.releaseTag}' does not exist yet in ${result.repo}; nothing to prune.`;
  }

  if (result.status === 'noop') {
    return `Release '${result.releaseTag}' already matches the staged desktop asset set (${result.expectedAssetNames.join(', ')}).`;
  }

  const verb = result.status === 'dry_run' ? 'Would prune' : 'Pruned';
  return `${verb} stale assets from release '${result.releaseTag}': ${result.staleAssetNames.join(', ')}.`;
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    printUsage();
    return;
  }

  const result = pruneDesktopReleaseAssets(options);
  console.log(`[prune-desktop-release-assets] ${describeResult(result)}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[prune-desktop-release-assets] ${detail}`);
    process.exit(1);
  }
}

module.exports = {
  determineStaleReleaseAssetNames,
  main,
  pruneDesktopReleaseAssets,
  resolveExpectedReleaseAssetNames,
  viewGitHubReleaseAssetNames,
};
