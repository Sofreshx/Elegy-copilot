'use strict';

const fs = require('fs');
const path = require('path');

const {
  loadTauriNodeSidecarLayout,
  resolveWorkspaceDependencyRoot,
  validateTauriBundleConfig,
  validateTauriNodeSidecarLayoutModel,
} = require('./tauri-node-sidecar-layout');
const { resolveDesktopReleaseChannelContract } = require('./desktop-release-policy');
const { removeTarget } = require('./clean-tauri-release');

const workspaceRoot = path.resolve(__dirname, '..');
const stagedResourcesRoot = path.join(workspaceRoot, 'src-tauri', 'gen', 'resources');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function ensureCleanDir(targetPath) {
  removeTarget(targetPath);
  fs.mkdirSync(targetPath, { recursive: true });
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

function copyFile(sourcePath, targetPath) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
}

function readJson(filePath, label) {
  assert(fs.existsSync(filePath), `Missing ${label}: ${filePath}`);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function copyDirectory(sourceRoot, targetRoot, filters) {
  if (!Array.isArray(filters) || filters.length === 0) {
    fs.cpSync(sourceRoot, targetRoot, {
      recursive: true,
      dereference: true,
      force: true,
    });
    return collectFiles(sourceRoot).length;
  }

  const files = collectFiles(sourceRoot).filter((filePath) => filters.some((pattern) => globToRegExp(pattern).test(filePath)));
  assert(files.length > 0, `No files matched requested filters ${filters.join(', ')} under ${sourceRoot}`);
  for (const relativeFilePath of files) {
    copyFile(path.join(sourceRoot, relativeFilePath), path.join(targetRoot, relativeFilePath));
  }
  return files.length;
}

function resolvePackagePathSegments(packageName) {
  const segments = String(packageName || '').trim().split('/').filter(Boolean);
  const isScopedPackage = String(packageName || '').startsWith('@');
  assert(segments.length > 0, `Invalid package name ${packageName || '(empty)'}.`);
  assert(!isScopedPackage || segments.length === 2, `Scoped package names must include a scope and name: ${packageName}.`);
  return segments;
}

function resolveInstalledPackageMountPath(startPath, packageName) {
  const packageSegments = resolvePackagePathSegments(packageName);
  let currentPath = path.resolve(startPath);

  while (true) {
    const candidatePath = path.basename(currentPath) === 'node_modules'
      ? path.join(currentPath, ...packageSegments)
      : path.join(currentPath, 'node_modules', ...packageSegments);
    if (fs.existsSync(candidatePath)) {
      return candidatePath;
    }

    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) {
      break;
    }
    currentPath = parentPath;
  }

  throw new Error(`Unable to resolve installed runtime dependency ${packageName} from ${startPath}`);
}

function listRuntimeDependencies(packageJson) {
  return {
    required: Array.from(new Set(Object.keys(packageJson.dependencies || {}))).sort(),
    optional: Array.from(new Set(Object.keys(packageJson.optionalDependencies || {}))).sort(),
  };
}

