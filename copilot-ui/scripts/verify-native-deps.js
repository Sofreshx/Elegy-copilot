'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const workspaceRoot = path.resolve(__dirname, '..');

const MANIFEST_RELATIVE_PATH = path.join(
  'resources', 'runtime-manifests', 'windows-tauri-node-sidecar.json',
);

/**
 * Hardcoded fallback native package requirements.
 * Used when the manifest does not include nativeRuntimePackageRequirements.
 */
const FALLBACK_REQUIREMENTS = {
  'better-sqlite3': {
    requiredFiles: ['build/Release/better_sqlite3.node'],
  },
  '@photostructure/sqlite-vec': {
    requiredFiles: [`dist/${process.platform}-${process.arch}/vec0.dll`],
  },
};

// ---- helpers (matching existing script conventions) ----

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function readJson(filePath, label) {
  assert(fs.existsSync(filePath), `Missing ${label}: ${filePath}`);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

// ---- requirement loading ----

function getNativePackageRequirements(manifestPath) {
  if (fs.existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      if (
        manifest.nativeRuntimePackageRequirements &&
        typeof manifest.nativeRuntimePackageRequirements === 'object' &&
        Object.keys(manifest.nativeRuntimePackageRequirements).length > 0
      ) {
        return manifest.nativeRuntimePackageRequirements;
      }
    } catch {
      // fall through to hardcoded fallback
    }
  }
  return FALLBACK_REQUIREMENTS;
}

// ---- repair ----

/**
 * Resolve the npm CLI entry point.
 *
 * Priority:
 *   1. Bundled alongside Node.js at <node-root>/node_modules/npm/bin/npm-cli.js.
 *   2. Module resolution (works when npm is installed as a package).
 */
