import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { RepoRoot } from '../config.js';
import {
  gitChangedFiles,
  gitDiff,
  listTree,
  listTreeDetailed,
  readFile,
  readMany,
  RepoAccessError,
  resolveAllowedPath,
  searchText,
  searchTextDetailed,
} from '../repoAccess.js';

async function withRoot(fn: (root: RepoRoot, dir: string) => Promise<void>) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'local-repo-mcp-'));
  const root: RepoRoot = { id: 'test', label: 'Test Root', rootPath: dir };
  try {
    await fn(root, dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test('resolveAllowedPath rejects traversal outside root', async () => {
  await withRoot(async (root) => {
    assert.throws(() => resolveAllowedPath(root, '..\\..\\Users\\lolzi\\.ssh\\id_rsa'), RepoAccessError);
  });
});

test('resolveAllowedPath rejects absolute paths', async () => {
  await withRoot(async (root) => {
    assert.throws(() => resolveAllowedPath(root, 'C:\\Users\\lolzi\\.ssh\\id_rsa'), RepoAccessError);
  });
});

test('resolveAllowedPath rejects URI-like paths', async () => {
  await withRoot(async (root) => {
    assert.throws(() => resolveAllowedPath(root, 'file://outside-root'), RepoAccessError);
    assert.throws(() => resolveAllowedPath(root, '\\\\server\\share'), RepoAccessError);
  });
});

test('readFile denies sensitive files', async () => {
  await withRoot(async (root, dir) => {
    await fs.writeFile(path.join(dir, '.env'), 'SECRET=value\n');
    await fs.writeFile(path.join(dir, 'id_ed25519'), 'private\n');
    await fs.writeFile(path.join(dir, 'cert.pem'), 'private\n');
    await assert.rejects(() => readFile(root, '.env'), RepoAccessError);
    await assert.rejects(() => readFile(root, 'id_ed25519'), RepoAccessError);
    await assert.rejects(() => readFile(root, 'cert.pem'), RepoAccessError);
  });
});

test('generic access denies every .git path', async () => {
  await withRoot(async (root, dir) => {
    await fs.mkdir(path.join(dir, '.git'), { recursive: true });
    await fs.writeFile(path.join(dir, '.git', 'config'), '[core]\n');
    await assert.rejects(() => readFile(root, '.git/config'), RepoAccessError);
    const entries = await listTree(root);
    assert.ok(!entries.some((entry) => entry.path.toLowerCase().includes('.git')));
  });
});

test('readFile supports bounded inclusive line ranges', async () => {
  await withRoot(async (root, dir) => {
    await fs.writeFile(path.join(dir, 'lines.txt'), 'one\ntwo\nthree\nfour\n');
    const result = await readFile(root, 'lines.txt', { startLine: 2, endLine: 3 });
    assert.equal(result.startLine, 2);
    assert.equal(result.endLine, 3);
    assert.equal(result.totalLines, 4);
    assert.equal(result.content, 'two\nthree');
  });
});

test('readFile streams a bounded range from a large text file', async () => {
  await withRoot(async (root, dir) => {
    const lines = Array.from({ length: 50000 }, (_, index) => `line-${index + 1}`);
    await fs.writeFile(path.join(dir, 'large.txt'), `${lines.join('\n')}\n`);
    const result = await readFile(root, 'large.txt', { startLine: 40000, endLine: 40002 });
    assert.equal(result.content, 'line-40000\nline-40001\nline-40002');
    assert.equal(result.totalLines, 50000);
    assert.ok(result.contentHash);
  });
});

test('readMany returns bounded files in request order', async () => {
  await withRoot(async (root, dir) => {
    await fs.writeFile(path.join(dir, 'a.ts'), 'const a = 1;\n');
    await fs.writeFile(path.join(dir, 'b.ts'), 'const b = 2;\n');
    const result = await readMany(root, [
      { path: 'b.ts' },
      { path: 'a.ts' },
    ]);
    assert.deepEqual(result.files.map((file) => file.path), ['b.ts', 'a.ts']);
    assert.deepEqual(result.errors, []);
  });
});

test('listTreeDetailed supports depth and explicit truncation', async () => {
  await withRoot(async (root, dir) => {
    await fs.mkdir(path.join(dir, 'src', 'nested'), { recursive: true });
    await fs.writeFile(path.join(dir, 'src', 'index.ts'), 'export {}\n');
    await fs.writeFile(path.join(dir, 'src', 'nested', 'deep.ts'), 'export {}\n');
    const result = await listTreeDetailed(root, { maxDepth: 2, limit: 2 });
    assert.ok(result.entries.every((entry) => (entry.depth || 0) <= 2));
    assert.equal(result.truncated, true);
    assert.equal(result.nextCursor, '2');
  });
});

test('searchTextDetailed supports globs and surrounding context', async () => {
  await withRoot(async (root, dir) => {
    await fs.mkdir(path.join(dir, 'src'), { recursive: true });
    await fs.writeFile(path.join(dir, 'src', 'a.ts'), 'before\nneedle\nafter\n');
    await fs.writeFile(path.join(dir, 'src', 'a.md'), 'needle in docs\n');
    const result = await searchTextDetailed(root, 'needle', {
      includeGlobs: ['**/*.ts'],
      contextBefore: 1,
      contextAfter: 1,
    });
    assert.equal(result.matches.length, 1);
    assert.equal(result.matches[0].lineStart, 2);
    assert.equal(result.matches[0].context, 'before\nneedle\nafter');
  });
});

test('gitDiff returns structured working-tree patches', async () => {
  await withRoot(async (root, dir) => {
    await runGitTest(dir, ['init']);
    await runGitTest(dir, ['config', 'user.email', 'test@example.com']);
    await runGitTest(dir, ['config', 'user.name', 'Test']);
    await fs.writeFile(path.join(dir, 'README.md'), 'before\n');
    await runGitTest(dir, ['add', 'README.md']);
    await runGitTest(dir, ['commit', '-m', 'initial']);
    await fs.writeFile(path.join(dir, 'README.md'), 'after\n');
    const result = await gitDiff(root);
    assert.equal(result.files.length, 1);
    assert.equal(result.files[0].path, 'README.md');
    assert.match(result.files[0].patch, /-before/);
    assert.match(result.files[0].patch, /\+after/);
  });
});

test('gitChangedFiles includes staged and untracked work', async () => {
  await withRoot(async (root, dir) => {
    await runGitTest(dir, ['init']);
    await runGitTest(dir, ['config', 'user.email', 'test@example.com']);
    await runGitTest(dir, ['config', 'user.name', 'Test']);
    await fs.writeFile(path.join(dir, 'tracked.txt'), 'before\n');
    await runGitTest(dir, ['add', 'tracked.txt']);
    await runGitTest(dir, ['commit', '-m', 'initial']);
    await fs.writeFile(path.join(dir, 'tracked.txt'), 'staged\n');
    await runGitTest(dir, ['add', 'tracked.txt']);
    await fs.writeFile(path.join(dir, 'untracked.txt'), 'new\n');
    const result = await gitChangedFiles(root);
    assert.deepEqual(result.files.map((file) => file.path).sort(), ['tracked.txt', 'untracked.txt']);
    assert.equal(result.files.find((file) => file.path === 'tracked.txt')?.staged, true);
    assert.equal(result.files.find((file) => file.path === 'untracked.txt')?.status, 'untracked');
  });
});

async function runGitTest(cwd: string, args: string[]): Promise<void> {
  const { execFile } = await import('node:child_process');
  await new Promise<void>((resolve, reject) => {
    execFile('git', args, { cwd }, (error, _stdout, stderr) => error ? reject(new Error(stderr || error.message)) : resolve());
  });
}

test('listTree skips denied directories', async () => {
  await withRoot(async (root, dir) => {
    await fs.mkdir(path.join(dir, 'src'), { recursive: true });
    await fs.mkdir(path.join(dir, 'node_modules', 'dep'), { recursive: true });
    await fs.writeFile(path.join(dir, 'src', 'index.ts'), 'hello\n');
    await fs.writeFile(path.join(dir, 'node_modules', 'dep', 'index.js'), 'hidden\n');
    const entries = await listTree(root);
    assert.ok(entries.some((entry) => entry.path === 'src\\index.ts' || entry.path === 'src/index.ts'));
    assert.ok(!entries.some((entry) => entry.path.includes('node_modules')));
  });
});

test('readFile enforces file size limit', async () => {
  await withRoot(async (root, dir) => {
    await fs.writeFile(path.join(dir, 'large.txt'), 'x'.repeat(200001));
    await assert.rejects(() => readFile(root, 'large.txt'), RepoAccessError);
  });
});

test('readFile rejects binary files', async () => {
  await withRoot(async (root, dir) => {
    await fs.writeFile(path.join(dir, 'binary.dat'), Buffer.from([0x66, 0x00, 0x67]));
    await assert.rejects(() => readFile(root, 'binary.dat'), RepoAccessError);
  });
});

test('searchText returns bounded matches from allowed files', async () => {
  await withRoot(async (root, dir) => {
    await fs.mkdir(path.join(dir, 'docs'), { recursive: true });
    await fs.writeFile(path.join(dir, 'docs', 'a.md'), 'alpha\nneedle one\nneedle two\n');
    const matches = await searchText(root, 'needle', '.', 1);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].line, 2);
  });
});
