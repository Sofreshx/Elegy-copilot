'use strict';

/**
 * Google Drive sync for the Obsidian vault.
 * Uses rclone as backend — no Google Cloud Console needed.
 *
 * Setup (one-time):
 *   1. Install managed rclone from the Notes UI, or set IE_RCLONE_PATH.
 *   2. Run: rclone config
 *      - Select "n" for new remote
 *      - Name: "DevVault" (or any name)
 *      - Select "drive" for Google Drive
 *      - Follow the interactive auth (opens browser automatically)
 *      - Accept defaults for other options
 *   3. Done — rclone handles all OAuth and API calls.
 *
 * Commands used:
 *   push: rclone sync <vaultPath> DevVault:Dev-Vault-Backup --progress --metadata
 *   pull: rclone sync DevVault:Dev-Vault-Backup <vaultPath> --progress --metadata
 *   status: rclone check <vaultPath> DevVault:Dev-Vault-Backup
 */

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const vaultConfig = require('./vaultConfig');

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function getElegyHome(options = {}) {
  return options.elegyHome || vaultConfig.resolveElegyHome();
}

function getManagedRcloneDir(options = {}) {
  return path.join(getElegyHome(options), 'managed-tools', 'rclone');
}

function resolveManagedRclonePath(options = {}) {
  const binName = process.platform === 'win32' ? 'rclone.exe' : 'rclone';
  const candidate = path.join(getManagedRcloneDir(options), binName);
  return fs.existsSync(candidate) ? candidate : null;
}

function verifyExecutable(candidate) {
  try {
    const result = cp.spawnSync(candidate, ['--version'], { encoding: 'utf8', timeout: 5000, stdio: 'pipe' });
    return result.status === 0;
  } catch {
    return false;
  }
}

function resolveRclonePath(options = {}) {
  const env = process.env;
  const configured = normalizeString(env.IE_RCLONE_PATH);
  if (configured && verifyExecutable(configured)) return configured;
  const managed = resolveManagedRclonePath(options);
  if (managed && verifyExecutable(managed)) return managed;
  // Common locations
  const candidates = [
    'rclone',
    'rclone.exe',
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'rclone', 'rclone.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'rclone', 'rclone.exe'),
    '/usr/local/bin/rclone',
    '/usr/bin/rclone',
  ];
  for (const c of candidates) {
    try {
      const result = cp.spawnSync(c, ['--version'], { encoding: 'utf8', timeout: 5000, stdio: 'pipe' });
      if (result.status === 0) return c;
    } catch {}
  }
  return null;
}

function rclone(args, cwd, timeoutMs = 120000, options = {}) {
  const bin = resolveRclonePath(options);
  if (!bin) {
    return { ok: false, error: 'rclone is not installed. Use the Notes Drive setup to install the managed rclone binary.' };
  }
  const result = cp.spawnSync(bin, args, {
    cwd: cwd || undefined,
    encoding: 'utf8',
    timeout: timeoutMs,
    stdio: 'pipe',
    maxBuffer: 50 * 1024 * 1024,
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: normalizeString(result.stdout),
    stderr: normalizeString(result.stderr),
    error: result.error ? result.error.message : null,
  };
}

function runPowerShell(args, timeoutMs = 120000) {
  return cp.spawnSync('powershell.exe', args, {
    encoding: 'utf8',
    timeout: timeoutMs,
    stdio: 'pipe',
    maxBuffer: 50 * 1024 * 1024,
  });
}

function quotePowerShellLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function buildExpandArchiveArgs(archivePath, destinationPath) {
  return [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    `Expand-Archive -LiteralPath ${quotePowerShellLiteral(archivePath)} -DestinationPath ${quotePowerShellLiteral(destinationPath)} -Force`,
  ];
}

function findFile(root, filename) {
  if (!root || !fs.existsSync(root)) return null;
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isFile() && entry.name.toLowerCase() === filename.toLowerCase()) {
        return fullPath;
      }
      if (entry.isDirectory()) stack.push(fullPath);
    }
  }
  return null;
}

