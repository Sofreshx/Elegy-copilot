const fs = require('fs');
const path = require('path');

const workspaceRoot = path.resolve(__dirname, '..');
const manifestRelativePath = path.join('resources', 'runtime-manifests', 'windows-tauri-node-sidecar.json');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function readJson(filePath, label) {
  assert(fs.existsSync(filePath), `Missing ${label}: ${filePath}`);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function requireFile(label, filePath) {
  assert(fs.existsSync(filePath), `Missing ${label}: ${filePath}`);
  assert(fs.statSync(filePath).isFile(), `Expected ${label} to be a file: ${filePath}`);
}

function requireDirectory(label, directoryPath) {
  assert(fs.existsSync(directoryPath), `Missing ${label}: ${directoryPath}`);
  assert(fs.statSync(directoryPath).isDirectory(), `Expected ${label} to be a directory: ${directoryPath}`);
}

function collectFiles(rootDir, currentDir = rootDir) {
  const entries = fs.readdirSync(currentDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(rootDir, absolutePath));
      continue;
    }
    if (entry.isFile()) {
      files.push(path.relative(rootDir, absolutePath).split(path.sep).join('/'));
    }
  }

  return files.sort();
}

function globToRegExp(globPattern) {
  const normalized = String(globPattern || '').trim().split('\\').join('/');
  const escaped = normalized.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const withDoubleStar = escaped.replace(/\*\*/g, '::DOUBLE_STAR::');
  const withSingleStar = withDoubleStar.replace(/\*/g, '[^/]*');
  return new RegExp(`^${withSingleStar.replace(/::DOUBLE_STAR::/g, '.*')}$`);
}

function findResourceCopy(manifest, id) {
  return Array.isArray(manifest.resourceCopies)
    ? manifest.resourceCopies.find((entry) => entry && entry.id === id)
    : null;
}

function loadTauriNodeSidecarLayout(options = {}) {
  const activeWorkspaceRoot = path.resolve(options.workspaceRoot || workspaceRoot);
  const manifestPath = path.resolve(options.manifestPath || path.join(activeWorkspaceRoot, manifestRelativePath));
  const manifest = readJson(manifestPath, 'Windows Tauri Node sidecar layout manifest');
  return {
    workspaceRoot: activeWorkspaceRoot,
    manifestPath,
    manifest,
  };
}

function resolveWorkspaceDependencyRoot(activeWorkspaceRoot, relativePath, requiredPackages = []) {
  const workspaceCandidate = path.resolve(activeWorkspaceRoot, relativePath);
  const hasRequiredPackages = (rootPath) => requiredPackages.every((packageName) => fs.existsSync(path.join(rootPath, ...packageName.split('/'))));
  if (fs.existsSync(workspaceCandidate) && hasRequiredPackages(workspaceCandidate)) {
    return workspaceCandidate;
  }

  const repoCandidate = path.resolve(activeWorkspaceRoot, '..', relativePath);
  if (fs.existsSync(repoCandidate) && hasRequiredPackages(repoCandidate)) {
    return repoCandidate;
  }

  if (fs.existsSync(workspaceCandidate)) {
    return workspaceCandidate;
  }
  if (fs.existsSync(repoCandidate)) {
    return repoCandidate;
  }

  return workspaceCandidate;
}

function validateDirectoryFilter(label, sourceRoot, filters) {
  const sourceFiles = collectFiles(sourceRoot);
  assert(sourceFiles.length > 0, `${label} is empty: ${sourceRoot}`);

  if (!Array.isArray(filters) || filters.length === 0) {
    return sourceFiles.length;
  }

  for (const pattern of filters) {
    const regex = globToRegExp(pattern);
    assert(
      sourceFiles.some((filePath) => regex.test(filePath)),
      `${label} does not match required filter ${pattern}: ${sourceRoot}`,
    );
  }

  return sourceFiles.filter((filePath) => filters.some((pattern) => globToRegExp(pattern).test(filePath))).length;
}