function stageRuntimeNodeModules(options) {
  const {
    sourceRoot,
    targetRoot,
    requiredRuntimePackages,
    logger = () => {},
  } = options;
  fs.mkdirSync(targetRoot, { recursive: true });

  const visitedMountPaths = new Set();
  const stagedPackagePaths = [];
  const pendingPackages = requiredRuntimePackages.map((packageName) => ({
    packageName,
    requesterPath: sourceRoot,
    optional: false,
  }));

  while (pendingPackages.length > 0) {
    const { packageName, requesterPath, optional } = pendingPackages.shift();
    const sourcePackagePath = resolveInstalledPackageMountPath(requesterPath, packageName);
    const sourcePackageManifestPath = path.join(sourcePackagePath, 'package.json');
    if (!fs.existsSync(sourcePackageManifestPath)) {
      if (optional) {
        logger(`[tauri-win-bundle] skipping optional runtime package ${packageName} (missing package.json)`);
        continue;
      }
      throw new Error(`Missing runtime package manifest for ${packageName}: ${sourcePackageManifestPath}`);
    }
    const relativePackagePath = path.relative(sourceRoot, sourcePackagePath);
    assert(
      relativePackagePath && !relativePackagePath.startsWith('..') && !path.isAbsolute(relativePackagePath),
      `Resolved runtime dependency ${packageName} escaped ${sourceRoot}: ${sourcePackagePath}`,
    );

    const normalizedRelativePath = relativePackagePath.split(path.sep).join('/');
    if (visitedMountPaths.has(normalizedRelativePath)) {
      continue;
    }

    logger(`[tauri-win-bundle] staging runtime package ${normalizedRelativePath}`);
    fs.cpSync(sourcePackagePath, path.join(targetRoot, relativePackagePath), {
      recursive: true,
      dereference: true,
      force: true,
    });
    visitedMountPaths.add(normalizedRelativePath);
    stagedPackagePaths.push(normalizedRelativePath);

    const packageJson = readJson(sourcePackageManifestPath, `runtime package manifest for ${packageName}`);
    const runtimeDependencies = listRuntimeDependencies(packageJson);
    for (const dependencyName of runtimeDependencies.required) {
      pendingPackages.push({
        packageName: dependencyName,
        requesterPath: sourcePackagePath,
        optional: false,
      });
    }

    for (const dependencyName of runtimeDependencies.optional) {
      try {
        resolveInstalledPackageMountPath(sourcePackagePath, dependencyName);
        pendingPackages.push({
          packageName: dependencyName,
          requesterPath: sourcePackagePath,
          optional: true,
        });
      } catch (error) {
        logger(`[tauri-win-bundle] skipping optional runtime package ${dependencyName} (not installed)`);
      }
    }
  }

  return {
    stagedPackagePaths,
    stagedPackageCount: stagedPackagePaths.length,
  };
}

function resolveNodeExecutable() {
  const overridePath = String(process.env.INSTRUCTION_ENGINE_TAURI_WINDOWS_NODE_EXECUTABLE || '').trim();
  if (overridePath) {
    const resolvedOverride = path.resolve(overridePath);
    assert(fs.existsSync(resolvedOverride), `Configured INSTRUCTION_ENGINE_TAURI_WINDOWS_NODE_EXECUTABLE was not found: ${resolvedOverride}`);
    assert(path.basename(resolvedOverride).toLowerCase() === 'node.exe', `Configured Windows Node executable must end in node.exe: ${resolvedOverride}`);
    return resolvedOverride;
  }

  const resolvedExecutable = path.resolve(process.execPath);
  assert(path.basename(resolvedExecutable).toLowerCase() === 'node.exe', `Expected packaging host to run under node.exe, received ${resolvedExecutable}`);
  return resolvedExecutable;
}