async function downloadFile(url, targetPath, fetchImpl = global.fetch) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('This runtime cannot download rclone because fetch is unavailable.');
  }
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`Download failed with HTTP ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(targetPath, buffer);
}

async function installRclone(options = {}) {
  const existing = resolveRclonePath(options);
  if (existing) {
    return { ok: true, installed: false, rclonePath: existing, message: 'rclone is already available.' };
  }

  if (process.platform !== 'win32') {
    return {
      ok: false,
      error: 'Managed rclone install is currently supported on Windows. Set IE_RCLONE_PATH to an existing rclone binary on this platform.',
    };
  }

  const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
  const url = `https://downloads.rclone.org/rclone-current-windows-${arch}.zip`;
  const installDir = getManagedRcloneDir(options);
  const tempDir = path.join(installDir, '.download');
  const extractDir = path.join(tempDir, 'extract');
  const archivePath = path.join(tempDir, 'rclone.zip');
  const targetPath = path.join(installDir, 'rclone.exe');

  fs.mkdirSync(tempDir, { recursive: true });
  fs.rmSync(extractDir, { recursive: true, force: true });
  fs.mkdirSync(extractDir, { recursive: true });

  try {
    await downloadFile(url, archivePath, options.fetchImpl);
    const expand = runPowerShell(buildExpandArchiveArgs(archivePath, extractDir));
    if (expand.status !== 0) {
      throw new Error(normalizeString(expand.stderr) || normalizeString(expand.stdout) || 'Failed to extract rclone archive.');
    }

    const extractedBinary = findFile(extractDir, 'rclone.exe');
    if (!extractedBinary) {
      throw new Error('Downloaded rclone archive did not contain rclone.exe.');
    }

    fs.mkdirSync(installDir, { recursive: true });
    fs.copyFileSync(extractedBinary, targetPath);

    if (!verifyExecutable(targetPath)) {
      throw new Error('Managed rclone binary was installed but failed version verification.');
    }

    return {
      ok: true,
      installed: true,
      rclonePath: targetPath,
      message: `Installed managed rclone at ${targetPath}.`,
    };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  } finally {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  }
}

function getConfig() {
  return vaultConfig.readConfig();
}

function getRemoteFolder() {
  const config = getConfig();
  return config.gdrive?.remoteFolderName || 'Dev-Vault-Backup';
}

function getRemoteName() {
  const config = getConfig();
  return config.gdrive?.rcloneRemote || 'DevVault';
}

async function syncStatus(options = {}) {
  const config = getConfig();
  const vaultPath = config.vaultPath;
  const bin = resolveRclonePath(options);
  const remoteName = getRemoteName();

  const status = {
    ok: true,
    configured: Boolean(config.gdrive?.enabled && vaultPath),
    vaultPath: vaultPath || null,
    vaultExists: vaultPath ? fs.existsSync(vaultPath) : false,
    gdriveEnabled: config.gdrive?.enabled || false,
    gdriveFolderName: getRemoteFolder(),
    rcloneInstalled: Boolean(bin),
    rclonePath: bin || null,
    managedRclonePath: resolveManagedRclonePath(options),
    canInstallRclone: process.platform === 'win32',
    rcloneRemoteName: remoteName,
    rcloneConfigured: false,
    authenticated: false,
    authenticatedEmail: null,
    driveFolderExists: false,
    lastSync: null,
  };

  if (!bin) return status;

  // Check if remote is configured
  const listResult = rclone(['listremotes'], null, 120000, options);
  if (listResult.ok) {
    const remotes = listResult.stdout.split('\n').filter(Boolean);
    status.rcloneConfigured = remotes.some(r => r.startsWith(remoteName));
    status.authenticated = status.rcloneConfigured;

    if (status.rcloneConfigured) {
      // Get email of authenticated account
      const aboutResult = rclone(['about', `${remoteName}:`], null, 120000, options);
      if (aboutResult.ok) {
        const emailMatch = aboutResult.stdout.match(/User:\s+(\S+)/i) || aboutResult.stdout.match(/email:\s+(\S+)/i);
        if (emailMatch) status.authenticatedEmail = emailMatch[1];
      }

      // Check if drive folder exists
      const checkResult = rclone(['lsf', `${remoteName}:${getRemoteFolder()}`, '--max-depth', '0'], null, 120000, options);
      status.driveFolderExists = checkResult.ok;
    }
  }

  return status;
}