function validateTauriNodeSidecarLayoutModel(options = {}) {
  const { workspaceRoot: activeWorkspaceRoot, manifestPath, manifest } = loadTauriNodeSidecarLayout(options);
  const packageJsonPath = path.join(activeWorkspaceRoot, 'package.json');
  const packageJson = readJson(packageJsonPath, 'desktop package.json');
  const requiredResourceIds = [
    'copilot-ui-server',
    'copilot-ui-lib',
    'copilot-ui-routes',
    'copilot-ui-ui-dist',
    'copilot-ui-package-json',
    'copilot-cli',
    'engine-assets',
    'cli-policy',
    'local-tracker-dist',
    'local-tracker-node-modules',
    'local-tracker-package-json',
    'scripts',
    'runtime-manifests',
  ];

  assert(Number(manifest.schemaVersion) === 1, `Expected ${manifestPath} schemaVersion=1.`);
  assert(manifest.platform === 'windows', `Expected ${manifestPath} platform=windows.`);
  assert(manifest.shell === 'tauri', `Expected ${manifestPath} shell=tauri.`);
  assert(manifest.status === 'windows_release_preview_lane_ready', `Unexpected ${manifestPath} status ${manifest.status || '(missing)'}.`);
  assert(manifest.resourceRoot === '.', `Expected ${manifestPath} resourceRoot=.`);
  assert(manifest.workflowSidecarPosture === 'bundled_default_disabled', `Expected ${manifestPath} workflowSidecarPosture=bundled_default_disabled.`);
  assert(manifest.releaseLane && typeof manifest.releaseLane === 'object', `Expected ${manifestPath} releaseLane object.`);
  assert(manifest.releaseLane.packaging === 'windows_nsis_preview_installer', `Expected ${manifestPath} releaseLane.packaging=windows_nsis_preview_installer.`);
  assert(manifest.releaseLane.updateMode === 'manual_installer', `Expected ${manifestPath} releaseLane.updateMode=manual_installer.`);
  assert(manifest.releaseLane.autoUpdateEnabled === false, `Expected ${manifestPath} releaseLane.autoUpdateEnabled=false.`);
  assert(manifest.releaseLane.failClosedChannelPolicy === true, `Expected ${manifestPath} releaseLane.failClosedChannelPolicy=true.`);
  assert(manifest.nodeRuntime && typeof manifest.nodeRuntime === 'object', `Expected ${manifestPath} nodeRuntime object.`);
  assert(manifest.nodeRuntime.relativePath === 'node/node.exe', `Expected ${manifestPath} nodeRuntime.relativePath=node/node.exe.`);
  assert(manifest.nodeRuntime.hostInstalledNodeAllowed === false, `Expected ${manifestPath} nodeRuntime.hostInstalledNodeAllowed=false.`);
  assert(manifest.entrypoints && typeof manifest.entrypoints === 'object', `Expected ${manifestPath} entrypoints object.`);
  assert(manifest.entrypoints.server === 'copilot-ui/server.js', `Expected ${manifestPath} entrypoints.server=copilot-ui/server.js.`);
  assert(manifest.entrypoints.gateway === 'local-tracker/dist/messagingGateway/index.js', `Expected ${manifestPath} entrypoints.gateway=local-tracker/dist/messagingGateway/index.js.`);
  assert(manifest.entrypoints.workflowSidecar === 'local-tracker/dist/messagingGateway/workflowSidecar.js', `Expected ${manifestPath} entrypoints.workflowSidecar=local-tracker/dist/messagingGateway/workflowSidecar.js.`);
  assert(Array.isArray(manifest.resourceCopies), `Expected ${manifestPath} resourceCopies array.`);

  for (const resourceId of requiredResourceIds) {
    assert(findResourceCopy(manifest, resourceId), `Expected ${manifestPath} resourceCopies to include ${resourceId}.`);
  }

  let validatedResourceCount = 0;
  for (const resource of manifest.resourceCopies) {
    assert(resource && typeof resource === 'object', `Expected every ${manifestPath} resourceCopies entry to be an object.`);
    assert(typeof resource.id === 'string' && resource.id.trim(), `Expected every ${manifestPath} resourceCopies entry to have an id.`);
    assert(resource.kind === 'file' || resource.kind === 'directory', `Unexpected ${manifestPath} resourceCopies.${resource.id}.kind ${resource.kind || '(missing)'}.`);
    assert(typeof resource.source === 'string' && resource.source.trim(), `Expected ${manifestPath} resourceCopies.${resource.id}.source.`);
    assert(typeof resource.target === 'string' && resource.target.trim(), `Expected ${manifestPath} resourceCopies.${resource.id}.target.`);
    assert(!path.isAbsolute(resource.target), `Expected ${manifestPath} resourceCopies.${resource.id}.target to stay relative: ${resource.target}`);

    const sourcePath = path.resolve(activeWorkspaceRoot, resource.source);
    if (resource.kind === 'file') {
      requireFile(`Tauri sidecar model source ${resource.id}`, sourcePath);
    } else {
      requireDirectory(`Tauri sidecar model source ${resource.id}`, sourcePath);
      validateDirectoryFilter(`Tauri sidecar model source ${resource.id}`, sourcePath, resource.filter);
    }

    validatedResourceCount += 1;
  }

  assert(manifest.nodeModulePayload && typeof manifest.nodeModulePayload === 'object', `Expected ${manifestPath} nodeModulePayload object.`);
  assert(manifest.nodeModulePayload.manifest === 'package.json', `Expected ${manifestPath} nodeModulePayload.manifest=package.json.`);
  assert(manifest.nodeModulePayload.sourceRoot === 'node_modules', `Expected ${manifestPath} nodeModulePayload.sourceRoot=node_modules.`);
  assert(manifest.nodeModulePayload.targetRoot === 'copilot-ui/node_modules', `Expected ${manifestPath} nodeModulePayload.targetRoot=copilot-ui/node_modules.`);
  assert(manifest.nodeModulePayload.installStrategy === 'production_package_install', `Expected ${manifestPath} nodeModulePayload.installStrategy=production_package_install.`);

  const sourceNodeModulesRoot = resolveWorkspaceDependencyRoot(
    activeWorkspaceRoot,
    manifest.nodeModulePayload.sourceRoot,
    manifest.nodeModulePayload.requiredRuntimePackages,
  );
  requireDirectory('desktop node_modules source root for Tauri sidecar model', sourceNodeModulesRoot);

  for (const packageName of manifest.nodeModulePayload.requiredRuntimePackages || []) {
    const dependencyVersion = packageJson.dependencies && packageJson.dependencies[packageName];
    assert(dependencyVersion, `Expected copilot-ui/package.json to declare runtime dependency ${packageName}.`);
    const packagePath = path.join(sourceNodeModulesRoot, ...packageName.split('/'));
    requireDirectory(`desktop runtime package ${packageName}`, packagePath);
  }

  assert(manifest.pglite && typeof manifest.pglite === 'object', `Expected ${manifestPath} pglite object.`);
  assert(manifest.pglite.targetDist === 'copilot-ui/node_modules/@electric-sql/pglite/dist', `Expected ${manifestPath} pglite.targetDist to stay under copilot-ui/node_modules.`);
  assert(manifest.pglite.mustRemainFilesystemReadable === true, `Expected ${manifestPath} pglite.mustRemainFilesystemReadable=true.`);
  assert(Array.isArray(manifest.pglite.requiredFiles) && manifest.pglite.requiredFiles.length > 0, `Expected ${manifestPath} pglite.requiredFiles.`);

  const pgliteSourceDistPath = path.dirname(require.resolve('@electric-sql/pglite', {
    paths: [activeWorkspaceRoot, path.resolve(activeWorkspaceRoot, '..')],
  }));
  requireDirectory('desktop pglite dist source root for Tauri sidecar model', pgliteSourceDistPath);
  for (const fileName of manifest.pglite.requiredFiles) {
    requireFile(`desktop pglite payload ${fileName}`, path.join(pgliteSourceDistPath, fileName));
  }

  return {
    manifestPath,
    validatedResourceCount,
    workflowSidecarPosture: manifest.workflowSidecarPosture,
    nodeRuntimeRelativePath: manifest.nodeRuntime.relativePath,
    serverEntrypoint: manifest.entrypoints.server,
    gatewayEntrypoint: manifest.entrypoints.gateway,
    workflowSidecarEntrypoint: manifest.entrypoints.workflowSidecar,
    pgliteTargetDist: manifest.pglite.targetDist,
    updateMode: manifest.releaseLane.updateMode,
    packaging: manifest.releaseLane.packaging,
    status: manifest.status,
  };
}

