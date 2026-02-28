import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { containsTraversalSegment, isConfinedToRoot, rejectSymlink } from '../../utils/pathSecurity';

suite('pathSecurity', () => {
	let tmpDir: string;

	setup(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-test-'));
	});

	teardown(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	// --- containsTraversalSegment ---

	suite('containsTraversalSegment', () => {
		test('detects .. segment', () => {
			assert.strictEqual(containsTraversalSegment('../escape'), true);
		});

		test('detects . segment', () => {
			assert.strictEqual(containsTraversalSegment('./local'), true);
		});

		test('allows normal path', () => {
			assert.strictEqual(containsTraversalSegment('normal/path'), false);
		});

		test('detects mid-path traversal', () => {
			assert.strictEqual(containsTraversalSegment('a/../b'), true);
		});

		test('allows path with dots in name', () => {
			assert.strictEqual(containsTraversalSegment('my.skill/v1.0'), false);
		});

		test('detects backslash traversal', () => {
			assert.strictEqual(containsTraversalSegment('a\\..\\b'), true);
		});
	});

	// --- isConfinedToRoot ---

	suite('isConfinedToRoot', () => {
		test('confined child path returns true', () => {
			const root = path.join(tmpDir, 'vault');
			const child = path.join(root, 'my-skill');
			assert.strictEqual(isConfinedToRoot(child, root), true);
		});

		test('escaped path returns false', () => {
			const root = path.join(tmpDir, 'vault');
			const escaped = path.join(tmpDir, 'other-dir');
			assert.strictEqual(isConfinedToRoot(escaped, root), false);
		});

		test('exact root returns true', () => {
			const root = path.join(tmpDir, 'vault');
			assert.strictEqual(isConfinedToRoot(root, root), true);
		});

		test('traversal-resolved escape returns false', () => {
			const root = path.join(tmpDir, 'vault');
			const escaped = path.join(root, '..', 'outside');
			assert.strictEqual(isConfinedToRoot(escaped, root), false);
		});
	});

	// --- rejectSymlink ---

	suite('rejectSymlink', () => {
		test('returns false for normal directory', () => {
			const dir = path.join(tmpDir, 'normal');
			fs.mkdirSync(dir);
			assert.strictEqual(rejectSymlink(dir), false);
		});

		test('returns true for non-existent path (fail-closed)', () => {
			assert.strictEqual(rejectSymlink(path.join(tmpDir, 'nonexistent')), true);
		});

		if (process.platform !== 'win32') {
			test('returns true for symlink', () => {
				const target = path.join(tmpDir, 'real-dir');
				const link = path.join(tmpDir, 'link-dir');
				fs.mkdirSync(target);
				fs.symlinkSync(target, link);
				assert.strictEqual(rejectSymlink(link), true);
			});

			test('returns true when parent is a symlink', () => {
				const realParent = path.join(tmpDir, 'real-parent');
				const linkedParent = path.join(tmpDir, 'linked-parent');
				const child = path.join(linkedParent, 'child');
				fs.mkdirSync(realParent);
				fs.symlinkSync(realParent, linkedParent);
				fs.mkdirSync(path.join(realParent, 'child'));
				assert.strictEqual(rejectSymlink(child), true);
			});
		}
	});
});
