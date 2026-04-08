const fs = require('fs');
const path = require('path');

const workspaceRoot = path.resolve(__dirname, '..');
const pgliteEntrypoint = require.resolve('@electric-sql/pglite');
const pgliteDistRoot = path.dirname(pgliteEntrypoint);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function readJson(filePath, label) {
  assert(fs.existsSync(filePath), `Missing ${label}: ${filePath}`);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function isPrereleaseVersion(version) {
  return /^\d+\.\d+\.\d+-.+/.test(String(version || '').trim());
}

function inferReleaseChannel(version) {
  return isPrereleaseVersion(version) ? 'prerelease' : 'stable';
}

function requireFile(label, filePath) {
  assert(fs.existsSync(filePath), `Missing ${label}: ${filePath}`);
  assert(fs.statSync(filePath).isFile(), `Expected ${label} to be a file: ${filePath}`);
}

function requireDirectoryWithFiles(label, directoryPath) {
  assert(fs.existsSync(directoryPath), `Missing ${label}: ${directoryPath}`);
  assert(fs.statSync(directoryPath).isDirectory(), `Expected ${label} to be a directory: ${directoryPath}`);
  const entries = fs.readdirSync(directoryPath).filter((entry) => !entry.startsWith('.'));
  assert(entries.length > 0, `${label} is empty: ${directoryPath}`);
}

function validateChannelContract({ packageJson, contractRoot, contractLabel }) {
  const contractPath = path.join(contractRoot, 'channel-contract.json');
  const contract = readJson(contractPath, contractLabel || 'desktop Copilot CLI channel contract');
  const appVersion = String(packageJson.version || '').trim();
  const sdkVersion = String(packageJson.dependencies?.['@github/copilot-sdk'] || '').trim();
  const appChannel = inferReleaseChannel(appVersion);
  const sdkChannel = inferReleaseChannel(sdkVersion);
  const expectedChannels = ['prerelease', 'stable'];

  assert(Number(contract.schemaVersion) === 1, `Expected ${contractPath} schemaVersion=1.`);
  assert(contract.managedCliRequired === true, `Expected ${contractPath} managedCliRequired=true.`);
  assert(
    String(contract.defaultAcquisition || '').trim() === 'bundle_or_seeded_install_only',
    `Expected ${contractPath} defaultAcquisition=bundle_or_seeded_install_only.`,
  );
  assert(typeof contract.status === 'string' && contract.status.trim(), `Expected ${contractPath} status to be non-empty.`);
  assert(contract.channels && typeof contract.channels === 'object' && !Array.isArray(contract.channels), `Expected ${contractPath} channels object.`);

  const actualChannels = Object.keys(contract.channels).sort();
  assert(
    JSON.stringify(actualChannels) === JSON.stringify(expectedChannels),
    `Expected ${contractPath} channels ${expectedChannels.join(', ')}, received ${actualChannels.join(', ') || '(none)'}.`,
  );

  for (const channel of expectedChannels) {
    const entry = contract.channels[channel];
    assert(entry && typeof entry === 'object' && !Array.isArray(entry), `Expected ${contractPath} channel entry ${channel}.`);
    assert(entry.sdkChannel === channel, `Expected ${contractPath} channels.${channel}.sdkChannel=${channel}.`);
    assert(entry.cliChannel === channel, `Expected ${contractPath} channels.${channel}.cliChannel=${channel}.`);
    assert(typeof entry.bundled === 'boolean', `Expected ${contractPath} channels.${channel}.bundled boolean.`);
  }

  assert(appVersion, 'copilot-ui/package.json version is missing.');
  assert(sdkVersion, 'copilot-ui/package.json dependency @github/copilot-sdk is missing.');
  assert(
    sdkChannel === appChannel,
    `Desktop app version ${appVersion} (${appChannel}) must pair with a matching SDK lane; found @github/copilot-sdk ${sdkVersion} (${sdkChannel}).`,
  );
  assert(
    contract.channels[appChannel].sdkChannel === appChannel && contract.channels[appChannel].cliChannel === appChannel,
    `Desktop app version ${appVersion} must stay on the ${appChannel} SDK/CLI lane.`,
  );

  if (contract.status === 'bounded_no_bundled_cli_payload_in_this_slice') {
    for (const channel of expectedChannels) {
      assert(contract.channels[channel].bundled === false, `Expected ${contractPath} channels.${channel}.bundled=false for the bounded no-bundle slice.`);
      const bundledManifestPath = path.join(contractRoot, channel, 'manifest.json');
      assert(
        !fs.existsSync(bundledManifestPath),
        `Unexpected bundled CLI manifest for ${channel} lane while contract status is ${contract.status}: ${bundledManifestPath}`,
      );
    }
  }

  return {
    appVersion,
    appChannel,
    sdkVersion,
    sdkChannel,
    contractPath,
    contractStatus: contract.status,
  };
}

function validateDesktopPackageInputs(options = {}) {
  const activeWorkspaceRoot = path.resolve(options.workspaceRoot || workspaceRoot);
  const localTrackerRoot = path.resolve(options.localTrackerRoot || path.join(activeWorkspaceRoot, '..', 'local-tracker'));
  const engineAssetsRoot = path.resolve(options.engineAssetsRoot || path.join(activeWorkspaceRoot, '..', 'engine-assets'));
  const packageJson = readJson(path.join(activeWorkspaceRoot, 'package.json'), 'desktop package.json');
  const requiredFiles = [
    {
      label: 'built React UI entrypoint',
      filePath: path.join(activeWorkspaceRoot, 'ui-dist', 'index.html'),
    },
    {
      label: 'built Electron main bundle',
      filePath: path.join(activeWorkspaceRoot, 'dist-electron', 'main.js'),
    },
    {
      label: 'built local-tracker runtime',
      filePath: path.join(localTrackerRoot, 'dist', 'index.js'),
    },
    {
      label: 'built local-tracker messaging gateway runtime',
      filePath: path.join(localTrackerRoot, 'dist', 'messagingGateway', 'index.js'),
    },
    {
      label: 'built local-tracker workflow sidecar runtime',
      filePath: path.join(localTrackerRoot, 'dist', 'messagingGateway', 'workflowSidecar.js'),
    },
    {
      label: 'engine-assets manifest',
      filePath: path.join(engineAssetsRoot, 'manifest.json'),
    },
    {
      label: 'embedded desktop planning persistence entrypoint',
      filePath: pgliteEntrypoint,
    },
    {
      label: 'embedded desktop planning persistence wasm payload',
      filePath: path.join(pgliteDistRoot, 'pglite.wasm'),
    },
    {
      label: 'embedded desktop planning persistence data payload',
      filePath: path.join(pgliteDistRoot, 'pglite.data'),
    },
    {
      label: 'embedded desktop planning initdb runtime',
      filePath: path.join(pgliteDistRoot, 'initdb.wasm'),
    },
    {
      label: 'desktop Copilot CLI channel contract',
      filePath: path.join(activeWorkspaceRoot, 'resources', 'copilot-cli', 'channel-contract.json'),
    },
  ];

  for (const entry of requiredFiles) {
    requireFile(entry.label, entry.filePath);
  }

  requireDirectoryWithFiles(
    'built local-tracker packaged workflow assets',
    path.join(localTrackerRoot, 'dist', 'messagingGateway', 'workflows'),
  );

  const contractSummary = validateChannelContract({
    packageJson,
    contractRoot: path.join(activeWorkspaceRoot, 'resources', 'copilot-cli'),
    contractLabel: 'desktop Copilot CLI channel contract',
  });

  return {
    packageJson,
    requiredInputCount: requiredFiles.length + 1,
    workflowSidecarPosture: 'bundled_default_disabled',
    ...contractSummary,
  };
}

function validatePackagedDesktopArtifacts(options = {}) {
  const activeWorkspaceRoot = path.resolve(options.workspaceRoot || workspaceRoot);
  const packageJson = readJson(path.join(activeWorkspaceRoot, 'package.json'), 'desktop package.json');
  const sourceContractPath = path.join(activeWorkspaceRoot, 'resources', 'copilot-cli', 'channel-contract.json');
  const sourceEngineManifestPath = path.join(activeWorkspaceRoot, '..', 'engine-assets', 'manifest.json');
  const packagedResourcesRoot = path.resolve(options.packagedResourcesRoot || path.join(activeWorkspaceRoot, 'release', 'win-unpacked', 'resources'));
  const packagedContractRoot = path.join(packagedResourcesRoot, 'copilot-cli');
  const packagedWorkflowRoot = path.join(packagedResourcesRoot, 'local-tracker', 'dist', 'messagingGateway');
  const packagedEngineAssetsRoot = path.join(packagedResourcesRoot, 'engine-assets');
  const packagedContractPath = path.join(packagedContractRoot, 'channel-contract.json');
  const packagedEngineManifestPath = path.join(packagedEngineAssetsRoot, 'manifest.json');
  const sourceContractText = fs.readFileSync(sourceContractPath, 'utf8');
  const sourceEngineManifestText = fs.readFileSync(sourceEngineManifestPath, 'utf8');

  requireFile('packaged desktop Copilot CLI channel contract', packagedContractPath);
  assert(
    fs.readFileSync(packagedContractPath, 'utf8') === sourceContractText,
    `Packaged desktop Copilot CLI channel contract drifted from source metadata: ${packagedContractPath}`,
  );

  const contractSummary = validateChannelContract({
    packageJson,
    contractRoot: packagedContractRoot,
    contractLabel: 'packaged desktop Copilot CLI channel contract',
  });

  requireFile('packaged engine-assets manifest', packagedEngineManifestPath);
  assert(
    fs.readFileSync(packagedEngineManifestPath, 'utf8') === sourceEngineManifestText,
    `Packaged engine-assets manifest drifted from source metadata: ${packagedEngineManifestPath}`,
  );
  requireFile('packaged workflow sidecar runtime', path.join(packagedWorkflowRoot, 'workflowSidecar.js'));
  requireDirectoryWithFiles('packaged workflow assets', path.join(packagedWorkflowRoot, 'workflows'));

  return {
    packagedResourcesRoot,
    packagedWorkflowSidecarPath: path.join(packagedWorkflowRoot, 'workflowSidecar.js'),
    workflowSidecarPosture: 'bundled_default_disabled',
    ...contractSummary,
  };
}

if (require.main === module) {
  try {
    const result = validateDesktopPackageInputs();
    console.log(
      `[desktop-package] validated ${result.requiredInputCount} packaged runtime input(s); `
      + `app=${result.appVersion} (${result.appChannel}), sdk=${result.sdkVersion} (${result.sdkChannel}), `
      + `cliContract=${result.contractStatus}, workflowSidecar=${result.workflowSidecarPosture}.`,
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[desktop-package] ${detail}`);
    process.exit(1);
  }
}

module.exports = {
  inferReleaseChannel,
  isPrereleaseVersion,
  validateChannelContract,
  validateDesktopPackageInputs,
  validatePackagedDesktopArtifacts,
};