async function push(options = {}) {
  const vaultPath = getConfig().vaultPath;
  if (!vaultPath || !fs.existsSync(vaultPath)) {
    return { ok: false, error: 'Vault path not configured or does not exist.' };
  }

  const bin = resolveRclonePath(options);
  if (!bin) {
    return { ok: false, needsSetup: true, error: 'Install managed rclone from the Notes Drive setup first.' };
  }

  const remoteName = getRemoteName();

  // Ensure remote is configured
  const listResult = rclone(['listremotes'], null, 120000, options);
  if (!listResult.ok || !listResult.stdout.split('\n').filter(Boolean).some(r => r.startsWith(remoteName))) {
    return {
      ok: false,
      needsSetup: true,
      error: `rclone remote "${remoteName}" not configured.\n\nSetup:\n  1. Run: rclone config\n  2. Select "n" for new remote\n  3. Name: ${remoteName}\n  4. Select "drive" for Google Drive\n  5. Follow the browser auth flow`,
    };
  }

  // Exclude patterns
  const exclude = [
    '.obsidian/workspace.json',
    '.obsidian/.trash/',
    '.trash/',
    '*.conflict.*.md',
    'node_modules/',
  ];

  const args = [
    'sync',
    vaultPath,
    `${remoteName}:${getRemoteFolder()}`,
    '--progress',
    '--metadata',
    '--copy-links',
  ];
  for (const pattern of exclude) {
    args.push('--exclude', pattern);
  }

  const result = rclone(args, vaultPath, 300000, options);

  if (result.ok) {
    return {
      ok: true,
      message: 'Push complete. Vault synced to Google Drive.',
      output: result.stdout || result.stderr,
    };
  }

  // Check if error is about auth
  if (result.stderr && (result.stderr.includes('unauthorized') || result.stderr.includes('unauthenticated') || result.stderr.includes('token expired'))) {
    return {
      ok: false,
      needsAuth: true,
      error: 'Authentication expired. Run: rclone config reconnect DevVault:',
    };
  }

  return {
    ok: false,
    error: `Push failed: ${result.stderr || result.stdout || 'Unknown error'}`,
  };
}

async function pull(options = {}) {
  const vaultPath = getConfig().vaultPath;
  if (!vaultPath) {
    return { ok: false, error: 'Vault path not configured.' };
  }

  if (!fs.existsSync(vaultPath)) {
    fs.mkdirSync(vaultPath, { recursive: true });
  }

  const bin = resolveRclonePath(options);
  if (!bin) {
    return { ok: false, needsSetup: true, error: 'Install managed rclone from the Notes Drive setup first.' };
  }

  const remoteName = getRemoteName();

  // Ensure remote is configured
  const listResult = rclone(['listremotes'], null, 120000, options);
  if (!listResult.ok || !listResult.stdout.split('\n').filter(Boolean).some(r => r.startsWith(remoteName))) {
    return {
      ok: false,
      needsSetup: true,
      error: `rclone remote "${remoteName}" not configured.\n\nSetup:\n  1. Run: rclone config\n  2. Select "n" for new remote\n  3. Name: ${remoteName}\n  4. Select "drive" for Google Drive\n  5. Follow the browser auth flow`,
    };
  }

  const exclude = [
    '.obsidian/workspace.json',
    '.obsidian/.trash/',
    '.trash/',
    '*.conflict.*.md',
    'node_modules/',
  ];

  const args = [
    'sync',
    `${remoteName}:${getRemoteFolder()}`,
    vaultPath,
    '--progress',
    '--metadata',
    '--copy-links',
  ];
  for (const pattern of exclude) {
    args.push('--exclude', pattern);
  }

  // First check for conflicts: files that differ on both sides
  const checkArgs = [
    'check',
    vaultPath,
    `${remoteName}:${getRemoteFolder()}`,
    '--combined', '',
    '--one-way',
  ];
  for (const pattern of exclude) {
    checkArgs.push('--exclude', pattern);
  }

  const checkResult = rclone(checkArgs, vaultPath, 60000, options);

  const args2 = [
    'sync',
    `${remoteName}:${getRemoteFolder()}`,
    vaultPath,
    '--backup-dir', path.join(vaultPath, '.rclone-conflicts', new Date().toISOString().replace(/[:.]/g, '-')),
    '--suffix', `.conflict`,
    '--metadata',
    '--copy-links',
  ];
  for (const pattern of exclude) {
    args2.push('--exclude', pattern);
  }

  const result = rclone(args2, vaultPath, 300000, options);

  if (result.ok) {
    return {
      ok: true,
      message: 'Pull complete. Remote changes synced to vault.',
      output: result.stdout || result.stderr,
      hasConflicts: checkResult && !checkResult.ok,
    };
  }

  if (result.stderr && (result.stderr.includes('unauthorized') || result.stderr.includes('unauthenticated') || result.stderr.includes('token expired'))) {
    return {
      ok: false,
      needsAuth: true,
      error: 'Authentication expired. Run: rclone config reconnect DevVault:',
    };
  }

  return {
    ok: false,
    error: `Pull failed: ${result.stderr || result.stdout || 'Unknown error'}`,
  };
}

