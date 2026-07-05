'use strict';

/**
 * Lightweight git wrapper for the Obsidian vault.
 * Provides status, commit, log, diff operations.
 * All manual — no auto-commits.
 */

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const vaultConfig = require('./vaultConfig');

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function resolveVaultPath() {
  const config = vaultConfig.readConfig();
  if (!config.vaultPath) {
    return { ok: false, error: 'Vault path not configured' };
  }
  return { ok: true, vaultPath: config.vaultPath };
}

function git(args, cwd, timeoutMs = 15000) {
  const result = cp.spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    timeout: timeoutMs,
    stdio: 'pipe',
  });
  return {
    status: result.status,
    stdout: normalizeString(result.stdout),
    stderr: normalizeString(result.stderr),
    error: result.error || null,
  };
}

function isGitRepo(vaultPath) {
  return fs.existsSync(path.join(vaultPath, '.git'));
}

function initGit(vaultPath) {
  if (isGitRepo(vaultPath)) return { ok: true, message: 'Git already initialized' };

  const initResult = git(['init'], vaultPath);
  if (initResult.status !== 0) {
    return { ok: false, error: `git init failed: ${initResult.stderr || initResult.stdout}` };
  }

  // Create .gitignore
  const gitignorePath = path.join(vaultPath, '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    const gitignore = [
      '.obsidian/workspace.json',
      '.obsidian/.trash/',
      '.trash/',
      '.DS_Store',
      'Thumbs.db',
    ].join('\n') + '\n';
    fs.writeFileSync(gitignorePath, gitignore, 'utf8');
  }

  // Set author from config
  const config = vaultConfig.readConfig();
  if (config.git?.authorName) {
    git(['config', 'user.name', config.git.authorName], vaultPath);
  }
  if (config.git?.authorEmail) {
    git(['config', 'user.email', config.git.authorEmail], vaultPath);
  }

  return { ok: true, message: 'Git initialized' };
}

function status() {
  const vault = resolveVaultPath();
  if (!vault.ok) return vault;

  if (!isGitRepo(vault.vaultPath)) {
    return { ok: false, error: 'Git not initialized. Run git init first.' };
  }

  const result = git(['status', '--porcelain'], vault.vaultPath);
  if (result.error) {
    return { ok: false, error: result.error.message };
  }

  const lines = normalizeString(result.stdout).split('\n').filter(Boolean);
  const changes = lines.map((line) => {
    const statusCode = line.slice(0, 2).trim();
    const filePath = line.slice(3).trim();
    return { status: statusCode, file: filePath };
  });

  return {
    ok: true,
    isClean: changes.length === 0,
    changes,
    raw: result.stdout,
  };
}

function diff(filePath) {
  const vault = resolveVaultPath();
  if (!vault.ok) return vault;

  if (!isGitRepo(vault.vaultPath)) {
    return { ok: false, error: 'Git not initialized.' };
  }

  const args = ['diff'];
  if (filePath) {
    args.push('--', filePath);
  }

  const result = git(args, vault.vaultPath);
  if (result.error) {
    return { ok: false, error: result.error.message };
  }

  return {
    ok: true,
    diff: result.stdout,
  };
}

function commit(message) {
  const vault = resolveVaultPath();
  if (!vault.ok) return vault;

  if (!isGitRepo(vault.vaultPath)) {
    return { ok: false, error: 'Git not initialized.' };
  }

  const addResult = git(['add', '-A'], vault.vaultPath);
  if (addResult.error) {
    return { ok: false, error: `git add failed: ${addResult.error.message}` };
  }

  const msg = normalizeString(message) || `vault: update ${new Date().toISOString()}`;
  const commitResult = git(['commit', '-m', msg], vault.vaultPath);
  if (commitResult.error) {
    return { ok: false, error: `git commit failed: ${commitResult.error.message}` };
  }

  if (commitResult.status !== 0) {
    const output = commitResult.stderr || commitResult.stdout;
    if (output.includes('nothing to commit') || output.includes('nothing added')) {
      return { ok: true, committed: false, message: 'Nothing to commit.' };
    }
    return { ok: false, error: output };
  }

  return {
    ok: true,
    committed: true,
    message: 'Changes committed.',
    output: commitResult.stdout,
  };
}

function log(maxCount = 20) {
  const vault = resolveVaultPath();
  if (!vault.ok) return vault;

  if (!isGitRepo(vault.vaultPath)) {
    return { ok: false, error: 'Git not initialized.' };
  }

  const result = git(['log', `--max-count=${maxCount}`, '--format=%H|%ai|%an|%s'], vault.vaultPath);
  if (result.error) {
    return { ok: false, error: result.error.message };
  }

  const entries = normalizeString(result.stdout).split('\n').filter(Boolean).map((line) => {
    const parts = line.split('|');
    return {
      hash: parts[0] || '',
      date: parts[1] || '',
      author: parts[2] || '',
      subject: parts.slice(3).join('|') || '',
    };
  });

  return {
    ok: true,
    entries,
  };
}

module.exports = {
  initGit,
  status,
  diff,
  commit,
  log,
  isGitRepo,
};
