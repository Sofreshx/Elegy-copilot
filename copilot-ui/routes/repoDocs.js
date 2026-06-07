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
        scanMarkdownFiles(resolvedPath, baseDir, results);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (ALLOWED_EXTENSIONS.has(ext)) {
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
      scanMarkdownFiles(fullPath, baseDir, results);
    } else if (lstat.isFile()) {
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
    sendJson(res, 403, { error: 'Path is not allowed. Only markdown files under specs/, docs/, or root README are accessible.' });
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

// ── Tree endpoint: broader scan with folder hierarchy ──

const TREE_ALLOWED_EXTENSIONS = new Set(['.md', '.markdown', '.toml', '.json']);
const TREE_MAX_DEPTH = 5;
const TREE_SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'target', '__pycache__']);

const TREE_SCAN_PATHS = [
  { prefix: 'specs/', dirKind: 'specs' },
  { prefix: 'docs/', dirKind: 'docs' },
  { prefix: 'skills/', dirKind: 'skills' },
  { prefix: 'agents/', dirKind: 'agents' },
  { prefix: '.opencode/', dirKind: 'harness', harness: 'opencode' },
  { prefix: '.codex/', dirKind: 'harness', harness: 'codex' },
  { prefix: '.copilot/', dirKind: 'harness', harness: 'copilot' },
  { prefix: '.gemini/', dirKind: 'harness', harness: 'antigravity' },
  { prefix: '.antigravity/', dirKind: 'harness', harness: 'antigravity' },
];

const TREE_ROOT_FILES = ['AGENTS.md', 'guidelines.md', 'README.md', 'readme.md', 'CHANGELOG.md', 'changelog.md'];

function walkFilesForTree(dir, baseDir, results, harness) {
  if (!fs.existsSync(dir)) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (TREE_SKIP_DIRS.has(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(baseDir, fullPath).replace(/\\/g, '/');

    // Compute depth from relative path
    const depth = relativePath.split('/').length;
    if (depth > TREE_MAX_DEPTH) continue;

    let lstat;
    try {
      lstat = fs.lstatSync(fullPath);
    } catch {
      continue;
    }

    if (lstat.isDirectory()) {
      walkFilesForTree(fullPath, baseDir, results, harness);
    } else if (lstat.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      const nameLower = entry.name.toLowerCase();
      // Accept .agent.md (double-ext) and all allowed extensions
      const isAllowed = TREE_ALLOWED_EXTENSIONS.has(ext) || nameLower.endsWith('.agent.md');
      if (!isAllowed) continue;

      try {
        const stat = fs.statSync(fullPath);
        if (stat.size > MAX_FILE_SIZE) continue;

        const fileEntry = {
          path: relativePath,
          name: entry.name,
          size: stat.size,
          modifiedAt: stat.mtime.toISOString(),
        };
        if (harness) fileEntry.harness = harness;
        results.push(fileEntry);
      } catch {
        // skip
      }
    }
  }
}

function classifyFileKind(filePath) {
  const normalized = filePath.replace(/\\/g, '/').toLowerCase();

  // Harness sub-paths: agent vs skill files
  if (normalized.includes('/agents/')) return 'agent';
  if (normalized.includes('/skills/')) return 'skill';

  // Top-level agent dir
  if (normalized.startsWith('agents/')) return 'agent';

  // Agent files by naming convention
  if (normalized.endsWith('.agent.md')) return 'agent';

  // Top-level skills dir
  if (normalized.startsWith('skills/')) return 'skill';

  // Manifest files
  const ext = path.extname(normalized).toLowerCase();
  if (ext === '.toml' || ext === '.json') return 'manifest';

  // Specs and docs
  if (normalized.startsWith('specs/') || normalized.startsWith('docs/')) return 'doc';

  // Config files under harness dirs
  if (normalized.startsWith('.opencode/') || normalized.startsWith('.codex/') ||
      normalized.startsWith('.copilot/') || normalized.startsWith('.gemini/') ||
      normalized.startsWith('.antigravity/')) return 'config';

  // Default
  return 'doc';
}

function classifyHarness(filePath) {
  const normalized = filePath.replace(/\\/g, '/');
  if (normalized.startsWith('.opencode/')) return 'opencode';
  if (normalized.startsWith('.codex/')) return 'codex';
  if (normalized.startsWith('.copilot/')) return 'copilot';
  if (normalized.startsWith('.gemini/')) return 'antigravity';
  if (normalized.startsWith('.antigravity/')) return 'antigravity';
  return undefined;
}

function classifyDirKind(dirPath) {
  const normalized = dirPath.replace(/\\/g, '/');
  for (const scanPath of TREE_SCAN_PATHS) {
    if (normalized === scanPath.prefix.replace(/\/$/, '') || normalized.startsWith(scanPath.prefix)) {
      return scanPath.dirKind;
    }
  }
  return undefined;
}

function buildTreeFromPaths(files) {
  const dirMap = new Map();
  const rootChildren = [];

  for (const file of files) {
    const parts = file.path.replace(/\\/g, '/').split('/');

    // Ensure all parent directory nodes exist
    let parent = rootChildren;
    let currentPath = '';

    for (let i = 0; i < parts.length - 1; i++) {
      currentPath = currentPath ? currentPath + '/' + parts[i] : parts[i];

      let dirNode = dirMap.get(currentPath);
      if (!dirNode) {
        dirNode = {
          name: parts[i],
          path: currentPath,
          kind: 'directory',
          children: [],
          collapsed: true,
          dirKind: classifyDirKind(currentPath),
        };
        dirMap.set(currentPath, dirNode);
        parent.push(dirNode);
      }
      parent = dirNode.children;
    }

    // Determine harness
    const harness = file.harness || classifyHarness(file.path);

    // Add file node
    const fileNode = {
      name: file.name,
      path: file.path,
      kind: 'file',
      size: file.size,
      modifiedAt: file.modifiedAt,
      fileKind: file.fileKind || classifyFileKind(file.path),
    };
    if (file.isSymlink) fileNode.isSymlink = true;
    if (file.resolvedPath) fileNode.resolvedPath = file.resolvedPath;
    if (file.blockedReason) fileNode.blockedReason = file.blockedReason;
    if (harness) fileNode.harness = harness;

    parent.push(fileNode);
  }

  // Sort: directories first alphabetically, then files alphabetically
  function sortTreeNodes(nodes) {
    nodes.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const node of nodes) {
      if (node.children && node.children.length > 0) {
        sortTreeNodes(node.children);
      }
    }
  }

  sortTreeNodes(rootChildren);
  return rootChildren;
}