function validateTauriBundleConfig(options = {}) {
  const { workspaceRoot: activeWorkspaceRoot } = loadTauriNodeSidecarLayout(options);
  const tauriConfigPath = path.resolve(options.tauriConfigPath || path.join(activeWorkspaceRoot, 'src-tauri', 'tauri.conf.json'));
  const tauriConfig = readJson(tauriConfigPath, 'Tauri bundle config');
  const resources = tauriConfig.bundle && tauriConfig.bundle.resources && typeof tauriConfig.bundle.resources === 'object'
    ? tauriConfig.bundle.resources
    : null;

  assert(resources, `Expected ${tauriConfigPath} bundle.resources object.`);
  assert(tauriConfig.bundle && tauriConfig.bundle.active === true, `Expected ${tauriConfigPath} bundle.active=true.`);
  assert(tauriConfig.bundle.targets === 'nsis', `Expected ${tauriConfigPath} bundle.targets=nsis.`);

  const expectedMappings = {
    'gen/resources/node': 'node',
    'gen/resources/copilot-ui': 'copilot-ui',
    'gen/resources/copilot-cli': 'copilot-cli',
    'gen/resources/runtime-manifests': 'runtime-manifests',
    'gen/resources/.cli': '.cli',
    'gen/resources/engine-assets': 'engine-assets',
    'gen/resources/local-tracker': 'local-tracker',
    'gen/resources/scripts': 'scripts',
  };

  for (const [fromPath, toPath] of Object.entries(expectedMappings)) {
    assert(resources[fromPath] === toPath, `Expected ${tauriConfigPath} bundle.resources["${fromPath}"]=${toPath}.`);
  }

  return {
    tauriConfigPath,
    bundleTarget: tauriConfig.bundle.targets,
    resourceMappingCount: Object.keys(expectedMappings).length,
  };
}

