import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  DEFAULT_SEARCH_LIMIT,
  DEFAULT_TREE_LIMIT,
  MAX_BATCH_BYTES,
  MAX_BATCH_FILES,
  MAX_DIFF_BYTES,
  MAX_FILE_SIZE_BYTES,
  MAX_SEARCH_MATCHES,
  type RepoRoot,
} from './config.js';

export type TreeEntry = {
  path: string;
  type: 'file' | 'directory' | 'symlink';
  size?: number;
  depth?: number;
  tracked?: boolean;
};

export type TreeOptions = {
  path?: string;
  maxDepth?: number;
  includeFiles?: boolean;
  includeDirectories?: boolean;
  trackedOnly?: boolean;
  includeGlobs?: string[];
  excludeGlobs?: string[];
  limit?: number;
  cursor?: string;
};

export type TreeResult = {
  entries: TreeEntry[];
  truncated: boolean;
  nextCursor: string | null;
  warnings: string[];
};

export type SearchMatch = {
  path: string;
  line: number;
  preview: string;
  lineStart?: number;
  lineEnd?: number;
  context?: string;
  matchRanges?: Array<{ line: number; startColumn: number; endColumn: number }>;
};

export type SearchOptions = {
  path?: string;
  caseSensitive?: boolean;
  includeGlobs?: string[];
  excludeGlobs?: string[];
  contextBefore?: number;
  contextAfter?: number;
  maxMatches?: number;
  maxMatchesPerFile?: number;
  trackedOnly?: boolean;
  cursor?: string;
};

export type SearchResult = {
  query: string;
  filesSearched: number;
  matches: SearchMatch[];
  truncated: boolean;
  nextCursor: string | null;
};

export type ReadFileOptions = {
  startLine?: number;
  endLine?: number;
  maxBytes?: number;
};

export type ReadFileResult = {
  path: string;
  content: string;
  size: number;
  encoding: 'utf-8';
  contentHash: string;
  totalLines: number;
  startLine: number;
  endLine: number;
  truncated: boolean;
};

export type ReadManyRequest = {
  path: string;
  startLine?: number;
  endLine?: number;
};

export type ReadManyResult = {
  files: ReadFileResult[];
  errors: Array<{ path: string; code: string; message: string }>;
  omittedFiles: string[];
  truncated: boolean;
};

export type GitChangedFile = {
  path: string;
  oldPath?: string;
  newPath?: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'untracked' | 'conflicted' | 'type-changed';
  staged: boolean;
  tracked: boolean;
  binary: boolean;
  additions?: number;
  deletions?: number;
};

export type GitChangedFilesResult = {
  base: 'HEAD';
  head: 'WORKTREE';
  files: GitChangedFile[];
};

export type GitDiffOptions = {
  staged?: boolean;
  paths?: string[];
  contextLines?: number;
  maxBytes?: number;
};

export type GitDiffFile = {
  oldPath?: string;
  newPath?: string;
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'binary';
  binary: boolean;
  additions: number;
  deletions: number;
  patch: string;
};

export type GitDiffResult = {
  base: 'HEAD';
  head: 'WORKTREE' | 'INDEX';
  files: GitDiffFile[];
  truncated: boolean;
  nextCursor: string | null;
};

const DEFAULT_DENY_SEGMENTS = new Set([
  '.git', 'node_modules', 'target', 'bin', 'obj', 'dist', 'build', 'coverage',
  '.next', '.vite', '.cache', '.idea', '.vs', '.tmp', 'tmp',
]);
const DENY_FILENAMES = new Set(['.env', 'id_rsa', 'id_ed25519', 'credentials.json', 'secrets.json']);
const DENY_EXTENSIONS = new Set(['.pem', '.key']);

export class RepoAccessError extends Error {
  readonly code: string;

  constructor(message: string, code = 'REPO_ACCESS_ERROR') {
    super(message);
    this.name = 'RepoAccessError';
    this.code = code;
  }
}

export function findRoot(roots: RepoRoot[], rootId: string): RepoRoot {
  const root = roots.find((candidate) => candidate.id === rootId);
  if (!root) throw new RepoAccessError(`Unknown root: ${rootId}`, 'ROOT_NOT_FOUND');
  return root;
}

