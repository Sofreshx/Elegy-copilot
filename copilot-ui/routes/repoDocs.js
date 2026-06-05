'use strict';

const fs = require('fs');
const path = require('path');
const { sendJson: defaultSendJson } = require('./_helpers');

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

const ALLOWED_EXTENSIONS = new Set(['.md', '.markdown']);
const ALLOWED_PREFIXES = ['specs/', 'docs/', 'specs\\', 'docs\\'];
const ALLOWED_ROOT_FILES = ['README.md', 'readme.md', 'CHANGELOG.md', 'changelog.md'];

const MAX_FILE_SIZE = 512 * 1024;

function isAllowedDocPath(relativePath) {
  const normalized = relativePath.replace(/\\/g, '/');

  if (normalized.includes('..') || normalized.startsWith('/') || normalized.startsWith('\\')) {
    return false;
  }

  const ext = path.extname(normalized).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return false;
  }

  if (ALLOWED_ROOT_FILES.includes(path.basename(normalized))) {
    return true;
  }

  return ALLOWED_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function scanMarkdownFiles(dir, baseDir, results) {
  if (!fs.existsSync(dir)) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(baseDir, fullPath).replace(/\\/g, '/');

    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      scanMarkdownFiles(fullPath, baseDir, results);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (ALLOWED_EXTENSIONS.has(ext)) {
        try {
          const stat = fs.statSync(fullPath);
          results.push({
            path: relativePath,
            name: entry.name,
            size: stat.size,
            modifiedAt: stat.mtime.toISOString(),
          });
        } catch {
          // skip files we can't stat
        }
      }
    }
  }
}

function handleRepoDocsList(ctx, deps) {
  const { res } = ctx;
  const { sendJson } = deps;
  const { u } = ctx;
  const repoPath = u.searchParams.get('repoPath');

  if (!isNonEmptyString(repoPath)) {
    sendJson(res, 400, { error: 'repoPath query parameter is required' });
    return;
  }

  const root = repoPath.trim();
  if (!fs.existsSync(root)) {
    sendJson(res, 404, { error: 'Repository path not found' });
    return;
  }

  try {
    const files = [];

    for (const subDir of ['specs', 'docs']) {
      const fullPath = path.join(root, subDir);
      scanMarkdownFiles(fullPath, root, files);
    }

    for (const rootFile of ALLOWED_ROOT_FILES) {
      const fullPath = path.join(root, rootFile);
      if (fs.existsSync(fullPath)) {
        try {
          const stat = fs.statSync(fullPath);
          files.push({
            path: rootFile,
            name: rootFile,
            size: stat.size,
            modifiedAt: stat.mtime.toISOString(),
          });
        } catch {
          // skip
        }
      }
    }

    files.sort((a, b) => String(a.path || '').localeCompare(String(b.path || '')));

    sendJson(res, 200, {
      repoPath: root,
      files,
      count: files.length,
    });
  } catch (error) {
    sendJson(res, 500, { error: String(error.message || error) });
  }
}

function handleRepoDocsRead(ctx, deps) {
  const { res } = ctx;
  const { sendJson } = deps;
  const { u } = ctx;
  const repoPath = u.searchParams.get('repoPath');
  const filePath = u.searchParams.get('path');

  if (!isNonEmptyString(repoPath)) {
    sendJson(res, 400, { error: 'repoPath query parameter is required' });
    return;
  }

  if (!isNonEmptyString(filePath)) {
    sendJson(res, 400, { error: 'path query parameter is required' });
    return;
  }

  const root = repoPath.trim();
  const relativePath = filePath.trim();

  if (!isAllowedDocPath(relativePath)) {
    sendJson(res, 403, { error: 'Path is not allowed. Only markdown files under specs/, docs/, or root README are accessible.' });
    return;
  }

  const fullPath = path.join(root, relativePath);

  const resolvedRoot = path.resolve(root);
  const resolvedFull = path.resolve(fullPath);
  if (!resolvedFull.startsWith(resolvedRoot + path.sep) && resolvedFull !== resolvedRoot) {
    sendJson(res, 403, { error: 'Path traversal detected' });
    return;
  }

  if (!fs.existsSync(resolvedFull)) {
    sendJson(res, 404, { error: 'File not found' });
    return;
  }

  try {
    const stat = fs.statSync(resolvedFull);
    if (!stat.isFile()) {
      sendJson(res, 400, { error: 'Path is not a file' });
      return;
    }
    if (stat.size > MAX_FILE_SIZE) {
      sendJson(res, 413, { error: 'File too large' });
      return;
    }

    const content = fs.readFileSync(resolvedFull, 'utf8');
    sendJson(res, 200, {
      path: relativePath,
      name: path.basename(relativePath),
      content,
      size: stat.size,
      modifiedAt: stat.mtime.toISOString(),
    });
  } catch (error) {
    sendJson(res, 500, { error: String(error.message || error) });
  }
}

function register(context = {}) {
  const sendJson = context.sendJson || defaultSendJson;
  const deps = { sendJson };

  return [
    { method: 'GET', path: '/api/repo-docs/list', handler: (ctx) => handleRepoDocsList(ctx, deps) },
    { method: 'GET', path: '/api/repo-docs/read', handler: (ctx) => handleRepoDocsRead(ctx, deps) },
  ];
}

module.exports = { register };
