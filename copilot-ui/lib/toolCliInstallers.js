'use strict';

/**
 * @typedef {Object} CliToolStatus
 * @property {string} id
 * @property {string} label
 * @property {string} command
 * @property {string} packageName
 * @property {boolean} installed
 * @property {string|null} version
 * @property {string} installCommand
 * @property {string|null} lastError
 */

/**
 * @typedef {Object} InstallResult
 * @property {boolean} ok
 * @property {string} toolId
 * @property {string|null} version
 * @property {string|null} error
 */

/** @type {Array<{id: string, label: string, command: string, packageName: string, installCommand: string}>} */
const KNOWN_CLI_TOOLS = [
  {
    id: 'codex-cli',
    label: 'Codex CLI',
    command: 'codex',
    packageName: '@openai/codex',
    installCommand: 'npm install -g @openai/codex',
  },
  {
    id: 'opencode-cli',
    label: 'OpenCode CLI',
    command: 'opencode',
    packageName: 'opencode-ai',
    installCommand: 'npm install -g opencode-ai',
  },
  {
    id: 'claude-code-cli',
    label: 'Claude Code CLI',
    command: 'claude',
    packageName: '@anthropic-ai/claude-code',
    installCommand: 'npm install -g @anthropic-ai/claude-code',
  },
  {
    id: 'gemini-cli',
    label: 'Gemini CLI',
    command: 'gemini',
    packageName: 'gemini-cli',
    installCommand: 'npm install -g gemini-cli',
  },
];

/**
 * Look up a tool definition by id.
 * @param {string} toolId
 * @returns {typeof KNOWN_CLI_TOOLS[number]}
 */
function findTool(toolId) {
  const tool = KNOWN_CLI_TOOLS.find((t) => t.id === toolId);
  if (!tool) {
    throw new Error(`Unknown CLI tool id: "${toolId}". Known tools: ${KNOWN_CLI_TOOLS.map((t) => t.id).join(', ')}`);
  }
  return tool;
}

/**
 * Probe a single CLI tool and return its status.
 *
 * @param {string} toolId
 * @param {Function} [spawnSyncImpl] - Optional spawnSync mock for testing.
 * @returns {CliToolStatus}
 */
function getCliToolStatus(toolId, spawnSyncImpl) {
  const tool = findTool(toolId);
  const spawnSync = spawnSyncImpl || require('child_process').spawnSync;

  /** @type {CliToolStatus} */
  const status = {
    id: tool.id,
    label: tool.label,
    command: tool.command,
    packageName: tool.packageName,
    installed: false,
    version: null,
    installCommand: tool.installCommand,
    lastError: null,
  };

  try {
    const result = spawnSync(tool.command, ['--version'], {
      encoding: 'utf-8',
      timeout: 15000,
      windowsHide: true,
    });

    if (result.error) {
      // ENOENT or other system error — tool is not available
      status.installed = false;
      status.lastError = result.error.message || String(result.error);
      return status;
    }

    if (result.status !== 0) {
      // Non-zero exit — tool exists but --version failed
      status.installed = false;
      const stderr = (result.stderr || '').trim();
      const stdout = (result.stdout || '').trim();
      status.lastError = stderr || stdout || `exit code ${result.status}`;
      return status;
    }

    // Exit code 0 — tool is installed regardless of output content
    status.installed = true;
    const raw = (result.stdout || '').trim();
    status.version = raw.length > 0 ? raw : null;
  } catch (err) {
    status.installed = false;
    status.lastError = err.message || String(err);
  }

  return status;
}

/**
 * Return status objects for all known CLI tools.
 *
 * @param {Function} [spawnSyncImpl] - Optional spawnSync mock for testing.
 * @returns {CliToolStatus[]}
 */
function listCliToolStatuses(spawnSyncImpl) {
  return KNOWN_CLI_TOOLS.map((tool) => getCliToolStatus(tool.id, spawnSyncImpl));
}

/**
 * Check whether npm is available on the system PATH.
 *
 * Uses spawnSync to run `npm --version` with a 5-second timeout.
 * Returns true if npm exits with code 0, false otherwise.
 *
 * @returns {boolean}
 */
function isNpmAvailable() {
  try {
    const { execSync } = require('child_process');
    execSync('npm --version', {
      timeout: 5000,
      windowsHide: true,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Install a CLI tool via `npm install -g <packageName>`.
 * Uses child_process.execFile asynchronously to avoid blocking the event loop.
 *
 * @param {string} toolId
 * @param {Function} [execImpl] - Optional execFile mock for testing. Must follow
 *   the signature: execFile(cmd, args, opts, cb) where cb is (error, stdout, stderr).
 * @returns {Promise<InstallResult>}
 */
async function installCliTool(toolId, execImpl) {
  const tool = findTool(toolId);

  // Pre-check: is npm available?
  if (!isNpmAvailable()) {
    return {
      ok: false,
      toolId,
      version: null,
      error: 'npm is not available on this system. Install Node.js (which includes npm) from https://nodejs.org/',
    };
  }

  const execFile = execImpl || require('child_process').execFile;

  return new Promise((resolve) => {
    execFile('npm', ['install', '-g', tool.packageName], {
      timeout: 120000,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error) {
        if (error.code === 'ENOENT') {
          resolve({ ok: false, toolId, version: null, error: 'npm is not available on this system' });
          return;
        }
        const stderrMsg = (stderr || '').trim();
        resolve({ ok: false, toolId, version: null, error: stderrMsg || error.message || String(error) });
        return;
      }
      // Success — run --version to capture new version (still sync for this quick check)
      const freshStatus = getCliToolStatus(toolId);
      resolve({ ok: true, toolId, version: freshStatus.installed ? freshStatus.version : null, error: null });
    });
  });
}

module.exports = {
  KNOWN_CLI_TOOLS,
  getCliToolStatus,
  listCliToolStatuses,
  installCliTool,
  isNpmAvailable,
};