export function toPublicRoot(root: RepoRoot) {
  return { id: root.id, label: root.label };
}

export function resolveAllowedPath(root: RepoRoot, requestedPath = '.'): string {
  const relativePath = requestedPath.trim() || '.';
  if (isAbsoluteOrUriPath(relativePath)) {
    throw new RepoAccessError('Only paths relative to the selected root are allowed.', 'PATH_OUTSIDE_ROOT');
  }
  const resolvedRoot = path.resolve(root.rootPath);
  const resolvedPath = path.resolve(resolvedRoot, relativePath);
  const relation = path.relative(resolvedRoot, resolvedPath);
  if (relation === '..' || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation)) {
    throw new RepoAccessError('Path escapes the selected root.', 'PATH_OUTSIDE_ROOT');
  }
  assertPathAllowed(resolvedRoot, resolvedPath, root);
  return resolvedPath;
}

export function assertPathAllowed(resolvedRoot: string, resolvedPath: string, root?: RepoRoot): void {
  const relativePath = toRelativePosix(resolvedRoot, resolvedPath);
  const segments = relativePath.split('/').filter(Boolean);
  const lowerSegments = segments.map((segment) => segment.toLowerCase());
  if (lowerSegments.some((segment) => DEFAULT_DENY_SEGMENTS.has(segment))) {
    throw new RepoAccessError('Access to this path is denied.', 'PATH_DENIED');
  }
  const fileName = lowerSegments.at(-1) || '';
  if (DENY_FILENAMES.has(fileName) || (fileName.startsWith('.env.') && fileName !== '.env.example' && fileName !== '.env.template')) {
    throw new RepoAccessError('Access to this file is denied.', 'PATH_DENIED');
  }
  if (DENY_EXTENSIONS.has(path.posix.extname(fileName))) {
    throw new RepoAccessError('Access to this file type is denied.', 'PATH_DENIED');
  }
  for (const pattern of root?.denyPatterns || []) {
    if (globMatches(relativePath, pattern)) throw new RepoAccessError('Access to this path is denied.', 'PATH_DENIED');
  }
}

export async function listTree(root: RepoRoot, requestedPath = '.', limit = DEFAULT_TREE_LIMIT): Promise<TreeEntry[]> {
  const result = await listTreeDetailed(root, {
    path: requestedPath,
    maxDepth: Number.POSITIVE_INFINITY,
    limit,
  });
  return result.entries;
}

export async function listTreeDetailed(root: RepoRoot, options: TreeOptions = {}): Promise<TreeResult> {
  const requestedPath = options.path || '.';
  const startPath = resolveAllowedPath(root, requestedPath);
  await assertSafeExistingPath(root, startPath);
  const limit = clampInteger(options.limit ?? DEFAULT_TREE_LIMIT, 1, 2000);
  const maxDepth = options.maxDepth === undefined ? 2 : Math.max(0, Math.min(options.maxDepth, 100));
  const cursorOffset = parseCursor(options.cursor);
  const trackedOnly = options.trackedOnly ?? root.trackedFilesOnlyByDefault ?? true;
  const trackedPaths = trackedOnly ? await getTrackedPaths(root) : null;
  const entries: TreeEntry[] = [];
  let seen = 0;
  let hasMore = false;

  const visit = async (currentPath: string): Promise<boolean> => {
    assertPathAllowed(path.resolve(root.rootPath), currentPath, root);
    const stats = await fs.lstat(currentPath);
    const relativePath = toRelativePosix(root.rootPath, currentPath);
    const relativeFromStart = toRelativePosix(startPath, currentPath);
    const depth = relativeFromStart === '.' ? 0 : relativeFromStart.split('/').length;
    const isSymlink = stats.isSymbolicLink();
    const isFile = stats.isFile();
    const isDirectory = stats.isDirectory();
    const isTracked = trackedPaths ? isTrackedPath(relativePath, trackedPaths) : undefined;
    const eligible = isSymlink || isFile || isDirectory;
    const includeType = isSymlink || (isFile ? options.includeFiles !== false : options.includeDirectories !== false);
    const matches = eligible && includeType && matchesTreeFilters(relativePath, options, isDirectory);
    const trackedEligible = !trackedPaths || isSymlink || isTracked || (isDirectory && hasTrackedDescendant(relativePath, trackedPaths));
    if (matches && trackedEligible && relativeFromStart !== '.') {
      if (seen < cursorOffset) {
        seen += 1;
      } else if (entries.length < limit) {
        entries.push({
          path: relativePath,
          type: isSymlink ? 'symlink' : isDirectory ? 'directory' : 'file',
          size: isFile ? stats.size : undefined,
          depth,
          tracked: isFile && trackedPaths ? isTracked : undefined,
        });
        seen += 1;
      } else {
        hasMore = true;
        return true;
      }
    }
    if (!isDirectory || isSymlink || depth >= maxDepth) return false;
    const children = await fs.readdir(currentPath, { withFileTypes: true });
    children.sort((a, b) => a.name.localeCompare(b.name));
    for (const child of children) {
      try {
        if (await visit(path.join(currentPath, child.name))) return true;
      } catch (error) {
        if (error instanceof RepoAccessError) continue;
        throw error;
      }
    }
    return false;
  };

  await visit(startPath);
  return {
    entries,
    truncated: hasMore,
    nextCursor: hasMore ? String(cursorOffset + entries.length) : null,
    warnings: trackedOnly && trackedPaths === null ? ['Git file filtering was unavailable; filesystem filtering was used.'] : [],
  };
}