function validatePackagedTauriNodeSidecarLayoutMetadata(options = {}) {
  const { workspaceRoot: activeWorkspaceRoot, manifestPath, manifest } = loadTauriNodeSidecarLayout(options);
  const packagedResourcesRoot = path.resolve(options.packagedResourcesRoot || path.join(activeWorkspaceRoot, 'release', 'win-unpacked', 'resources'));
  const packagedManifestPath = path.join(packagedResourcesRoot, manifest.resourceCopies.find((entry) => entry.id === 'runtime-manifests').target, path.basename(manifestPath));
  requireFile('packaged Windows Tauri sidecar layout manifest', packagedManifestPath);
  assert(
    fs.readFileSync(packagedManifestPath, 'utf8') === fs.readFileSync(manifestPath, 'utf8'),
    `Packaged Tauri sidecar layout manifest drifted from source metadata: ${packagedManifestPath}`,
  );

  const packagedPgliteDist = path.join(packagedResourcesRoot, 'app.asar.unpacked', 'node_modules', '@electric-sql', 'pglite', 'dist');
  requireDirectory('packaged Tauri sidecar pglite dist directory', packagedPgliteDist);
  for (const fileName of manifest.pglite.requiredFiles) {
    requireFile(`packaged Tauri sidecar pglite payload ${fileName}`, path.join(packagedPgliteDist, fileName));
  }

  return {
    packagedManifestPath,
    packagedPgliteDist,
  };
}

function validateStagedTauriNodeSidecarLayoutMetadata(options = {}) {
  const { workspaceRoot: activeWorkspaceRoot, manifestPath, manifest } = loadTauriNodeSidecarLayout(options);
  const stagedResourcesRoot = path.resolve(options.stagedResourcesRoot || path.join(activeWorkspaceRoot, 'src-tauri', 'gen', 'resources'));
  const stagedManifestPath = path.join(
    stagedResourcesRoot,
    manifest.resourceCopies.find((entry) => entry.id === 'runtime-manifests').target,
    path.basename(manifestPath),
  );
  requireFile('staged Windows Tauri sidecar layout manifest', stagedManifestPath);
  assert(
    fs.readFileSync(stagedManifestPath, 'utf8') === fs.readFileSync(manifestPath, 'utf8'),
    `Staged Tauri sidecar layout manifest drifted from source metadata: ${stagedManifestPath}`,
  );

  const stagedNodeRuntimePath = path.join(stagedResourcesRoot, manifest.nodeRuntime.relativePath);
  requireFile('staged Windows Node sidecar runtime', stagedNodeRuntimePath);

  const stagedNodeModulesRoot = path.join(stagedResourcesRoot, manifest.nodeModulePayload.targetRoot);
  requireDirectory('staged desktop node_modules root for Tauri sidecar model', stagedNodeModulesRoot);
  for (const packageName of manifest.nodeModulePayload.requiredRuntimePackages || []) {
    requireDirectory(`staged desktop runtime package ${packageName}`, path.join(stagedNodeModulesRoot, ...packageName.split('/')));
  }

  const stagedPgliteDist = path.join(stagedResourcesRoot, manifest.pglite.targetDist);
  requireDirectory('staged Tauri pglite dist directory', stagedPgliteDist);
  for (const fileName of manifest.pglite.requiredFiles) {
    requireFile(`staged Tauri pglite payload ${fileName}`, path.join(stagedPgliteDist, fileName));
  }

  return {
    stagedResourcesRoot,
    stagedManifestPath,
    nodeRuntimeRelativePath: manifest.nodeRuntime.relativePath,
    stagedPgliteDist,
  };
}

module.exports = {
  manifestRelativePath,
  loadTauriNodeSidecarLayout,
  resolveWorkspaceDependencyRoot,
  validateTauriBundleConfig,
  validatePackagedTauriNodeSidecarLayoutMetadata,
  validateStagedTauriNodeSidecarLayoutMetadata,
  validateTauriNodeSidecarLayoutModel,
};