function prepareTauriWindowsBundle(options = {}) {
  const activeWorkspaceRoot = path.resolve(options.workspaceRoot || workspaceRoot);
  const logger = typeof options.logger === 'function' ? options.logger : () => {};
  const explicitChannel = process.env.INSTRUCTION_ENGINE_UPDATE_CHANNEL;
  const packageJsonPath = path.join(activeWorkspaceRoot, 'package.json');
  const packageJson = readJson(packageJsonPath, 'desktop package.json');
  const releaseContract = resolveDesktopReleaseChannelContract({
    appVersion: packageJson.version,
    explicitChannel,
  });

  assert(releaseContract.ok, `Tauri Windows release lane is blocked: ${releaseContract.reason} (${releaseContract.explicitChannel || 'unknown'})`);

  validateTauriNodeSidecarLayoutModel({ workspaceRoot: activeWorkspaceRoot });
  validateTauriBundleConfig({ workspaceRoot: activeWorkspaceRoot });

  const { manifest } = loadTauriNodeSidecarLayout({ workspaceRoot: activeWorkspaceRoot });
  assert(manifest.releaseLane && manifest.releaseLane.updateMode === 'tauri_signed_updater', 'Expected Tauri release lane to use the signed Tauri updater.');

  logger(`[tauri-win-bundle] preparing ${manifest.resourceCopies.length} resource copy group(s) under ${stagedResourcesRoot}`);
  ensureCleanDir(stagedResourcesRoot);

  let copiedResourceCount = 0;
  let moonBridgeStaged = false;
  for (const resource of manifest.resourceCopies) {
    const sourcePath = path.resolve(activeWorkspaceRoot, resource.source);
    const targetPath = path.join(stagedResourcesRoot, resource.target);
    logger(`[tauri-win-bundle] copying ${resource.id} (${resource.kind}) -> ${resource.target}`);
    if (resource.kind === 'file') {
      if (resource.id === 'moon-bridge-binary' && !fs.existsSync(sourcePath)) {
        logger(`[tauri-win-bundle] skipping moon-bridge-binary: source not found at ${sourcePath} (runtime will fall back to git+go build)`);
        continue;
      }
      copyFile(sourcePath, targetPath);
      copiedResourceCount += 1;
      if (resource.id === 'moon-bridge-binary') {
        moonBridgeStaged = true;
      }
      continue;
    }

    copiedResourceCount += copyDirectory(sourcePath, targetPath, resource.filter);
  }

  if (moonBridgeStaged) {
    const stagedMoonBridgePath = path.join(stagedResourcesRoot, 'moon-bridge', 'moon-bridge.exe');
    if (!fs.existsSync(stagedMoonBridgePath)) {
      logger(`[tauri-win-bundle] WARNING: moon-bridge-binary was declared in manifest but not found at staged target: ${stagedMoonBridgePath}`);
    } else {
      logger(`[tauri-win-bundle] moon-bridge-binary staged successfully at ${stagedMoonBridgePath}`);
    }
  } else {
    // Ensure the moon-bridge resource directory exists (Tauri expects it per tauri.conf.json)
    const moonBridgeDir = path.join(stagedResourcesRoot, 'moon-bridge');
    if (!fs.existsSync(moonBridgeDir)) {
      fs.mkdirSync(moonBridgeDir, { recursive: true });
      logger(`[tauri-win-bundle] created empty moon-bridge resource directory (binary not staged; runtime will fall back to git+go build)`);
    }
  }

  const nodeExecutablePath = resolveNodeExecutable();
  logger(`[tauri-win-bundle] copying bundled Node runtime -> ${manifest.nodeRuntime.relativePath}`);
  copyFile(nodeExecutablePath, path.join(stagedResourcesRoot, manifest.nodeRuntime.relativePath));

  const nodeModulesSourceRoot = resolveWorkspaceDependencyRoot(
    activeWorkspaceRoot,
    manifest.nodeModulePayload.sourceRoot,
    manifest.nodeModulePayload.requiredRuntimePackages,
  );
  const nodeModulesTargetRoot = path.join(stagedResourcesRoot, manifest.nodeModulePayload.targetRoot);
  logger(
    `[tauri-win-bundle] staging runtime node_modules closure from `
    + `${manifest.nodeModulePayload.requiredRuntimePackages.join(', ')}`,
  );
  const runtimeNodeModules = stageRuntimeNodeModules({
    sourceRoot: nodeModulesSourceRoot,
    targetRoot: nodeModulesTargetRoot,
    requiredRuntimePackages: manifest.nodeModulePayload.requiredRuntimePackages,
    logger,
  });

  return {
    stagedResourcesRoot,
    copiedResourceCount,
    stagedRuntimePackageCount: runtimeNodeModules.stagedPackageCount,
    nodeExecutablePath,
    nodeRuntimeRelativePath: manifest.nodeRuntime.relativePath,
    nodeModulesTargetRoot: manifest.nodeModulePayload.targetRoot,
    channel: releaseContract.contract.channel,
  };
}

if (require.main === module) {
  try {
    const result = prepareTauriWindowsBundle({
      logger: (message) => console.log(message),
    });
    console.log(
      `[tauri-win-bundle] staged ${result.copiedResourceCount} resource payload(s); `
      + `runtimePackages=${result.stagedRuntimePackageCount}; `
      + `node=${result.nodeRuntimeRelativePath}; nodeSource=${result.nodeExecutablePath}; `
      + `nodeModules=${result.nodeModulesTargetRoot}; channel=${result.channel}.`,
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[tauri-win-bundle] ${detail}`);
    process.exit(1);
  }
}

module.exports = {
  prepareTauriWindowsBundle,
  resolveNodeExecutable,
  stagedResourcesRoot,
};
