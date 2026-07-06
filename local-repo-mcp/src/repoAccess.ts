import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  DEFAULT_SEARCH_LIMIT,
  DEFAULT_TREE_LIMIT,
  MAX_FILE_SIZE_BYTES,
  type RepoRoot,
} from './config.js';

export type TreeEntry = {
  path: string;
  type: 'file' | 'directory';
  size?: number;
};

export type SearchMatch = {
  path: string;
  line: number;
  preview: string;
};

const DENY_SEGMENTS = new Set(['node_modules', 'target', 'bin', 'obj', '.cache', '.tmp', 'tmp', 'dist', 'build']);
const DENY_FILENAMES = new Set(['.env', 'id_rsa', 'id_ed25519']);
const DENY_EXTENSIONS = new Set(['.pem', '.key']);

export class RepoAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RepoAccessError';
  }
}

export function findRoot(roots: RepoRoot[], rootId: string): RepoRoot {
  const root = roots.find((candidate) => candidate.id === rootId);
  if (!root) throw new RepoAccessError(`Unknown root: ${rootId}`);
  return root;
}

export function toPublicRoot(root: RepoRoot) {
  return { id: root.id, label: root.label, path: root.rootPath };
}

export function resolveAllowedPath(root: RepoRoot, requestedPath = '.'): string {
  const relativePath = requestedPath.trim() || '.';
  if (path.isAbsolute(relativePath)) {
    throw new RepoAccessError('Absolute paths are not allowed. Use a path relative to the selected root.');
  }
  const resolvedRoot = path.resolve(root.rootPath);
  const resolvedPath = path.resolve(resolvedRoot, relativePath);
  const relation = path.relative(resolvedRoot, resolvedPath);
  if (relation === '..' || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation)) {
    throw new RepoAccessError('Path escapes the selected root.');
  }
  assertPathAllowed(resolvedRoot, resolvedPath);
  return resolvedPath;
}

export function assertPathAllowed(resolvedRoot: string, resolvedPath: string): void {
  const relativePath = path.relative(resolvedRoot, resolvedPath);
  const segments = relativePath.split(path.sep).filter(Boolean);
  const lowerSegments = segments.map((segment) => segment.toLowerCase());
  if (lowerSegments.includes('.git') && lowerSegments.includes('objects')) {
    throw new RepoAccessError('.git/objects is denied.');
  }
  for (const segment of lowerSegments) {
    if (DENY_SEGMENTS.has(segment)) throw new RepoAccessError(`Denied path segment: ${segment}`);
  }
  const fileName = lowerSegments.at(-1) || '';
  if (DENY_FILENAMES.has(fileName)) throw new RepoAccessError(`Denied file name: ${fileName}`);
  if (fileName.startsWith('.env.')) throw new RepoAccessError('Environment files are denied.');
  if (DENY_EXTENSIONS.has(path.extname(fileName))) {
    throw new RepoAccessError(`Denied file extension: ${path.extname(fileName)}`);
  }
}

export async function listTree(root: RepoRoot, requestedPath = '.', limit = DEFAULT_TREE_LIMIT): Promise<TreeEntry[]> {
  const startPath = resolveAllowedPath(root, requestedPath);
  const entries: TreeEntry[] = [];
  await walk(root.rootPath, startPath, entries, Math.max(1, Math.min(limit, 2000)));
  return entries;
}

async function walk(resolvedRoot: string, currentPath: string, entries: TreeEntry[], limit: number): Promise<void> {
  if (entries.length >= limit) return;
  assertPathAllowed(resolvedRoot, currentPath);
  const stats = await fs.stat(currentPath);
  const relativePath = path.relative(resolvedRoot, currentPath) || '.';
  if (stats.isFile()) {
    entries.push({ path: relativePath, type: 'file', size: stats.size });
    return;
  }
  if (!stats.isDirectory()) return;
  if (relativePath !== '.') entries.push({ path: relativePath, type: 'directory' });
  const children = await fs.readdir(currentPath, { withFileTypes: true });
  children.sort((a, b) => a.name.localeCompare(b.name));
  for (const child of children) {
    if (entries.length >= limit) return;
    const childPath = path.join(currentPath, child.name);
    try {
      assertPathAllowed(resolvedRoot, childPath);
    } catch {
      continue;
    }
    if (child.isDirectory() || child.isFile()) await walk(resolvedRoot, childPath, entries, limit);
  }
}

export async function readFile(root: RepoRoot, requestedPath: string): Promise<{ path: string; content: string; size: number }> {
  const filePath = resolveAllowedPath(root, requestedPath);
  const stats = await fs.stat(filePath);
  if (!stats.isFile()) throw new RepoAccessError('Path is not a file.');
  if (stats.size > MAX_FILE_SIZE_BYTES) throw new RepoAccessError(`File is too large. Limit is ${MAX_FILE_SIZE_BYTES} bytes.`);
  const buffer = await fs.readFile(filePath);
  if (buffer.includes(0)) throw new RepoAccessError('Binary files are not readable through this MCP.');
  return { path: path.relative(root.rootPath, filePath), content: buffer.toString('utf8'), size: stats.size };
}

export async function searchText(root: RepoRoot, query: string, requestedPath = '.', limit = DEFAULT_SEARCH_LIMIT): Promise<SearchMatch[]> {
  const trimmed = query.trim();
  if (!trimmed) throw new RepoAccessError('Search query is required.');
  const matches: SearchMatch[] = [];
  const entries = await listTree(root, requestedPath, 5000);
  const fileEntries = entries.filter((entry) => entry.type === 'file' && (entry.size || 0) <= MAX_FILE_SIZE_BYTES);
  const maxMatches = Math.max(1, Math.min(limit, 500));
  for (const entry of fileEntries) {
    if (matches.length >= maxMatches) break;
    try {
      const file = await readFile(root, entry.path);
      const lines = file.content.split(/\r?\n/);
      for (let index = 0; index < lines.length && matches.length < maxMatches; index += 1) {
        if (lines[index].toLowerCase().includes(trimmed.toLowerCase())) {
          matches.push({ path: file.path, line: index + 1, preview: lines[index].slice(0, 240) });
        }
      }
    } catch {
      continue;
    }
  }
  return matches;
}

export async function gitStatus(root: RepoRoot): Promise<string> {
  return runGit(root.rootPath, ['status', '--short']);
}

export async function gitLog(root: RepoRoot, limit = 20): Promise<string> {
  return runGit(root.rootPath, ['log', `-${Math.max(1, Math.min(limit, 100))}`, '--oneline', '--decorate']);
}

function runGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new RepoAccessError((stderr || `git exited with ${code}`).trim()));
    });
  });
}