export async function readFile(root: RepoRoot, requestedPath: string, options: ReadFileOptions = {}): Promise<ReadFileResult> {
  const filePath = resolveAllowedPath(root, requestedPath);
  await assertSafeExistingPath(root, filePath);
  const stats = await fs.lstat(filePath);
  if (stats.isSymbolicLink()) throw new RepoAccessError('Symbolic links are not readable.', 'SYMLINK_DENIED');
  if (!stats.isFile()) throw new RepoAccessError('Path is not a file.', 'NOT_A_FILE');
  const boundedBytes = clampInteger(options.maxBytes ?? MAX_FILE_SIZE_BYTES, 1, MAX_FILE_SIZE_BYTES);
  const hasExplicitRange = options.startLine !== undefined || options.endLine !== undefined;
  if (!hasExplicitRange && stats.size > boundedBytes) {
    throw new RepoAccessError(`File is too large. Limit is ${boundedBytes} bytes.`, 'FILE_TOO_LARGE');
  }

  const hash = createHash('sha256');
  const selectedLines: string[] = [];
  const startLine = options.startLine ?? 1;
  const requestedEndLine = options.endLine ?? Number.POSITIVE_INFINITY;
  let totalLines = 0;
  let pending = '';
  let endedWithNewline = false;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let position = 0;
    while (true) {
      const result = await handle.read(buffer, 0, buffer.length, position);
      if (result.bytesRead === 0) break;
      position += result.bytesRead;
      const bytes = buffer.subarray(0, result.bytesRead);
      if (bytes.includes(0)) throw new RepoAccessError('Binary files are not readable.', 'BINARY_FILE');
      hash.update(bytes);
      pending += decoder.decode(bytes, { stream: true });
      const parts = pending.split('\n');
      pending = parts.pop() || '';
      for (const part of parts) {
        totalLines += 1;
        if (totalLines >= startLine && totalLines <= requestedEndLine) selectedLines.push(stripCarriageReturn(part));
      }
    }
    pending += decoder.decode();
    endedWithNewline = pending.length === 0 && totalLines > 0;
    if (pending.length > 0) {
      totalLines += 1;
      if (totalLines >= startLine && totalLines <= requestedEndLine) selectedLines.push(stripCarriageReturn(pending));
    }
  } catch (error) {
    if (error instanceof TypeError) throw new RepoAccessError('File is not valid UTF-8 text.', 'BINARY_FILE');
    throw error;
  } finally {
    await handle.close();
  }

  if (totalLines === 0) {
    if (options.startLine !== undefined || options.endLine !== undefined) {
      throw new RepoAccessError('Invalid line range.', 'INVALID_LINE_RANGE');
    }
  } else if (!Number.isInteger(startLine) || (requestedEndLine !== Number.POSITIVE_INFINITY && !Number.isInteger(requestedEndLine)) || startLine < 1 || startLine > totalLines || requestedEndLine < startLine || (requestedEndLine !== Number.POSITIVE_INFINITY && requestedEndLine > totalLines)) {
    throw new RepoAccessError('Invalid line range.', 'INVALID_LINE_RANGE');
  }

  const completeContent = `${selectedLines.join('\n')}${!hasExplicitRange && endedWithNewline ? '\n' : ''}`;
  const completeBytes = Buffer.from(completeContent, 'utf8');
  const truncated = completeBytes.byteLength > boundedBytes;
  const content = truncated ? truncateUtf8(completeBytes, boundedBytes) : completeContent;
  const effectiveEndLine = totalLines === 0 ? 0 : Math.min(requestedEndLine, totalLines);
  return {
    path: toRelativePosix(root.rootPath, filePath),
    content,
    size: stats.size,
    encoding: 'utf-8',
    contentHash: hash.digest('hex'),
    totalLines,
    startLine: totalLines === 0 ? 1 : startLine,
    endLine: effectiveEndLine,
    truncated,
  };
}

