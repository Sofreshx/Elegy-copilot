'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function gitOutput(repoRoot, args, encoding = 'utf8') {
  try {
    return execFileSync('git', args, {
      cwd: repoRoot,
      encoding,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
      windowsHide: true,
    });
  } catch {
    return null;
  }
}

function readUntrackedContent(repoRoot, hasher, untracked) {
  const root = path.resolve(repoRoot);
  const paths = Buffer.isBuffer(untracked)
    ? untracked.toString('utf8').split('\0').filter(Boolean)
    : [];

  for (const relativePath of paths) {
    const absolutePath = path.resolve(root, relativePath);
    const relative = path.relative(root, absolutePath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) continue;
    hasher.update('\0untracked\0');
    hasher.update(relativePath, 'utf8');
    hasher.update('\0');
    try {
      const stat = fs.lstatSync(absolutePath);
      if (stat.isSymbolicLink()) {
        hasher.update('symlink\0');
        hasher.update(fs.readlinkSync(absolutePath), 'utf8');
      } else if (stat.isFile()) {
        hasher.update(fs.readFileSync(absolutePath));
      } else {
        hasher.update(`${stat.mode}\0`);
      }
    } catch {
      hasher.update('unreadable\0');
    }
  }
}

/**
 * Read the git context used by check plans and cached local evidence.
 * The dirty fingerprint includes the complete tracked diff and the bytes of
 * untracked files, so changing an already-dirty file invalidates prior proof.
 */
function readGitEvidence(repoRoot) {
  const branch = String(gitOutput(repoRoot, ['branch', '--show-current']) || '').trim() || null;
  const head = String(gitOutput(repoRoot, ['rev-parse', 'HEAD']) || '').trim() || null;
  const status = String(gitOutput(repoRoot, ['status', '--porcelain=v1', '--untracked-files=all']) || '');
  const changedFiles = status
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.slice(3).replace(/^"|"$/g, ''));

  let dirtyHash = null;
  if (status.length > 0) {
    const hasher = crypto.createHash('sha256');
    hasher.update(status, 'utf8');
    const diff = gitOutput(repoRoot, ['diff', '--no-ext-diff', '--binary', 'HEAD', '--'], 'buffer');
    if (Buffer.isBuffer(diff)) hasher.update(diff);
    const untracked = gitOutput(repoRoot, ['ls-files', '--others', '--exclude-standard', '-z'], 'buffer');
    readUntrackedContent(repoRoot, hasher, untracked);
    dirtyHash = hasher.digest('hex');
  }

  return {
    branch,
    head,
    dirtyHash,
    clean: changedFiles.length === 0,
    changedFiles,
  };
}

module.exports = { readGitEvidence };
