'use strict';

/**
 * Moon Bridge managed bootstrap helpers.
 *
 * Provides path resolution, status inspection, and a synchronous
 * git-clone + go-build workflow to install Moon Bridge under the
 * managed Copilot CLI directory.
 *
 * All functions accept injectable fs / exec / spawn deps so callers
 * (tests, route handlers) can supply controlled implementations.
 */

const path = require('path');
const defaultExecSync = require('child_process').execSync;
const defaultSpawnSync = require('child_process').spawnSync;

const MOON_BRIDGE_SOURCE_URL = 'https://github.com/ZhiYi-R/moon-bridge.git';
const GIT_CLONE_TIMEOUT_MS = 300_000; // 5 minutes
const GO_BUILD_TIMEOUT_MS = 120_000; // 2 minutes

// ---------------------------------------------------------------------------
// Pure path helpers
// ---------------------------------------------------------------------------

/**
 * @param {string} elegyHome
 * @returns {string} Managed Moon Bridge install root (contains .git after clone).
 */
function resolveManagedMoonBridgeRoot(elegyHome) {
  return path.join(elegyHome, 'managed-cli', 'moon-bridge');
}

/**
 * @param {string} installRoot
 * @param {string} [platform=process.platform]
 * @returns {string} Full path to the compiled moon-bridge binary.
 */
function resolveBinaryPath(installRoot, platform = process.platform) {
  const binaryName = platform === 'win32' ? 'moon-bridge.exe' : 'moon-bridge';
  return path.join(installRoot, 'bin', binaryName);
}

/**
 * @param {string} installRoot
 * @returns {string} Expected config.yml path inside the install root.
 */
function resolveConfigPath(installRoot) {
  return path.join(installRoot, 'config.yml');
}

/**
 * @param {string} installRoot
 * @returns {string} Path to install metadata JSON file.
 */
function resolveBundledMetadataPath(installRoot) {
  return path.join(installRoot, '.install-metadata.json');
}

// ---------------------------------------------------------------------------
// Prerequisite probes
// ---------------------------------------------------------------------------