export async function readMany(root: RepoRoot, requests: ReadManyRequest[], maxTotalBytes = MAX_BATCH_BYTES): Promise<ReadManyResult> {
  const files: ReadFileResult[] = [];
  const errors: ReadManyResult['errors'] = [];
  const omittedFiles: string[] = [];
  const totalLimit = clampInteger(maxTotalBytes, 1, MAX_BATCH_BYTES);
  let totalBytes = 0;
  let truncated = false;
  for (const request of requests.slice(0, MAX_BATCH_FILES)) {
    try {
      const file = await readFile(root, request.path, {
        startLine: request.startLine,
        endLine: request.endLine,
      });
      const bytes = Buffer.byteLength(file.content, 'utf8');
      if (totalBytes + bytes > totalLimit) {
        omittedFiles.push(request.path);
        truncated = true;
        continue;
      }
      totalBytes += bytes;
      files.push(file);
    } catch (error) {
      const repoError = error instanceof RepoAccessError ? error : new RepoAccessError(String(error));
      errors.push({ path: request.path, code: repoError.code, message: repoError.message });
    }
  }
  if (requests.length > MAX_BATCH_FILES) {
    omittedFiles.push(...requests.slice(MAX_BATCH_FILES).map((request) => request.path));
    truncated = true;
  }
  return { files, errors, omittedFiles, truncated };
}

export async function searchText(root: RepoRoot, query: string, requestedPath = '.', limit = DEFAULT_SEARCH_LIMIT): Promise<SearchMatch[]> {
  const result = await searchTextDetailed(root, query, { path: requestedPath, maxMatches: limit });
  return result.matches.map((match) => ({ path: match.path, line: match.lineStart || match.line, preview: match.preview }));
}

export async function searchTextDetailed(root: RepoRoot, query: string, options: SearchOptions = {}): Promise<SearchResult> {
  const trimmed = query.trim();
  if (!trimmed) throw new RepoAccessError('Search query is required.', 'INVALID_SEARCH');
  const maxMatches = clampInteger(options.maxMatches ?? DEFAULT_SEARCH_LIMIT, 1, MAX_SEARCH_MATCHES);
  const maxMatchesPerFile = clampInteger(options.maxMatchesPerFile ?? maxMatches, 1, maxMatches);
  const contextBefore = clampInteger(options.contextBefore ?? 0, 0, 20);
  const contextAfter = clampInteger(options.contextAfter ?? 0, 0, 20);
  const cursorOffset = parseCursor(options.cursor);
  const tree = await listTreeDetailed(root, {
    path: options.path || '.',
    maxDepth: Number.POSITIVE_INFINITY,
    trackedOnly: options.trackedOnly,
    includeFiles: true,
    includeDirectories: false,
    includeGlobs: options.includeGlobs,
    excludeGlobs: options.excludeGlobs,
    limit: 5000,
  });
  const matches: SearchMatch[] = [];
  let filesSearched = 0;
  let seenMatches = 0;
  let truncated = tree.truncated;
  const needle = options.caseSensitive ? trimmed : trimmed.toLowerCase();
  for (const entry of tree.entries) {
    if (entry.type !== 'file' || (entry.size || 0) > MAX_FILE_SIZE_BYTES) continue;
    filesSearched += 1;
    let file: ReadFileResult;
    try {
      file = await readFile(root, entry.path);
    } catch {
      continue;
    }
    const lines = file.content.split('\n');
    const haystack = options.caseSensitive ? file.content : file.content.toLowerCase();
    let position = 0;
    let fileMatches = 0;
    while (fileMatches < maxMatchesPerFile) {
      const found = haystack.indexOf(needle, position);
      if (found < 0) break;
      position = found + Math.max(needle.length, 1);
      fileMatches += 1;
      seenMatches += 1;
      if (seenMatches <= cursorOffset) continue;
      const lineStart = file.content.slice(0, found).split('\n').length;
      if (matches.length >= maxMatches) {
        truncated = true;
        break;
      }
      const contextStart = Math.max(1, lineStart - contextBefore);
      const contextEnd = Math.min(lines.length, lineStart + contextAfter);
      matches.push({
        path: file.path,
        line: lineStart,
        preview: lines[lineStart - 1].slice(0, 240),
        lineStart,
        lineEnd: lineStart,
        context: lines.slice(contextStart - 1, contextEnd).join('\n'),
        matchRanges: [{ line: lineStart, startColumn: found - file.content.lastIndexOf('\n', found - 1), endColumn: found - file.content.lastIndexOf('\n', found - 1) + trimmed.length }],
      });
    }
    if (matches.length >= maxMatches) {
      truncated = true;
      break;
    }
  }
  return {
    query: trimmed,
    filesSearched,
    matches,
    truncated,
    nextCursor: truncated ? String(cursorOffset + matches.length) : null,
  };
}