function resolveNpmCliPath() {
  const nodeRoot = path.dirname(process.execPath);
  const bundled = path.join(nodeRoot, 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (fs.existsSync(bundled)) {
    return bundled;
  }
  try {
    return require.resolve('npm/bin/npm-cli');
  } catch {
    return null;
  }
}

function tryRepair(workspaceRootDir, packageName) {
  const npmCli = resolveNpmCliPath();
  if (!npmCli) {
    console.error(`[verify:native-deps] cannot locate npm CLI for repair of ${packageName}`);
    return false;
  }

  const env = {
    ...process.env,
    npm_config_build_from_source: 'true',
  };

  const result = spawnSync(
    process.execPath,
    [npmCli, 'rebuild', packageName, '--build-from-source'],
    {
      cwd: workspaceRootDir,
      env,
      stdio: 'pipe',
      encoding: 'utf8',
      timeout: 120_000,
    },
  );

  if (result.error) {
    console.error(`[verify:native-deps] repair spawn error for ${packageName}: ${result.error.message}`);
    return false;
  }

  if (result.status !== 0) {
    const stderrPreview = (result.stderr || '').split('\n').slice(0, 5).join('\n');
    console.error(`[verify:native-deps] repair failed for ${packageName} (exit=${result.status}): ${stderrPreview}`);
    return false;
  }

  return true;
}

// ---- verification ----

/**
 * Try to require a package using explicit node_modules search paths.
 * Clears the require cache entry so re-verification works after repair.
 */
function tryRequirePackage(packageName, nodeModulesRoot) {
  const searchPaths = [
    nodeModulesRoot,
    path.resolve(nodeModulesRoot, '..'),
  ];

  let resolvedPath;
  try {
    resolvedPath = require.resolve(packageName, { paths: searchPaths });
  } catch {
    // not resolvable at all
    return false;
  }

  try {
    delete require.cache[resolvedPath];
    require(resolvedPath);
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[verify:native-deps] require() failed for ${packageName}: ${msg}`);
    return false;
  }
}

/**
 * Verify a single native package.
 *
 * Checks:
 *   1. Package directory exists under node_modules.
 *   2. Each required file (relative to package root) exists.
 *   3. If the required files include a .node binding, require() the package
 *      to catch ABI mismatches. Otherwise still try require() as a generic
 *      health check (covers packages like @photostructure/sqlite-vec whose
 *      main entry is JS but checks for loadability).
 */
function resolvePackageDir(packageName, nodeModulesRoot) {
  const parts = packageName.split('/');
  const candidates = [
    path.join(nodeModulesRoot, ...parts),
    path.resolve(nodeModulesRoot, '..', 'node_modules', ...parts),
    path.resolve(nodeModulesRoot, '..', '..', 'node_modules', ...parts),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
    }
  }
  return null;
}

function verifySinglePackage(activeWorkspaceRoot, packageName, pkgConfig, nodeModulesRoot) {
  const packageDir = resolvePackageDir(packageName, nodeModulesRoot);
  const requiredFiles = pkgConfig.requiredFiles || [];

  // 1. Package directory
  if (!packageDir) {
    const fallback = path.join(nodeModulesRoot, ...packageName.split('/'));
    console.error(`[verify:native-deps] missing package directory: ${fallback}`);
    return false;
  }

  // 2. Required files
  for (const fileRel of requiredFiles) {
    const filePath = path.join(packageDir, fileRel);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      console.error(`[verify:native-deps] missing required file for ${packageName}: ${fileRel}`);
      return false;
    }
  }

  // 3. require() check — always try, but only treat as blocking failure
  //    when the package contains .node bindings (truly native Node addons).
  const hasNodeBinding = requiredFiles.some((f) => f.endsWith('.node'));
  const requireOk = tryRequirePackage(packageName, nodeModulesRoot);

  if (hasNodeBinding && !requireOk) {
    // .node binding exists but require() failed (ABI mismatch or missing binary)
    return false;
  }

  return true;
}

// ---- main entrypoint ----

/**
 * Verify all native runtime package dependencies.
 *
 * @param {object} [options]
 * @param {string} [options.workspaceRoot]  Path to copilot-ui workspace root
 *   (defaults to the parent of the scripts directory).
 * @param {string} [options.manifestPath]   Path to the runtime sidecar manifest.
 *   (defaults to <workspaceRoot>/resources/runtime-manifests/windows-tauri-node-sidecar.json).
 * @returns {{ verified: string[], repaired: string[], failed: string[] }}
 */
function verifyNativeDeps(options = {}) {
  const activeWorkspaceRoot = path.resolve(options.workspaceRoot || workspaceRoot);
  const manifestPath = options.manifestPath
    || path.join(activeWorkspaceRoot, MANIFEST_RELATIVE_PATH);

  const requirements = getNativePackageRequirements(manifestPath);
  const nodeModulesRoot = path.join(activeWorkspaceRoot, 'node_modules');

  const result = { verified: [], repaired: [], failed: [] };

  for (const [packageName, pkgConfig] of Object.entries(requirements)) {
    const ok = verifySinglePackage(activeWorkspaceRoot, packageName, pkgConfig, nodeModulesRoot);

    if (ok) {
      result.verified.push(packageName);
      continue;
    }

    // ---- repair attempt ----
    console.error(`[verify:native-deps] verification failed for ${packageName}; attempting rebuild...`);
    const repairOk = tryRepair(activeWorkspaceRoot, packageName);

    if (!repairOk) {
      result.failed.push(packageName);
      continue;
    }

    // ---- re-verify after repair ----
    const recheckOk = verifySinglePackage(activeWorkspaceRoot, packageName, pkgConfig, nodeModulesRoot);
    if (recheckOk) {
      result.repaired.push(packageName);
    } else {
      result.failed.push(packageName);
    }
  }

  return result;
}

// ---- CLI ----

function parseCliArgs(argv) {
  const args = { workspaceRoot: undefined, manifestPath: undefined };
  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case '--workspace-root':
        args.workspaceRoot = argv[++i];
        break;
      case '--manifest-path':
        args.manifestPath = argv[++i];
        break;
      default:
        // ignore unknown
        break;
    }
  }
  return args;
}

function runCli() {
  const cliArgs = parseCliArgs(process.argv);
  let result;
  try {
    result = verifyNativeDeps(cliArgs);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`[verify:native-deps] FAILED: ${detail}`);
    process.exit(1);
  }

  if (result.failed.length > 0) {
    console.error(
      `[verify:native-deps] FAILED: ${result.failed.length} package(s) unrecoverable: ${result.failed.join(', ')}`,
    );
    if (result.repaired.length > 0) {
      console.error(`[verify:native-deps] repaired ${result.repaired.length} package(s): ${result.repaired.join(', ')}`);
    }
    process.exit(1);
  }

  if (result.repaired.length > 0) {
    console.log(`[verify:native-deps] repaired ${result.repaired.length} package(s): ${result.repaired.join(', ')}`);
    process.exit(0);
  }

  console.log('[verify:native-deps] all native deps verified');
  process.exit(0);
}

if (require.main === module) {
  runCli();
}

module.exports = { verifyNativeDeps };
