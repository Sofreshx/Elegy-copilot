const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const {
  inferReleaseChannel,
  validatePackagedDesktopArtifacts,
} = require('./validate-desktop-package-inputs');

const workspaceRoot = path.resolve(__dirname, '..');
const packageJsonPath = path.join(workspaceRoot, 'package.json');
const releaseDir = path.join(workspaceRoot, 'release');
const latestYmlPath = path.join(releaseDir, 'latest.yml');
const builderConfigPath = path.join(workspaceRoot, 'electron-builder.yml');
const packagedUpdateConfigPath = path.join(releaseDir, 'win-unpacked', 'resources', 'app-update.yml');
const TEST_TIMEOUT_MS = 300_000;

function resolvePackagedDistElectronDir() {
  const candidateDirs = [
    path.join(releaseDir, 'win-unpacked', 'resources', 'app.asar.unpacked', 'dist-electron'),
    path.join(releaseDir, 'win-unpacked', 'resources', 'app', 'dist-electron'),
  ];

  for (const candidateDir of candidateDirs) {
    if (fs.existsSync(candidateDir)) {
      return candidateDir;
    }
  }

  throw new Error(`Packaged Electron dist directory not found. Checked: ${candidateDirs.join(', ')}`);
}

function readRequiredFile(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} not found at ${filePath}`);
  }

  return fs.readFileSync(filePath, 'utf8');
}

function readYamlScalar(text, key) {
  const match = text.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  if (!match) {
    return null;
  }

  return match[1].trim().replace(/^['\"]|['\"]$/g, '');
}

function readYamlListUrl(text) {
  const match = text.match(/^\s*-\s*url:\s*(.+)$/m);
  if (!match) {
    return null;
  }

  return match[1].trim().replace(/^['\"]|['\"]$/g, '');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function discoverPackagedUpdaterTests(distDir) {
  if (!fs.existsSync(distDir)) {
    throw new Error(`Packaged Electron dist directory not found at ${distDir}`);
  }

  return fs.readdirSync(distDir)
    .filter((fileName) => fileName.endsWith('.test.js'))
    .filter((fileName) => /(updater|updatePolicy|rollbackPolicy)/i.test(fileName))
    .sort();
}

function runPackagedUpdaterTests(distDir, testFiles) {
  for (const testFile of testFiles) {
    const testPath = path.join(distDir, testFile);
    console.log(`[smoke] running packaged updater regression: ${testFile}`);
    execFileSync(process.execPath, [testPath], {
      cwd: workspaceRoot,
      stdio: 'inherit',
      timeout: TEST_TIMEOUT_MS,
    });
  }
}

function main() {
  const packagedDistElectronDir = resolvePackagedDistElectronDir();
  const packagedArtifacts = validatePackagedDesktopArtifacts();
  const packageJson = JSON.parse(readRequiredFile(packageJsonPath, 'package.json'));
  const latestYml = readRequiredFile(latestYmlPath, 'latest.yml');
  const builderConfig = readRequiredFile(builderConfigPath, 'electron-builder.yml');
  const packagedUpdateConfig = readRequiredFile(packagedUpdateConfigPath, 'packaged app-update.yml');
  const expectedChannel = inferReleaseChannel(packageJson.version);

  const expectedVersion = String(packageJson.version || '').trim();
  const latestVersion = readYamlScalar(latestYml, 'version');
  const latestPath = readYamlScalar(latestYml, 'path');
  const latestFileUrl = readYamlListUrl(latestYml);
  const provider = readYamlScalar(packagedUpdateConfig, 'provider');
  const owner = readYamlScalar(packagedUpdateConfig, 'owner');
  const repo = readYamlScalar(packagedUpdateConfig, 'repo');
  const releaseType = readYamlScalar(packagedUpdateConfig, 'releaseType');
  const updaterCacheDirName = readYamlScalar(packagedUpdateConfig, 'updaterCacheDirName');

  assert(expectedVersion.length > 0, 'package.json version is missing');
  assert(latestVersion === expectedVersion, `latest.yml version ${latestVersion || '(missing)'} does not match package.json version ${expectedVersion}`);
  assert(latestPath, 'latest.yml path is missing');
  assert(latestFileUrl === latestPath, `latest.yml files[0].url ${latestFileUrl || '(missing)'} does not match path ${latestPath}`);

  const installerPath = path.join(releaseDir, latestPath);
  const blockmapPath = path.join(releaseDir, `${latestPath}.blockmap`);
  assert(fs.existsSync(installerPath), `Installer artifact missing at ${installerPath}`);
  assert(fs.existsSync(blockmapPath), `Installer blockmap missing at ${blockmapPath}`);

  assert(builderConfig.includes('provider: github'), 'electron-builder.yml no longer publishes through GitHub');
  assert(builderConfig.includes(`owner: ${owner}`), `electron-builder.yml owner does not match packaged app-update.yml owner ${owner || '(missing)'}`);
  assert(builderConfig.includes(`repo: ${repo}`), `electron-builder.yml repo does not match packaged app-update.yml repo ${repo || '(missing)'}`);
  assert(builderConfig.includes(`releaseType: ${releaseType}`), `electron-builder.yml releaseType does not match packaged app-update.yml releaseType ${releaseType || '(missing)'}`);
  assert(provider === 'github', `Expected packaged updater provider to be github, received ${provider || '(missing)'}`);
  assert(updaterCacheDirName === `${packageJson.name}-updater`, `Expected updaterCacheDirName ${packageJson.name}-updater, received ${updaterCacheDirName || '(missing)'}`);
  assert(packagedArtifacts.appChannel === expectedChannel, `Expected packaged CLI contract channel ${expectedChannel}, received ${packagedArtifacts.appChannel}`);
  assert(packagedArtifacts.sdkChannel === expectedChannel, `Expected packaged SDK contract channel ${expectedChannel}, received ${packagedArtifacts.sdkChannel}`);

  const testFiles = discoverPackagedUpdaterTests(packagedDistElectronDir);
  assert(testFiles.length > 0, `No packaged updater regression tests were found in ${packagedDistElectronDir}`);

  console.log('[smoke] validated packaged updater metadata');
  console.log(`[smoke] installer: ${path.basename(installerPath)}`);
  console.log(`[smoke] packaged dist-electron dir: ${packagedDistElectronDir}`);
  console.log(`[smoke] packaged CLI contract: ${packagedArtifacts.contractStatus} (${packagedArtifacts.appChannel})`);
  console.log(`[smoke] packaged workflow sidecar: ${packagedArtifacts.workflowSidecarPosture}`);
  console.log(`[smoke] packaged updater tests: ${testFiles.join(', ')}`);
  runPackagedUpdaterTests(packagedDistElectronDir, testFiles);
  console.log('[smoke] packaged Windows updater smoke passed');
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[smoke] packaged Windows updater smoke failed: ${message}`);
  process.exit(1);
}
