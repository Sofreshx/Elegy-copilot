'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULT_CONFIG_FILENAME = 'obsidian-vault.json';
const DEFAULT_ELEGY_HOME = path.join(os.homedir(), '.elegy');

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function resolveWindowsPath(windowsPath) {
  const p = normalizeString(windowsPath);
  if (!p) return '';
  const cleaned = p.replace(/\\/g, '/');
  const match = cleaned.match(/^([A-Za-z]):\/(.*)$/);
  if (match) {
    return '/mnt/' + match[1].toLowerCase() + '/' + match[2];
  }
  return cleaned;
}

function resolveElegyHome() {
  const env = process.env;
  return normalizeString(env.IE_ELEGY_HOME || env.ELEGY_HOME) || DEFAULT_ELEGY_HOME;
}

function buildConfigPath() {
  const env = process.env;
  const configuredPath = normalizeString(env.IE_OBSIDIAN_VAULT_CONFIG_PATH);
  if (configuredPath) {
    return path.resolve(configuredPath);
  }
  return path.join(resolveElegyHome(), DEFAULT_CONFIG_FILENAME);
}

function readConfig() {
  const configPath = buildConfigPath();
  let config = {};

  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch {
      config = {};
    }
  }

  const env = process.env;
  const vaultPathRaw = normalizeString(
    env.IE_OBSIDIAN_VAULT_PATH || config.vaultPath || ''
  );

  let vaultPath = vaultPathRaw;
  // Convert Windows paths (C:\...) to WSL paths (/mnt/c/...) only on Linux
  if (vaultPath && vaultPath.includes(':') && process.platform === 'linux') {
    vaultPath = resolveWindowsPath(vaultPath);
  }
  // On Windows, normalize backslashes to forward slashes (Node.js handles them)
  if (vaultPath && process.platform === 'win32') {
    vaultPath = vaultPath.replace(/\\/g, '/');
  }

  return {
    configPath,
    vaultPath,
    git: config.git || {
      enabled: true,
      authorName: normalizeString(env.GIT_AUTHOR_NAME || os.userInfo().username || 'user'),
      authorEmail: normalizeString(env.GIT_AUTHOR_EMAIL || 'user@localhost'),
    },
    gdrive: config.gdrive || {
      enabled: false,
      remoteFolderName: 'Dev-Vault-Backup',
      rcloneRemote: 'DevVault',
    },
    excludeDirs: config.excludeDirs || ['.obsidian', '.git', '.trash', '_elegy-copilot', 'node_modules'],
  };
}

module.exports = {
  buildConfigPath,
  readConfig,
  resolveElegyHome,
  resolveWindowsPath,
  DEFAULT_CONFIG_FILENAME,
};
