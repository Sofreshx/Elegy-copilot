import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { __taskLifecycleTestExports } from '../../taskLifecycle';
import { __taskScannerTestExports } from '../../taskScanner';
import { __legacyMigrationTestExports } from '../../legacyMigration';
import { getRepoStateRootDir, getRepoTasksDir } from '../../enginePaths';

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
			const archiveDir = path.join(tmpRoot, 'repo-state', 'tasks.archive');
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

	test('task scanner reads canonical repo-state tasks and ignores repo-local legacy task files', async () => {
		const repoPath = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'skill-installer-task-scan-'));
		const repoStateRoot = getRepoStateRootDir(repoPath);
		try {
			const canonicalTasksDir = getRepoTasksDir(repoPath);
			const legacyTasksDir = __taskScannerTestExports.getLegacyRepoTasksDir(repoPath);
			await fs.promises.mkdir(canonicalTasksDir, { recursive: true });
			await fs.promises.mkdir(legacyTasksDir, { recursive: true });

			await fs.promises.writeFile(
				path.join(canonicalTasksDir, 'task-001.md'),
				[
					'---',
					'id: WU-001',
					'title: Canonical task',
					'status: in_progress',
					'owner: lolzi',
					'---',
					'Canonical store task'
				].join('\n'),
				'utf8'
			);
			await fs.promises.writeFile(
				path.join(legacyTasksDir, 'task-legacy.md'),
				[
					'---',
					'id: WU-LEGACY',
					'title: Legacy task',
					'status: todo',
					'---',
					'Legacy repo-local task'
				].join('\n'),
				'utf8'
			);

			const repo = __taskScannerTestExports.scanRepoTasksForPath('example-repo', repoPath, false, '');
			assert.strictEqual(repo.tasksDirPath, canonicalTasksDir);
			assert.deepStrictEqual(repo.tasks.map((task) => task.id), ['WU-001']);
			assert.deepStrictEqual(repo.tasks.map((task) => task.label), ['Canonical task']);
		} finally {
			await fs.promises.rm(repoPath, { recursive: true, force: true });
			await fs.promises.rm(repoStateRoot, { recursive: true, force: true });
		}
	});

	test('legacy task migration helper only imports markdown task files', async () => {
		const tmpRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'skill-installer-legacy-tasks-'));
		try {
			const srcDir = path.join(tmpRoot, 'legacy', 'tasks');
			const destDir = path.join(tmpRoot, 'repo-state', 'tasks');
			await fs.promises.mkdir(path.join(srcDir, 'nested'), { recursive: true });

			await Promise.all([
				fs.promises.writeFile(path.join(srcDir, 'task-001.md'), '# markdown task', 'utf8'),
				fs.promises.writeFile(path.join(srcDir, 'notes.txt'), 'ignore me', 'utf8'),
				fs.promises.writeFile(path.join(srcDir, 'nested', 'task-002.md'), '# nested markdown task', 'utf8'),
				fs.promises.writeFile(path.join(srcDir, 'nested', 'draft.json'), '{}', 'utf8')
			]);

			const output = {
				appendLine: (_value: string): void => undefined
			};

			const counts = await __legacyMigrationTestExports.copyDirRecursive(
				srcDir,
				destDir,
				output as any,
				__legacyMigrationTestExports.isMarkdownTaskFile
			);

			assert.deepStrictEqual(counts, { filesCopied: 2, filesSkipped: 2, errors: 0 });
			assert.strictEqual(fs.existsSync(path.join(destDir, 'task-001.md')), true);
			assert.strictEqual(fs.existsSync(path.join(destDir, 'nested', 'task-002.md')), true);
			assert.strictEqual(fs.existsSync(path.join(destDir, 'notes.txt')), false);
			assert.strictEqual(fs.existsSync(path.join(destDir, 'nested', 'draft.json')), false);
		} finally {
			await fs.promises.rm(tmpRoot, { recursive: true, force: true });
		}
	});
});