function probeGitAvailable(fsImpl, execImpl) {
  try {
    execImpl.execSync('git --version', { stdio: 'ignore', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

function probeGoAvailable(fsImpl, execImpl) {
  try {
    execImpl.execSync('go version', { stdio: 'ignore', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/**
 * Resolved and computed bootstrap status.
 *
 * @param {object} options
 * @param {string} options.elegyHome
 * @param {string} [options.platform=process.platform]
 * @param {object|null} [options.existingBootstrapState] - merged from persistent state
 * @param {{ existsSync: function }?} [options.fsImpl]
 * @param {{ execSync: function }?} [options.execImpl]
 * @returns {object}
 */
function getBootstrapStatus(options = {}) {
  const elegyHome = options.elegyHome || '';
  const platform = options.platform || process.platform;
  const fsImpl = options.fsImpl || require('fs');
  const execImpl = options.execImpl || { execSync: defaultExecSync };
  const existing = options.existingBootstrapState || {};

  const installRoot = resolveManagedMoonBridgeRoot(elegyHome);
  const binaryPath = resolveBinaryPath(installRoot, platform);
  const configPath = resolveConfigPath(installRoot);
  const metadataPath = resolveBundledMetadataPath(installRoot);

  const gitAvailable = probeGitAvailable(fsImpl, execImpl);
  const goAvailable = probeGoAvailable(fsImpl, execImpl);
  const installed = fsImpl.existsSync(path.join(installRoot, '.git'));
  const built = fsImpl.existsSync(binaryPath);
  const bundledInstalled = fsImpl.existsSync(metadataPath) && fsImpl.existsSync(binaryPath);
  const bundledSourceAvailable = typeof options.bundledSource === 'string' && fsImpl.existsSync(options.bundledSource);

  return {
    installRoot,
    sourceUrl: MOON_BRIDGE_SOURCE_URL,
    binaryPath,
    configPath,
    metadataPath,
    gitAvailable,
    goAvailable,
    installed,
    built,
    bundledInstalled,
    bundledSourceAvailable,
    lastBootstrapAt: existing.lastBootstrapAt || null,
    lastError: existing.lastError || null,
  };
}

// ---------------------------------------------------------------------------
// Bundled binary install
// ---------------------------------------------------------------------------

/**
 * Copy the bundled Moon Bridge binary into the managed install directory
 * and write metadata.
 *
 * @param {object} options
 * @param {string} options.elegyHome
 * @param {string} options.bundledSource — absolute path to the bundled binary resource
 * @param {string} [options.platform=process.platform]
 * @param {{ existsSync, mkdirSync, writeFileSync, copyFileSync }?} [options.fsImpl]
 * @param {function} [options.sha256Impl] — function (buffer) => hex string
 * @returns {{ success: boolean, status: object, error?: string }}
 */
function installFromBundledBinary(options = {}) {
  const elegyHome = options.elegyHome || '';
  const platform = options.platform || process.platform;
  const bundledSource = options.bundledSource || '';
  const fsImpl = options.fsImpl || require('fs');
  const cryptoImpl = options.cryptoImpl || require('crypto');

  const installRoot = resolveManagedMoonBridgeRoot(elegyHome);
  const binaryPath = resolveBinaryPath(installRoot, platform);
  const configPath = resolveConfigPath(installRoot);
  const metadataPath = resolveBundledMetadataPath(installRoot);
  const now = new Date().toISOString();

  if (!bundledSource || !fsImpl.existsSync(bundledSource)) {
    return {
      success: false,
      status: {
        installRoot,
        sourceUrl: MOON_BRIDGE_SOURCE_URL,
        binaryPath,
        configPath,
        metadataPath,
        gitAvailable: false,
        goAvailable: false,
        installed: false,
        built: false,
        bundledInstalled: false,
        bundledSourceAvailable: false,
        lastBootstrapAt: null,
        lastError: 'Bundled Moon Bridge binary source is not available.',
      },
      error: 'Bundled Moon Bridge binary source is not available.',
    };
  }

  // Ensure install directories exist
  const binDir = path.dirname(binaryPath);
  if (!fsImpl.existsSync(binDir)) {
    fsImpl.mkdirSync(binDir, { recursive: true });
  }

  try {
    // Copy the bundled binary
    if (typeof fsImpl.copyFileSync === 'function') {
      fsImpl.copyFileSync(bundledSource, binaryPath);
    } else {
      // Fallback for environments without copyFileSync
      const content = fsImpl.readFileSync(bundledSource);
      fsImpl.writeFileSync(binaryPath, content);
    }

    // Compute SHA-256 of the installed binary
    let sha256 = '';
    try {
      const buffer = fsImpl.readFileSync(binaryPath);
      sha256 = cryptoImpl.createHash('sha256').update(buffer).digest('hex');
    } catch {
      sha256 = '';
    }

    // Write install metadata
    const metadata = {
      method: 'bundled',
      source: bundledSource,
      copiedPath: binaryPath,
      installedAt: now,
      sha256,
    };
    fsImpl.mkdirSync(path.dirname(metadataPath), { recursive: true });
    fsImpl.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');

    return {
      success: true,
      status: {
        installRoot,
        sourceUrl: MOON_BRIDGE_SOURCE_URL,
        binaryPath,
        configPath,
        metadataPath,
        gitAvailable: false,
        goAvailable: false,
        installed: false,
        built: true,
        bundledInstalled: true,
        bundledSourceAvailable: true,
        lastBootstrapAt: now,
        lastError: null,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      status: {
        installRoot,
        sourceUrl: MOON_BRIDGE_SOURCE_URL,
        binaryPath,
        configPath,
        metadataPath,
        gitAvailable: false,
        goAvailable: false,
        installed: false,
        built: false,
        bundledInstalled: false,
        bundledSourceAvailable: true,
        lastBootstrapAt: null,
        lastError: `Bundled binary install failed: ${message}`,
      },
      error: `Bundled binary install failed: ${message}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Bootstrap execution
// ---------------------------------------------------------------------------

/**
 * Perform the bootstrap pipeline: git clone → go build.
 *
 * Prerequisite checks (`gitAvailable`, `goAvailable`) and progress markers
 * (`installed`, `built`) are re-evaluated during the pipeline. The caller
 * should merge the returned status into persistent state.
 *
 * @param {object} options
 * @param {string} options.elegyHome
 * @param {string} [options.platform=process.platform]
 * @param {boolean} [options.forceRebuild=false] — re-run go build even if binary exists
 * @param {{ existsSync: function, mkdirSync: function, writeFileSync: function }?} [options.fsImpl]
 * @param {{ execSync: function }?} [options.execImpl]
 * @param {{ spawnSync: function }?} [options.spawnImpl]
 * @returns {{ success: boolean, status: object, error?: string }}
 */
function bootstrapMoonBridge(options = {}) {
  const elegyHome = options.elegyHome || '';
  const platform = options.platform || process.platform;
  const forceRebuild = options.forceRebuild === true;
  const fsImpl = options.fsImpl || require('fs');
  const execImpl = options.execImpl || { execSync: defaultExecSync };
  const spawnImpl = options.spawnImpl || { spawnSync: defaultSpawnSync };
  const cryptoImpl = options.cryptoImpl || require('crypto');
  const bundledSource = options.bundledSource || '';

  const installRoot = resolveManagedMoonBridgeRoot(elegyHome);
  const binaryPath = resolveBinaryPath(installRoot, platform);

  // If a bundled binary source is available, use that as the primary install path
  if (bundledSource && fsImpl.existsSync(bundledSource)) {
    // Skip if binary already exists and not forcing rebuild
    if (!forceRebuild && fsImpl.existsSync(binaryPath)) {
      const metadataPath = resolveBundledMetadataPath(installRoot);
      return {
        success: true,
        status: {
          installRoot,
          sourceUrl: MOON_BRIDGE_SOURCE_URL,
          binaryPath,
          configPath: resolveConfigPath(installRoot),
          metadataPath,
          gitAvailable: false,
          goAvailable: false,
          installed: false,
          built: true,
          bundledInstalled: fsImpl.existsSync(metadataPath),
          bundledSourceAvailable: true,
          lastBootstrapAt: new Date().toISOString(),
          lastError: null,
        },
      };
    }

    const result = installFromBundledBinary({
      elegyHome,
      platform,
      bundledSource,
      fsImpl,
      cryptoImpl,
    });

    return {
      success: result.success,
      status: result.status,
      error: result.error,
    };
  }

  // --- git + go source build fallback ---
  const gitAvailable = probeGitAvailable(fsImpl, execImpl);
  const goAvailable = probeGoAvailable(fsImpl, execImpl);

  if (!gitAvailable) {
    return {
      success: false,
      status: {
        installRoot,
        sourceUrl: MOON_BRIDGE_SOURCE_URL,
        binaryPath,
        configPath: resolveConfigPath(installRoot),
        metadataPath: resolveBundledMetadataPath(installRoot),
        gitAvailable: false,
        goAvailable,
        installed: false,
        built: false,
        bundledInstalled: false,
        bundledSourceAvailable: false,
        lastBootstrapAt: null,
        lastError: 'git is not available on this system. Provide a bundled Moon Bridge binary or install git.',
      },
      error: 'git is not available on this system. Provide a bundled Moon Bridge binary or install git.',
    };
  }

  if (!goAvailable) {
    return {
      success: false,
      status: {
        installRoot,
        sourceUrl: MOON_BRIDGE_SOURCE_URL,
        binaryPath,
        configPath: resolveConfigPath(installRoot),
        metadataPath: resolveBundledMetadataPath(installRoot),
        gitAvailable: true,
        goAvailable: false,
        installed: false,
        built: false,
        bundledInstalled: false,
        bundledSourceAvailable: false,
        lastBootstrapAt: null,
        lastError: 'go 1.25+ is not available on this system. Use bundled binary install or install go.',
      },
      error: 'go 1.25+ is not available on this system. Use bundled binary install or install go.',
    };
  }

  // --- git clone ---
  const dotGitPath = path.join(installRoot, '.git');
  if (!fsImpl.existsSync(dotGitPath)) {
    const parentDir = path.dirname(installRoot);
    if (!fsImpl.existsSync(parentDir)) {
      fsImpl.mkdirSync(parentDir, { recursive: true });
    }

    try {
      execImpl.execSync(`git clone ${MOON_BRIDGE_SOURCE_URL} ${quoteArg(installRoot)}`, {
        stdio: 'pipe',
        timeout: GIT_CLONE_TIMEOUT_MS,
      });
    } catch (err) {
      const message = err.stderr ? String(err.stderr).trim() : (err.message || String(err));
      return {
        success: false,
        status: {
          installRoot,
          sourceUrl: MOON_BRIDGE_SOURCE_URL,
          binaryPath,
          configPath: resolveConfigPath(installRoot),
          metadataPath: resolveBundledMetadataPath(installRoot),
          gitAvailable: true,
          goAvailable: true,
          installed: false,
          built: false,
          bundledInstalled: false,
          bundledSourceAvailable: false,
          lastBootstrapAt: null,
          lastError: `git clone failed: ${message}`,
        },
        error: `git clone failed: ${message}`,
      };
    }
  }

  // --- go build ---
  if (!fsImpl.existsSync(binaryPath) || forceRebuild) {
    const binDir = path.dirname(binaryPath);
    if (!fsImpl.existsSync(binDir)) {
      fsImpl.mkdirSync(binDir, { recursive: true });
    }

    try {
      const result = spawnImpl.spawnSync('go', ['build', '-o', binaryPath, '.'], {
        cwd: installRoot,
        stdio: 'pipe',
        timeout: GO_BUILD_TIMEOUT_MS,
        windowsHide: true,
      });
      if (result.status !== 0) {
        const stderr = result.stderr ? String(result.stderr).trim() : 'unknown build error';
        throw new Error(stderr);
      }
    } catch (err) {
      const message = err.stderr ? String(err.stderr).trim() : (err.message || String(err));
      return {
        success: false,
        status: {
          installRoot,
          sourceUrl: MOON_BRIDGE_SOURCE_URL,
          binaryPath,
          configPath: resolveConfigPath(installRoot),
          metadataPath: resolveBundledMetadataPath(installRoot),
          gitAvailable: true,
          goAvailable: true,
          installed: fsImpl.existsSync(dotGitPath),
          built: fsImpl.existsSync(binaryPath),
          bundledInstalled: false,
          bundledSourceAvailable: false,
          lastBootstrapAt: new Date().toISOString(),
          lastError: `go build failed: ${message}`,
        },
        error: `go build failed: ${message}`,
      };
    }
  }

  const now = new Date().toISOString();

  return {
    success: true,
    status: {
      installRoot,
      sourceUrl: MOON_BRIDGE_SOURCE_URL,
      binaryPath,
      configPath: resolveConfigPath(installRoot),
      metadataPath: resolveBundledMetadataPath(installRoot),
      gitAvailable: true,
      goAvailable: true,
      installed: true,
      built: true,
      bundledInstalled: false,
      bundledSourceAvailable: false,
      lastBootstrapAt: now,
      lastError: null,
    },
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function quoteArg(value) {
  // Cross-platform quoting for execSync / spawnSync — on Windows, wrap in
  // double-quotes and escape internal quotes; on POSIX, use single quotes.
  if (process.platform === 'win32') {
    return `"${String(value).replace(/"/g, '\\"')}"`;
  }
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  MOON_BRIDGE_SOURCE_URL,
  resolveManagedMoonBridgeRoot,
  resolveBinaryPath,
  resolveConfigPath,
  resolveBundledMetadataPath,
  getBootstrapStatus,
  bootstrapMoonBridge,
  installFromBundledBinary,
};
