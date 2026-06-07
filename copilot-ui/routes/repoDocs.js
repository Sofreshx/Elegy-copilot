'use strict';

const fs = require('fs');
const path = require('path');
const { sendJson: defaultSendJson, readJsonBody: defaultReadJsonBody } = require('./_helpers');

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

const ALLOWED_EXTENSIONS = new Set(['.md', '.markdown']);
const ALLOWED_PREFIXES = ['specs/', 'docs/', 'skills/', 'agents/', '.opencode/', '.codex/', '.copilot/', '.gemini/', '.antigravity/', 'specs\\', 'docs\\', 'skills\\', 'agents\\', '.opencode\\', '.codex\\', '.copilot\\', '.gemini\\', '.antigravity\\'];
const ALLOWED_ROOT_FILES = ['README.md', 'readme.md', 'CHANGELOG.md', 'changelog.md', 'AGENTS.md', 'agents.md', 'guidelines.md', 'GUIDELINES.md'];

const TREE_ALLOWED_EXTENSIONS = new Set(['.md', '.markdown', '.json', '.toml']);

const CONFIG_DIRECTORIES = ['skills', 'agents', '.opencode', '.codex', '.copilot', '.gemini', '.antigravity'];

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

function scanMarkdownFiles(dir, baseDir, results, extensions = ALLOWED_EXTENSIONS) {
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

    let lstat;
    try {
      lstat = fs.lstatSync(fullPath);
    } catch {
      continue;
    }

    if (lstat.isSymbolicLink()) {
      // Symlink handling — resolve and check if target is inside baseDir
      let resolvedPath;
      try {
        resolvedPath = fs.realpathSync(fullPath);
      } catch {
        continue;
      }
      const resolvedRelative = path.relative(baseDir, resolvedPath).replace(/\\/g, '/');
      const isExternal = resolvedRelative.startsWith('..') || path.isAbsolute(resolvedRelative);

      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        if (isExternal) continue; // skip external symlinked dirs
        // Follow symlinked directory by recursing into the resolved path
        scanMarkdownFiles(resolvedPath, baseDir, results, extensions);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (extensions.has(ext)) {
          if (isExternal) {
            results.push({
              path: relativePath,
              name: entry.name,
              size: 0,
              modifiedAt: new Date(0).toISOString(),
              isSymlink: true,
              resolvedPath: resolvedPath.replace(/\\/g, '/'),
              blockedReason: 'External symlink target outside repository root',
            });
          } else {
            try {
              const stat = fs.statSync(fullPath);
              results.push({
                path: relativePath,
                name: entry.name,
                size: stat.size,
                modifiedAt: stat.mtime.toISOString(),
                isSymlink: true,
                resolvedPath: resolvedPath.replace(/\\/g, '/'),
              });
            } catch {
              // skip files we can't stat
            }
          }
        }
      }
    } else if (lstat.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      scanMarkdownFiles(fullPath, baseDir, results, extensions);
    } else if (lstat.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (extensions.has(ext)) {
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

    for (const subDir of ['specs', 'docs', ...CONFIG_DIRECTORIES]) {
      const fullPath = path.join(root, subDir);
      scanMarkdownFiles(fullPath, root, files, TREE_ALLOWED_EXTENSIONS);
    }

    for (const rootFile of ALLOWED_ROOT_FILES) {
      const fullPath = path.join(root, rootFile);
      if (fs.existsSync(fullPath)) {
        try {
          const lstat = fs.lstatSync(fullPath);
          const entry = {
            path: rootFile,
            name: rootFile,
            size: 0,
            modifiedAt: new Date(0).toISOString(),
          };

          if (lstat.isSymbolicLink()) {
            entry.isSymlink = true;
            const resolvedPath = fs.realpathSync(fullPath);
            entry.resolvedPath = resolvedPath.replace(/\\/g, '/');
            const resolvedRelative = path.relative(root, resolvedPath).replace(/\\/g, '/');
            if (resolvedRelative.startsWith('..') || path.isAbsolute(resolvedRelative)) {
              entry.blockedReason = 'External symlink target outside repository root';
            } else {
              const stat = fs.statSync(fullPath);
              entry.size = stat.size;
              entry.modifiedAt = stat.mtime.toISOString();
            }
          } else {
            const stat = fs.statSync(fullPath);
            entry.size = stat.size;
            entry.modifiedAt = stat.mtime.toISOString();
          }

          files.push(entry);
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
    sendJson(res, 403, { error: 'Path is not allowed.' });
    return;
  }

  const fullPath = path.join(root, relativePath);

  // Resolve symlinks to get the real path before traversal check
  let realPath;
  try {
    realPath = fs.realpathSync(fullPath);
  } catch {
    realPath = path.resolve(fullPath);
  }

  const resolvedRoot = path.resolve(root);
  if (!realPath.startsWith(resolvedRoot + path.sep) && realPath !== resolvedRoot) {
    sendJson(res, 403, { error: 'Path traversal detected' });
    return;
  }

  if (!fs.existsSync(realPath)) {
    sendJson(res, 404, { error: 'File not found' });
    return;
  }

  // Detect if the original path is a symlink
  let isSymlink = false;
  let resolvedPath;
  try {
    const lstat = fs.lstatSync(fullPath);
    if (lstat.isSymbolicLink()) {
      isSymlink = true;
      resolvedPath = fs.realpathSync(fullPath).replace(/\\/g, '/');
    }
  } catch {
    // ignore
  }

  try {
    const stat = fs.statSync(realPath);
    if (!stat.isFile()) {
      sendJson(res, 400, { error: 'Path is not a file' });
      return;
    }
    if (stat.size > MAX_FILE_SIZE) {
      sendJson(res, 413, { error: 'File too large' });
      return;
    }

    const content = fs.readFileSync(realPath, 'utf8');
    sendJson(res, 200, {
      path: relativePath,
      name: path.basename(relativePath),
      content,
      size: stat.size,
      modifiedAt: stat.mtime.toISOString(),
      ...(isSymlink ? { isSymlink, resolvedPath } : {}),
    });
  } catch (error) {
    sendJson(res, 500, { error: String(error.message || error) });
  }
}

function handleRepoDocsGraph(ctx, deps) {
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
    // Reuse the same scanning logic as list
    const files = [];
    for (const subDir of ['specs', 'docs', ...CONFIG_DIRECTORIES]) {
      scanMarkdownFiles(path.join(root, subDir), root, files, TREE_ALLOWED_EXTENSIONS);
    }
    for (const rootFile of ALLOWED_ROOT_FILES) {
      const fullPath = path.join(root, rootFile);
      if (fs.existsSync(fullPath)) {
        try {
          const stat = fs.statSync(fullPath);
          files.push({
            path: rootFile, name: rootFile, size: stat.size,
            modifiedAt: stat.mtime.toISOString(),
          });
        } catch { /* skip */ }
      }
    }

    // Build nodes and edges
    const nodes = [];
    const edges = [];
    const errors = [];
    const skipped = [];
    const fileSet = new Set(files.map(f => f.path));

    for (const file of files) {
      // Skip blocked files
      if (file.blockedReason) {
        skipped.push({ path: file.path, reason: file.blockedReason });
        continue;
      }
      
      const depth = file.path.replace(/\\/g, '/').split('/').length - 1;
      nodes.push({
        id: file.path,
        label: file.name,
        path: file.path,
        depth,
      });

      // Try to read file content to extract links
      try {
        const fullPath = path.join(root, file.path);
        let realPath;
        try { realPath = fs.realpathSync(fullPath); } catch { realPath = path.resolve(fullPath); }
        
        if (!realPath.startsWith(path.resolve(root) + path.sep) && realPath !== path.resolve(root)) {
          skipped.push({ path: file.path, reason: 'Path traversal' });
          continue;
        }
        
        const stat = fs.statSync(realPath);
        if (stat.size > MAX_FILE_SIZE) {
          skipped.push({ path: file.path, reason: 'File too large' });
          continue;
        }
        
        const content = fs.readFileSync(realPath, 'utf8');
        
        // Extract markdown links
        const mdRegex = /\[([^\]]+)\]\(([^)]+\.md)\)/gi;
        let match;
        while ((match = mdRegex.exec(content)) !== null) {
          const target = match[2].replace(/\\/g, '/').replace(/^\.\//, '');
          if (fileSet.has(target)) {
            edges.push({ source: file.path, target, type: 'link' });
          }
        }
        
        // Extract wiki links
        const wikiRegex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
        while ((match = wikiRegex.exec(content)) !== null) {
          const target = match[1] + '.md';
          if (fileSet.has(target)) {
            edges.push({ source: file.path, target, type: 'wiki' });
          }
        }
      } catch (err) {
        errors.push({ path: file.path, error: err.message || String(err) });
        // Still include the node even if we couldn't read it
      }
    }

    sendJson(res, 200, {
      repoPath: root,
      nodes,
      edges,
      errors: errors.length > 0 ? errors : undefined,
      skipped: skipped.length > 0 ? skipped : undefined,
    });
  } catch (error) {
    sendJson(res, 500, { error: String(error.message || error) });
  }
}

async function handleRepoDocsWrite(ctx, deps) {
  const { res } = ctx;
  const { sendJson, readJsonBody } = deps;

  let body;
  try {
    body = await readJsonBody(ctx.req);
  } catch (bodyError) {
    const code = Number(bodyError && bodyError.statusCode) || 400;
    sendJson(res, code, { error: bodyError && bodyError.message || 'Invalid request body' });
    return;
  }

  const repoPath = body && body.repoPath;
  const relativePath = body && body.path;
  const content = body && body.content;

  if (!isNonEmptyString(repoPath)) {
    sendJson(res, 400, { error: 'repoPath is required in the request body' });
    return;
  }

  if (!isNonEmptyString(relativePath)) {
    sendJson(res, 400, { error: 'path is required in the request body' });
    return;
  }

  if (typeof content !== 'string') {
    sendJson(res, 400, { error: 'content is required in the request body' });
    return;
  }

  const root = repoPath.trim();

  if (!isAllowedDocPath(relativePath)) {
    sendJson(res, 403, { error: 'Path is not allowed.' });
    return;
  }

  const fullPath = path.join(root, relativePath);

  // Resolve symlinks to get the real path before traversal check
  let realPath;
  try {
    realPath = fs.realpathSync(fullPath);
  } catch {
    realPath = path.resolve(fullPath);
  }

  const resolvedRoot = path.resolve(root);
  if (!realPath.startsWith(resolvedRoot + path.sep) && realPath !== resolvedRoot) {
    sendJson(res, 403, { error: 'Path traversal detected' });
    return;
  }

  try {
    // Ensure parent directory exists
    const parentDir = path.dirname(realPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    fs.writeFileSync(realPath, content, 'utf8');

    const stat = fs.statSync(realPath);
    const relativeForResponse = path.relative(root, realPath).replace(/\\/g, '/');

    sendJson(res, 200, {
      path: relativeForResponse,
      name: path.basename(realPath),
      size: stat.size,
      modifiedAt: stat.mtime.toISOString(),
    });
  } catch (error) {
    sendJson(res, 500, { error: String(error.message || error) });
  }
}

function handleRepoDocsDelete(ctx, deps) {
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
    sendJson(res, 403, { error: 'Path is not allowed.' });
    return;
  }

  const fullPath = path.join(root, relativePath);

  // Resolve symlinks to get the real path before traversal check
  let realPath;
  try {
    realPath = fs.realpathSync(fullPath);
  } catch {
    realPath = path.resolve(fullPath);
  }

  const resolvedRoot = path.resolve(root);
  if (!realPath.startsWith(resolvedRoot + path.sep) && realPath !== resolvedRoot) {
    sendJson(res, 403, { error: 'Path traversal detected' });
    return;
  }

  if (!fs.existsSync(realPath)) {
    sendJson(res, 404, { error: 'File not found' });
    return;
  }

  try {
    const stat = fs.statSync(realPath);
    if (!stat.isFile()) {
      sendJson(res, 400, { error: 'Path is not a file' });
      return;
    }
  } catch (error) {
    sendJson(res, 500, { error: String(error.message || error) });
    return;
  }

  // Check for protected files
  const normalizedRel = relativePath.replace(/\\/g, '/');
  const basename = path.basename(normalizedRel).toLowerCase();
  const protectedBasenames = ['agents.md', 'guidelines.md', 'readme.md', 'changelog.md'];
  if (protectedBasenames.includes(basename) && normalizedRel.indexOf('/') === -1) {
    sendJson(res, 403, { error: 'Protected file — cannot be deleted from the document viewer' });
    return;
  }

  const protectedDirPrefixes = ['.opencode/', '.codex/', '.copilot/', '.gemini/', '.antigravity/'];
  if (protectedDirPrefixes.some((prefix) => normalizedRel.startsWith(prefix))) {
    sendJson(res, 403, { error: 'Protected file — cannot be deleted from the document viewer' });
    return;
  }

  try {
    fs.unlinkSync(realPath);
    const relativeForResponse = path.relative(root, realPath).replace(/\\/g, '/');
    sendJson(res, 200, {
      deleted: true,
      path: relativeForResponse,
    });
  } catch (error) {
    sendJson(res, 500, { error: String(error.message || error) });
  }
}

function register(context = {}) {
  const sendJson = context.sendJson || defaultSendJson;
  const readJsonBody = context.readJsonBody || defaultReadJsonBody;
  const deps = { sendJson, readJsonBody };

  return [
    { method: 'GET', path: '/api/repo-docs/list', handler: (ctx) => handleRepoDocsList(ctx, deps) },
    { method: 'GET', path: '/api/repo-docs/read', handler: (ctx) => handleRepoDocsRead(ctx, deps) },
    { method: 'GET', path: '/api/repo-docs/graph', handler: (ctx) => handleRepoDocsGraph(ctx, deps) },
    { method: 'POST', path: '/api/repo-docs/write', handler: (ctx) => handleRepoDocsWrite(ctx, deps) },
    { method: 'DELETE', path: '/api/repo-docs/delete', handler: (ctx) => handleRepoDocsDelete(ctx, deps) },
  ];
}

module.exports = {
  register,
  handleRepoDocsWrite,
  handleRepoDocsDelete,
};