export async function gitStatus(root: RepoRoot): Promise<string> {
  return runGit(root.rootPath, ['status', '--short']);
}

export async function gitLog(root: RepoRoot, limit = 20): Promise<string> {
  return runGit(root.rootPath, ['log', `-${clampInteger(limit, 1, 100)}`, '--oneline', '--decorate']);
}

export async function gitChangedFiles(root: RepoRoot, options: { includeUntracked?: boolean; includeStaged?: boolean } = {}): Promise<GitChangedFilesResult> {
  const includeUntracked = options.includeUntracked !== false;
  const includeStaged = options.includeStaged !== false;
  const status = await runGit(root.rootPath, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--']);
  const stats = new Map<string, { additions?: number; deletions?: number; binary: boolean }>();
  await addNumstats(root, stats, false);
  if (includeStaged) await addNumstats(root, stats, true);
  const tokens = status.split('\0').filter(Boolean);
  const files: GitChangedFile[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const xy = token.slice(0, 2);
    let currentPath = token.slice(3).replaceAll('\\', '/');
    let oldPath: string | undefined;
    if (xy[0] === 'R' || xy[0] === 'C') {
      oldPath = currentPath;
      currentPath = (tokens[index + 1] || '').replaceAll('\\', '/');
      index += 1;
    }
    const untracked = xy === '??';
    const staged = xy[0] !== ' ' && xy[0] !== '?';
    const hasUnstaged = xy[1] !== ' ' && xy[1] !== '?';
    if (untracked && !includeUntracked) continue;
    if (staged && !includeStaged && !hasUnstaged) continue;
    const statusValue = untracked ? 'untracked' : mapGitStatus(xy);
    const stat = stats.get(currentPath) || { binary: false };
    files.push({
      path: currentPath,
      oldPath,
      newPath: oldPath ? currentPath : undefined,
      status: statusValue,
      staged,
      tracked: !untracked,
      binary: stat.binary,
      additions: stat.additions,
      deletions: stat.deletions,
    });
  }
  return { base: 'HEAD', head: 'WORKTREE', files };
}

export async function gitDiff(root: RepoRoot, contextLinesOrOptions: number | GitDiffOptions = 3): Promise<GitDiffResult> {
  const options: GitDiffOptions = typeof contextLinesOrOptions === 'number'
    ? { contextLines: contextLinesOrOptions }
    : contextLinesOrOptions;
  const contextLines = clampInteger(options.contextLines ?? 3, 0, 20);
  const maxBytes = clampInteger(options.maxBytes ?? MAX_DIFF_BYTES, 1, MAX_DIFF_BYTES);
  const args = ['diff'];
  if (options.staged) args.push('--cached');
  args.push('--no-ext-diff', '--no-color', `--unified=${contextLines}`);
  if (options.paths?.length) {
    for (const requestedPath of options.paths) resolveAllowedPath(root, requestedPath);
    args.push('--', ...options.paths.map((requestedPath) => requestedPath.replaceAll('\\', '/')));
  } else {
    args.push('--');
  }
  const result = await runGitBounded(root.rootPath, args, maxBytes);
  const files: GitDiffFile[] = [];
  for (const chunk of result.stdout.split(/^diff --git /m).filter(Boolean)) {
    const header = chunk.match(/^a\/(.*?) b\/(.*?)(?:\r?\n|$)/);
    if (!header) continue;
    const oldPath = header[1];
    const newPath = header[2];
    const patch = `diff --git ${chunk}`.trim();
    const binary = /Binary files /i.test(patch);
    const additions = binary ? 0 : patch.split(/\r?\n/).filter((line) => line.startsWith('+') && !line.startsWith('+++')).length;
    const deletions = binary ? 0 : patch.split(/\r?\n/).filter((line) => line.startsWith('-') && !line.startsWith('---')).length;
    const status = patch.includes('new file mode') ? 'added' : patch.includes('deleted file mode') ? 'deleted' : patch.includes('rename from') ? 'renamed' : binary ? 'binary' : 'modified';
    files.push({ oldPath, newPath, path: newPath, status, binary, additions, deletions, patch });
  }
  return { base: 'HEAD', head: options.staged ? 'INDEX' : 'WORKTREE', files, truncated: result.truncated, nextCursor: null };
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) throw new RepoAccessError('Numeric limit must be finite.', 'INVALID_LIMIT');
  return Math.max(min, Math.min(Math.trunc(value), max));
}

