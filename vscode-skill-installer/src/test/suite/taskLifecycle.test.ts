import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { __taskLifecycleTestExports } from '../../taskLifecycle';

suite('Task lifecycle helpers', () => {
	test('getUniqueArchivePath allocates deterministic suffixes', async () => {
		const tmpRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'skill-installer-tasks-'));
		try {
			const archiveDir = path.join(tmpRoot, 'tasks.archive');
			await fs.promises.mkdir(archiveDir, { recursive: true });

			const base = path.join(archiveDir, 'task-000001--example.md');
			await fs.promises.writeFile(base, 'x', 'utf8');

			const next1 = __taskLifecycleTestExports.getUniqueArchivePath(base);
			assert.strictEqual(next1, path.join(archiveDir, 'task-000001--example--archived-2.md'));
			await fs.promises.writeFile(next1, 'y', 'utf8');

			const next2 = __taskLifecycleTestExports.getUniqueArchivePath(base);
			assert.strictEqual(next2, path.join(archiveDir, 'task-000001--example--archived-3.md'));
		} finally {
			await fs.promises.rm(tmpRoot, { recursive: true, force: true });
		}
	});

	test('listMarkdownFilesRecursive finds nested .md files only', async () => {
		const tmpRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'skill-installer-archive-'));
		try {
			const archiveDir = path.join(tmpRoot, '.instructions', 'tasks.archive');
			const nested = path.join(archiveDir, 'a', 'b');
			await fs.promises.mkdir(nested, { recursive: true });

			const f1 = path.join(archiveDir, 'one.md');
			const f2 = path.join(archiveDir, 'a', 'two.md');
			const f3 = path.join(nested, 'three.md');
			const ignored = path.join(nested, 'four.txt');

			await Promise.all([
				fs.promises.writeFile(f1, '1', 'utf8'),
				fs.promises.writeFile(f2, '2', 'utf8'),
				fs.promises.writeFile(f3, '3', 'utf8'),
				fs.promises.writeFile(ignored, 'no', 'utf8')
			]);

			const files = __taskLifecycleTestExports.listMarkdownFilesRecursive(archiveDir);
			assert.deepStrictEqual(files, [f1, f2, f3].sort((a, b) => a.localeCompare(b)));
		} finally {
			await fs.promises.rm(tmpRoot, { recursive: true, force: true });
		}
	});
});
