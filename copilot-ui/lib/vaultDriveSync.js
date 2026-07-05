'use strict';

/**
 * Google Drive sync for the Obsidian vault.
 * Uses rclone as backend — no Google Cloud Console needed.
 *
 * Setup (one-time):
 *   1. Install rclone: winget install rclone  (or brew install rclone / apt install rclone)
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

function resolveRclonePath() {
  const env = process.env;
  const configured = normalizeString(env.IE_RCLONE_PATH);
  if (configured) return configured;
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

function rclone(args, cwd, timeoutMs = 120000) {
  const bin = resolveRclonePath();
  if (!bin) {
    return { ok: false, error: 'rclone not found. Install: winget install rclone  or  brew install rclone' };
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

async function syncStatus() {
  const config = getConfig();
  const vaultPath = config.vaultPath;
  const bin = resolveRclonePath();
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
    rcloneConfigured: false,
    authenticated: false,
    authenticatedEmail: null,
    driveFolderExists: false,
    lastSync: null,
  };

  if (!bin) return status;

  // Check if remote is configured
  const listResult = rclone(['listremotes']);
  if (listResult.ok) {
    const remotes = listResult.stdout.split('\n').filter(Boolean);
    status.rcloneConfigured = remotes.some(r => r.startsWith(remoteName));
    status.authenticated = status.rcloneConfigured;

    if (status.rcloneConfigured) {
      // Get email of authenticated account
      const aboutResult = rclone(['about', `${remoteName}:`]);
      if (aboutResult.ok) {
        const emailMatch = aboutResult.stdout.match(/User:\s+(\S+)/i) || aboutResult.stdout.match(/email:\s+(\S+)/i);
        if (emailMatch) status.authenticatedEmail = emailMatch[1];
      }

      // Check if drive folder exists
      const checkResult = rclone(['lsf', `${remoteName}:${getRemoteFolder()}`, '--max-depth', '0']);
      status.driveFolderExists = checkResult.ok;
    }
  }

  return status;
}

async function push() {
  const vaultPath = getConfig().vaultPath;
  if (!vaultPath || !fs.existsSync(vaultPath)) {
    return { ok: false, error: 'Vault path not configured or does not exist.' };
  }

  const bin = resolveRclonePath();
  if (!bin) {
    return { ok: false, error: 'rclone not found. Install: winget install rclone' };
  }

  const remoteName = getRemoteName();

  // Ensure remote is configured
  const listResult = rclone(['listremotes']);
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

  const result = rclone(args, vaultPath, 300000);

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

async function pull() {
  const vaultPath = getConfig().vaultPath;
  if (!vaultPath) {
    return { ok: false, error: 'Vault path not configured.' };
  }

  if (!fs.existsSync(vaultPath)) {
    fs.mkdirSync(vaultPath, { recursive: true });
  }

  const bin = resolveRclonePath();
  if (!bin) {
    return { ok: false, error: 'rclone not found. Install: winget install rclone' };
  }

  const remoteName = getRemoteName();

  // Ensure remote is configured
  const listResult = rclone(['listremotes']);
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

  const checkResult = rclone(checkArgs, vaultPath, 60000);

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

  const result = rclone(args2, vaultPath, 300000);

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
async function authenticate() {
  const bin = resolveRclonePath();
  if (!bin) {
    return { ok: false, error: 'rclone not found. Install rclone first.' };
  }

  const remoteName = getRemoteName();

  // Check if already configured
  const listResult = rclone(['listremotes']);
  if (listResult.ok && listResult.stdout.split('\n').filter(Boolean).some(r => r.startsWith(remoteName))) {
    return { ok: true, message: `rclone remote "${remoteName}" is already configured.` };
  }

  // Open rclone config for the user
  return {
    ok: false,
    needsSetup: true,
    message: `rclone remote "${remoteName}" not configured.`,
    setupInstructions: [
      `1. Open a terminal and run: rclone config`,
      `2. Select "n" (new remote)`,
      `3. Name: ${remoteName}`,
      `4. Storage: "drive" (Google Drive)`,
      `5. Follow the interactive auth — it will open your browser`,
      `6. Accept defaults for remaining prompts`,
      `7. Done! Then try push/pull again.`,
    ].join('\n'),
  };
}

async function checkAuth() {
  const bin = resolveRclonePath();
  if (!bin) {
    return { ok: false, error: 'rclone not found.' };
  }

  const remoteName = getRemoteName();
  const listResult = rclone(['listremotes']);

  if (listResult.ok && listResult.stdout.split('\n').filter(Boolean).some(r => r.startsWith(remoteName))) {
    // Verify by listing the folder
    const testResult = rclone(['lsf', `${remoteName}:${getRemoteFolder()}`, '--max-depth', '0'], null, 15000);
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
  resolveRclonePath,
};
