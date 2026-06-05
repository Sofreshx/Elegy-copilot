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
 * @param {string} copilotHome
 * @returns {string} Managed Moon Bridge install root (contains .git after clone).
 */
function resolveManagedMoonBridgeRoot(copilotHome) {
  return path.join(copilotHome, 'managed-cli', 'moon-bridge');
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
 * @returns {string} Expected config.yaml path inside the cloned repo.
 */
function resolveConfigPath(installRoot) {
  return path.join(installRoot, 'config.yaml');
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
 * @param {string} options.copilotHome
 * @param {string} [options.platform=process.platform]
 * @param {object|null} [options.existingBootstrapState] - merged from persistent state
 * @param {{ existsSync: function }?} [options.fsImpl]
 * @param {{ execSync: function }?} [options.execImpl]
 * @returns {object}
 */
function getBootstrapStatus(options = {}) {
  const copilotHome = options.copilotHome || '';
  const platform = options.platform || process.platform;
  const fsImpl = options.fsImpl || require('fs');
  const execImpl = options.execImpl || { execSync: defaultExecSync };
  const existing = options.existingBootstrapState || {};

  const installRoot = resolveManagedMoonBridgeRoot(copilotHome);
  const binaryPath = resolveBinaryPath(installRoot, platform);
  const configPath = resolveConfigPath(installRoot);

  const gitAvailable = probeGitAvailable(fsImpl, execImpl);
  const goAvailable = probeGoAvailable(fsImpl, execImpl);
  const installed = fsImpl.existsSync(path.join(installRoot, '.git'));
  const built = fsImpl.existsSync(binaryPath);

  return {
    installRoot,
    sourceUrl: MOON_BRIDGE_SOURCE_URL,
    binaryPath,
    configPath,
    gitAvailable,
    goAvailable,
    installed,
    built,
    lastBootstrapAt: existing.lastBootstrapAt || null,
    lastError: existing.lastError || null,
  };
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
 * @param {string} options.copilotHome
 * @param {string} [options.platform=process.platform]
 * @param {boolean} [options.forceRebuild=false] — re-run go build even if binary exists
 * @param {{ existsSync: function, mkdirSync: function, writeFileSync: function }?} [options.fsImpl]
 * @param {{ execSync: function }?} [options.execImpl]
 * @param {{ spawnSync: function }?} [options.spawnImpl]
 * @returns {{ success: boolean, status: object, error?: string }}
 */
function bootstrapMoonBridge(options = {}) {
  const copilotHome = options.copilotHome || '';
  const platform = options.platform || process.platform;
  const forceRebuild = options.forceRebuild === true;
  const fsImpl = options.fsImpl || require('fs');
  const execImpl = options.execImpl || { execSync: defaultExecSync };
  const spawnImpl = options.spawnImpl || { spawnSync: defaultSpawnSync };

  const installRoot = resolveManagedMoonBridgeRoot(copilotHome);
  const binaryPath = resolveBinaryPath(installRoot, platform);

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
        gitAvailable: false,
        goAvailable,
        installed: false,
        built: false,
        lastBootstrapAt: null,
        lastError: 'git is not available on this system.',
      },
      error: 'git is not available on this system.',
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
        gitAvailable: true,
        goAvailable: false,
        installed: false,
        built: false,
        lastBootstrapAt: null,
        lastError: 'go is not available on this system.',
      },
      error: 'go is not available on this system.',
    };
  }

  // --- git clone ---
  const dotGitPath = path.join(installRoot, '.git');
  if (!fsImpl.existsSync(dotGitPath)) {
    // Ensure parent directory exists
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
          gitAvailable: true,
          goAvailable: true,
          installed: false,
          built: false,
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
      const buildCmd = `go build -o ${quoteArg(binaryPath)} .`;
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
          gitAvailable: true,
          goAvailable: true,
          installed: fsImpl.existsSync(dotGitPath),
          built: fsImpl.existsSync(binaryPath),
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
      gitAvailable: true,
      goAvailable: true,
      installed: true,
      built: true,
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
  getBootstrapStatus,
  bootstrapMoonBridge,
};
