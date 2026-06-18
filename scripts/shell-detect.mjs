#!/usr/bin/env node

import { execSync as defaultExecSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// --- Constants ---

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const COMMON_GIT_BASH_PATHS = [
  'C:\\Program Files\\Git\\bin\\bash.exe',
  'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
];

const GIT_BASH_REG_KEY = 'HKEY_LOCAL_MACHINE\\SOFTWARE\\GitForWindows';

// --- Helpers ---

function notWindows() {
  return process.platform !== 'win32';
}

function resolveOptions(options = {}) {
  return {
    timeout: options.timeout ?? 3000,
    skipSlowProbes: options.skipSlowProbes === true,
    execSync: options.execSync || defaultExecSync,
    fsModule: options.fsModule || fs,
  };
}

/**
 * Probe whether `command` (with optional string args appended) succeeds
 * within `timeout` ms. Returns stdout on success, null on failure.
 */
function probe(command, argsStr, timeout, execSyncFn) {
  const cmd = argsStr ? `${command} ${argsStr}` : command;
  try {
    return execSyncFn(cmd, { timeout, encoding: 'utf8' });
  } catch {
    return null;
  }
}

// --- Detectors ---

function detectWsl(opts) {
  const stdout = probe('wsl.exe', '--status', opts.timeout, opts.execSync);
  if (stdout && stdout.includes('Default Distribution')) {
    return { type: 'wsl', path: 'wsl.exe', posix: true, available: true };
  }
  return null;
}

function detectGitBash(opts) {
  const { timeout, execSync, fsModule } = opts;

  // 1. Environment variable override
  const envPath = process.env.OPENCODE_GIT_BASH_PATH;
  if (envPath) {
    try {
      fsModule.accessSync(envPath, fs.constants.X_OK);
      return { type: 'gitbash', path: envPath, posix: true, available: true };
    } catch {
      // env var path not valid, fall through
    }
  }

  // 2. `where bash.exe` (or `command -v` on Unix-like shells on Windows)
  const whereResult = probe('where', 'bash.exe', timeout, execSync);
  if (whereResult) {
    const firstLine = whereResult.trim().split('\n')[0].trim();
    if (firstLine) {
      try {
        fsModule.accessSync(firstLine, fs.constants.X_OK);
        return { type: 'gitbash', path: firstLine, posix: true, available: true };
      } catch {
        // PATH result not executable, fall through
      }
    }
  }

  // 3. Common install paths
  for (const bashPath of COMMON_GIT_BASH_PATHS) {
    try {
      fsModule.accessSync(bashPath, fs.constants.X_OK);
      return { type: 'gitbash', path: bashPath, posix: true, available: true };
    } catch {
      // not found at this path
    }
  }

  // 4. Windows Registry (skip if slow probes disabled)
  if (!opts.skipSlowProbes) {
    const regResult = probe(
      'reg',
      `query "${GIT_BASH_REG_KEY}" /v InstallPath`,
      timeout,
      execSync,
    );
    if (regResult) {
      const match = regResult.match(/InstallPath\s+REG_SZ\s+(.+)/);
      if (match) {
        const gitInstallPath = match[1].trim();
        const bashPath = path.join(gitInstallPath, 'bin', 'bash.exe');
        try {
          fsModule.accessSync(bashPath, fs.constants.X_OK);
          return { type: 'gitbash', path: bashPath, posix: true, available: true };
        } catch {
          // registry path not valid
        }
      }
    }
  }

  return null;
}

function detectCoreutils(opts) {
  if (opts.skipSlowProbes) return null;

  // winget can be slow; use a longer timeout
  const result = probe('winget', 'list Microsoft.Coreutils', 5000, opts.execSync);
  if (result !== null) {
    return { type: 'coreutils', path: 'pwsh.exe', posix: false, available: true };
  }
  return null;
}

function detectPwsh(opts) {
  const result = probe('where', 'pwsh.exe', opts.timeout, opts.execSync);
  if (result !== null) {
    return { type: 'pwsh', path: 'pwsh.exe', posix: false, available: true };
  }
  return null;
}

function detectPowershell(opts) {
  const result = probe('where', 'powershell.exe', opts.timeout, opts.execSync);
  if (result !== null) {
    return { type: 'powershell', path: 'powershell.exe', posix: false, available: true };
  }
  return null;
}

// --- Public API ---

/**
 * Returns array of available shells, ranked best first.
 * Each entry: { type, path, posix, available }
 *
 * Options:
 *   timeout       — default 3000ms per probe
 *   skipSlowProbes — skip winget and registry (default false)
 *   execSync      — inject mock execSync for testing
 *   fsModule      — inject mock fs for testing
 */
export async function detect(options = {}) {
  if (notWindows()) return [];

  const opts = resolveOptions(options);
  const results = [];

  // Ordered by preference (best first)
  for (const detector of [detectWsl, detectGitBash, detectCoreutils, detectPwsh, detectPowershell]) {
    const entry = detector(opts);
    if (entry) results.push(entry);
  }

  return results;
}

/**
 * Returns the single best available shell entry, or null if none found.
 */
export async function getBestShell(options = {}) {
  const shells = await detect(options);
  return shells.length > 0 ? shells[0] : null;
}

// --- CLI ---

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  if (process.argv.includes('--json')) {
    const shell = await getBestShell();
    process.stdout.write(JSON.stringify(shell, null, 2) + '\n');
  }
}
