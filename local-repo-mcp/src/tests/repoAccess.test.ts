import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { RepoRoot } from '../config.js';
import { listTree, readFile, RepoAccessError, resolveAllowedPath, searchText } from '../repoAccess.js';

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