function parseCursor(cursor?: string): number {
  if (cursor === undefined || cursor === '') return 0;
  if (!/^\d+$/.test(cursor)) throw new RepoAccessError('Invalid cursor.', 'INVALID_CURSOR');
  return Number(cursor);
}

function isAbsoluteOrUriPath(value: string): boolean {
  return path.isAbsolute(value) || value.startsWith('\\\\') || value.startsWith('//') || /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
}

function toRelativePosix(rootPath: string, targetPath: string): string {
  return (path.relative(rootPath, targetPath) || '.').replaceAll('\\', '/');
}

function stripCarriageReturn(value: string): string {
  return value.endsWith('\r') ? value.slice(0, -1) : value;
}

function truncateUtf8(buffer: Buffer, maxBytes: number): string {
  let end = Math.min(buffer.byteLength, maxBytes);
  while (end > 0) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, end));
    } catch {
      end -= 1;
    }
  }
  return '';
}

function globMatches(relativePath: string, pattern: string): boolean {
  const normalizedPath = relativePath.replaceAll('\\', '/').replace(/^\.\//, '');
  const normalizedPattern = pattern.replaceAll('\\', '/').replace(/^\.\//, '');
  let expression = '';
  for (let index = 0; index < normalizedPattern.length; index += 1) {
    const character = normalizedPattern[index];
    if (character === '*') {
      if (normalizedPattern[index + 1] === '*') {
        expression += '.*';
        index += 1;
      } else {
        expression += '[^/]*';
      }
    } else if (character === '?') {
      expression += '[^/]';
    } else {
      expression += character.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${expression}$`, 'i').test(normalizedPath)
    || (normalizedPattern.startsWith('**/') && new RegExp(`^${expression.slice(3)}$`, 'i').test(normalizedPath));
}

function matchesTreeFilters(relativePath: string, options: TreeOptions, isDirectory: boolean): boolean {
  if (options.excludeGlobs?.some((pattern) => globMatches(relativePath, pattern))) return false;
  if (!options.includeGlobs?.length) return true;
  if (options.includeGlobs.some((pattern) => globMatches(relativePath, pattern))) return true;
  return isDirectory && options.includeGlobs.some((pattern) => pattern.includes('**') || pattern.startsWith(`${relativePath}/`));
}

async function assertSafeExistingPath(root: RepoRoot, resolvedPath: string): Promise<void> {
  const configuredRoot = path.resolve(root.rootPath);
  let rootStats;
  try {
    rootStats = await fs.lstat(configuredRoot);
  } catch {
    throw new RepoAccessError('Configured root does not exist.', 'ROOT_NOT_FOUND');
  }
  if (rootStats.isSymbolicLink()) throw new RepoAccessError('Configured roots may not be symbolic links.', 'SYMLINK_DENIED');
  const relative = path.relative(configuredRoot, resolvedPath);
  let current = configuredRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const stats = await fs.lstat(current).catch(() => null);
    if (stats?.isSymbolicLink()) throw new RepoAccessError('Symbolic-link traversal is denied.', 'SYMLINK_DENIED');
  }
  let realRoot: string;
  let realPath: string;
  try {
    realRoot = await fs.realpath(configuredRoot);
    realPath = await fs.realpath(resolvedPath);
  } catch {
    throw new RepoAccessError('Path does not exist.', 'PATH_NOT_FOUND');
  }
  const relation = path.relative(realRoot, realPath);
  if (relation === '..' || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation)) {
    throw new RepoAccessError('Path escapes the selected root.', 'PATH_OUTSIDE_ROOT');
  }
}

async function getTrackedPaths(root: RepoRoot): Promise<Set<string> | null> {
  try {
    const output = await runGit(root.rootPath, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']);
    return new Set(output.split('\0').filter(Boolean).map((value) => value.replaceAll('\\', '/')));
  } catch {
    return null;
  }
}

function isTrackedPath(relativePath: string, trackedPaths: Set<string>): boolean {
  return trackedPaths.has(relativePath) || trackedPaths.has(relativePath.replace(/^\.\//, ''));
}

function hasTrackedDescendant(relativePath: string, trackedPaths: Set<string>): boolean {
  const prefix = relativePath === '.' ? '' : `${relativePath}/`;
  return Array.from(trackedPaths).some((candidate) => candidate.startsWith(prefix));
}

function mapGitStatus(xy: string): GitChangedFile['status'] {
  if (xy.includes('U')) return 'conflicted';
  if (xy.includes('R')) return 'renamed';
  if (xy.includes('C')) return 'copied';
  if (xy.includes('T')) return 'type-changed';
  if (xy.includes('D')) return 'deleted';
  if (xy.includes('A')) return 'added';
  return 'modified';
}

async function addNumstats(root: RepoRoot, stats: Map<string, { additions?: number; deletions?: number; binary: boolean }>, staged: boolean): Promise<void> {
  try {
    const args = ['diff'];
    if (staged) args.push('--cached');
    args.push('--numstat', '--');
    const output = await runGit(root.rootPath, args);
    for (const line of output.split(/\r?\n/).filter(Boolean)) {
      const parts = line.split('\t');
      if (parts.length < 3) continue;
      const filePath = parts.slice(2).join('\t').replaceAll('\\', '/');
      stats.set(filePath, {
        additions: parts[0] === '-' ? undefined : Number(parts[0]),
        deletions: parts[1] === '-' ? undefined : Number(parts[1]),
        binary: parts[0] === '-' || parts[1] === '-',
      });
    }
  } catch {
    // A non-Git root is reported by the caller's primary Git operation.
  }
}

function runGit(cwd: string, args: string[]): Promise<string> {
  return runGitBounded(cwd, args, 1_000_000).then((result) => result.stdout);
}

function runGitBounded(cwd: string, args: string[], maxBytes: number): Promise<{ stdout: string; truncated: boolean }> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let outputBytes = 0;
    let truncated = false;
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      child.kill();
      reject(new RepoAccessError('Git operation timed out.', 'GIT_TIMEOUT'));
    }, 15000);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      const chunkBytes = Buffer.byteLength(chunk, 'utf8');
      if (outputBytes < maxBytes) {
        const remaining = maxBytes - outputBytes;
        stdout += chunkBytes <= remaining ? chunk : Buffer.from(chunk, 'utf8').subarray(0, remaining).toString('utf8');
      }
      outputBytes += chunkBytes;
      if (outputBytes > maxBytes) truncated = true;
    });
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    child.on('error', (error) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      if (code === 0 || truncated) resolve({ stdout: stdout.trim(), truncated });
      else reject(new RepoAccessError((stderr || `git exited with ${code}`).trim(), 'GIT_ERROR'));
    });
  });
}