function countTreeDirs(nodes) {
  let count = 0;
  for (const node of nodes) {
    if (node.kind === 'directory') {
      count++;
      if (node.children) count += countTreeDirs(node.children);
    }
  }
  return count;
}

function handleRepoDocsTree(ctx, deps) {
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

    // Scan each allowed path prefix
    for (const scanPath of TREE_SCAN_PATHS) {
      const fullPath = path.join(root, scanPath.prefix);
      walkFilesForTree(fullPath, root, files, scanPath.harness);
    }

    // Scan root files
    for (const rootFile of TREE_ROOT_FILES) {
      const fullPath = path.join(root, rootFile);
      if (fs.existsSync(fullPath)) {
        try {
          const stat = fs.statSync(fullPath);
          if (stat.size <= MAX_FILE_SIZE) {
            files.push({
              path: rootFile,
              name: rootFile,
              size: stat.size,
              modifiedAt: stat.mtime.toISOString(),
            });
          }
        } catch { /* skip */ }
      }
    }

    // Build tree
    const tree = buildTreeFromPaths(files);

    sendJson(res, 200, {
      repoPath: root,
      tree,
      totalFiles: files.length,
      totalDirs: countTreeDirs(tree),
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
    for (const subDir of ['specs', 'docs']) {
      scanMarkdownFiles(path.join(root, subDir), root, files);
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

function register(context = {}) {
  const sendJson = context.sendJson || defaultSendJson;
  const deps = { sendJson };

  return [
    { method: 'GET', path: '/api/repo-docs/list', handler: (ctx) => handleRepoDocsList(ctx, deps) },
    { method: 'GET', path: '/api/repo-docs/read', handler: (ctx) => handleRepoDocsRead(ctx, deps) },
    { method: 'GET', path: '/api/repo-docs/tree', handler: (ctx) => handleRepoDocsTree(ctx, deps) },
    { method: 'GET', path: '/api/repo-docs/graph', handler: (ctx) => handleRepoDocsGraph(ctx, deps) },
  ];
}

module.exports = { register };