// Stub functions for auth (handled by rclone directly)
async function authenticate(options = {}) {
  const bin = resolveRclonePath(options);
  if (!bin) {
    return {
      ok: false,
      needsSetup: true,
      error: 'Managed rclone is not installed yet.',
      setupInstructions: 'Install managed rclone from this panel, then configure the Drive remote.',
    };
  }

  const remoteName = getRemoteName();

  // Check if already configured
  const listResult = rclone(['listremotes'], null, 120000, options);
  if (listResult.ok && listResult.stdout.split('\n').filter(Boolean).some(r => r.startsWith(remoteName))) {
    return { ok: true, message: `rclone remote "${remoteName}" is already configured.` };
  }

  // Open rclone config for the user
  const configCommand = bin.includes(path.sep) ? `"${bin}" config` : `${bin} config`;
  return {
    ok: false,
    needsSetup: true,
    message: `rclone remote "${remoteName}" not configured.`,
    setupInstructions: [
      `1. Open a terminal and run: ${configCommand}`,
      `2. Select "n" (new remote)`,
      `3. Name: ${remoteName}`,
      `4. Storage: "drive" (Google Drive)`,
      `5. Follow the interactive auth — it will open your browser`,
      `6. Accept defaults for remaining prompts`,
      `7. Done! Then try push/pull again.`,
    ].join('\n'),
  };
}

async function checkAuth(options = {}) {
  const bin = resolveRclonePath(options);
  if (!bin) {
    return { ok: false, error: 'Managed rclone is not installed yet.' };
  }

  const remoteName = getRemoteName();
  const listResult = rclone(['listremotes'], null, 120000, options);

  if (listResult.ok && listResult.stdout.split('\n').filter(Boolean).some(r => r.startsWith(remoteName))) {
    // Verify by listing the folder
    const testResult = rclone(['lsf', `${remoteName}:${getRemoteFolder()}`, '--max-depth', '0'], null, 15000, options);
    if (testResult.ok) {
      return { ok: true, completed: true, message: 'rclone is authenticated and configured.' };
    }
    return { ok: true, completed: true, message: 'rclone remote configured but Drive folder not yet created (will be created on first push).' };
  }

  return { ok: false, completed: false, message: 'rclone remote not configured.' };
}

async function cancelAuth() {
  return { ok: true, message: 'rclone auth is managed externally via rclone config.' };
}

module.exports = {
  authenticate,
  checkAuth,
  cancelAuth,
  push,
  pull,
  syncStatus,
  installRclone,
  resolveManagedRclonePath,
  resolveRclonePath,
  _private: {
    buildExpandArchiveArgs,
    quotePowerShellLiteral,
  },
};
