import fs from 'fs';
import os from 'os';
import path from 'path';

import {
	resolveSandboxDirs,
	ensureSandboxDirs,
	removeSandboxDirs,
	listSandboxIds,
	cleanupSandboxDirs,
} from '../sandboxDirs';

let tmpHome: string;

beforeEach(() => {
	tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-test-'));
});

afterEach(() => {
	fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe('resolveSandboxDirs', () => {
	it('returns correct paths', () => {
		const dirs = resolveSandboxDirs('my-sandbox', tmpHome);
		expect(dirs.root).toBe(path.join(tmpHome, 'my-sandbox'));
		expect(dirs.sessionState).toBe(path.join(tmpHome, 'my-sandbox', 'session-state'));
		expect(dirs.logs).toBe(path.join(tmpHome, 'my-sandbox', 'logs'));
	});

	it('uses custom sandboxesHome', () => {
		const custom = path.join(tmpHome, 'custom-home');
		const dirs = resolveSandboxDirs('abc', custom);
		expect(dirs.root).toBe(path.join(custom, 'abc'));
	});

	it('throws for invalid sandboxId', () => {
		// empty string
		expect(() => resolveSandboxDirs('', tmpHome)).toThrow('Invalid sandboxId');
		// special chars
		expect(() => resolveSandboxDirs('bad/id', tmpHome)).toThrow('Invalid sandboxId');
		expect(() => resolveSandboxDirs('../escape', tmpHome)).toThrow('Invalid sandboxId');
		expect(() => resolveSandboxDirs('has space', tmpHome)).toThrow('Invalid sandboxId');
		// starts with hyphen
		expect(() => resolveSandboxDirs('-nope', tmpHome)).toThrow('Invalid sandboxId');
		// too long (65 chars)
		expect(() => resolveSandboxDirs('a'.repeat(65), tmpHome)).toThrow('Invalid sandboxId');
	});
});

describe('ensureSandboxDirs', () => {
	it('creates directories', () => {
		const dirs = ensureSandboxDirs('test1', tmpHome);
		expect(fs.existsSync(dirs.root)).toBe(true);
		expect(fs.existsSync(dirs.sessionState)).toBe(true);
		expect(fs.existsSync(dirs.logs)).toBe(true);
	});

	it('is idempotent', () => {
		ensureSandboxDirs('test1', tmpHome);
		const dirs = ensureSandboxDirs('test1', tmpHome);
		expect(fs.existsSync(dirs.sessionState)).toBe(true);
		expect(fs.existsSync(dirs.logs)).toBe(true);
	});
});

describe('removeSandboxDirs', () => {
	it('removes the sandbox directory tree', () => {
		const dirs = ensureSandboxDirs('doomed', tmpHome);
		expect(fs.existsSync(dirs.root)).toBe(true);

		removeSandboxDirs('doomed', tmpHome);
		expect(fs.existsSync(dirs.root)).toBe(false);
	});

	it('does not throw for non-existent sandbox', () => {
		expect(() => removeSandboxDirs('ghost', tmpHome)).not.toThrow();
	});
});

describe('listSandboxIds', () => {
	it('returns existing sandbox directories', () => {
		ensureSandboxDirs('alpha', tmpHome);
		ensureSandboxDirs('beta', tmpHome);
		ensureSandboxDirs('gamma', tmpHome);

		const ids = listSandboxIds(tmpHome);
		expect(ids.sort()).toEqual(['alpha', 'beta', 'gamma']);
	});

	it('returns empty array when home does not exist', () => {
		const missing = path.join(tmpHome, 'no-such-dir');
		expect(listSandboxIds(missing)).toEqual([]);
	});
});

describe('cleanupSandboxDirs', () => {
	it('removes orphan sandbox dirs and keeps known fresh dirs', () => {
		ensureSandboxDirs('known', tmpHome);
		ensureSandboxDirs('orphan', tmpHome);

		const result = cleanupSandboxDirs({
			sandboxesHome: tmpHome,
			knownSandboxIds: ['known'],
			activeSandboxIds: [],
			staleTtlMs: 60_000,
			nowMs: Date.now(),
		});

		expect(result.removedSandboxIds).toEqual(['orphan']);
		expect(result.failedSandboxIds).toEqual([]);
		expect(result.skippedFreshSandboxIds).toEqual(['known']);
		expect(fs.existsSync(resolveSandboxDirs('orphan', tmpHome).root)).toBe(false);
		expect(fs.existsSync(resolveSandboxDirs('known', tmpHome).root)).toBe(true);
	});

	it('removes stale non-active dirs and keeps active dirs', () => {
		const stale = ensureSandboxDirs('stale-1', tmpHome);
		const active = ensureSandboxDirs('active-1', tmpHome);

		const now = Date.now();
		fs.utimesSync(stale.root, new Date(now - 120_000), new Date(now - 120_000));
		fs.utimesSync(active.root, new Date(now - 120_000), new Date(now - 120_000));

		const result = cleanupSandboxDirs({
			sandboxesHome: tmpHome,
			knownSandboxIds: ['stale-1', 'active-1'],
			activeSandboxIds: ['active-1'],
			staleTtlMs: 60_000,
			nowMs: now,
		});

		expect(result.removedSandboxIds).toEqual(['stale-1']);
		expect(result.skippedActiveSandboxIds).toEqual(['active-1']);
		expect(fs.existsSync(stale.root)).toBe(false);
		expect(fs.existsSync(active.root)).toBe(true);
	});

	it('is fail-safe when a remove fails and ignores invalid directory names', () => {
		ensureSandboxDirs('remove-fail', tmpHome);
		const invalidDir = path.join(tmpHome, 'bad dir');
		fs.mkdirSync(invalidDir, { recursive: true });

		const realRmSync = fs.rmSync;
		const rmSpy = jest.spyOn(fs, 'rmSync').mockImplementation((targetPath, options) => {
			if (String(targetPath).includes('remove-fail')) {
				throw new Error('rm failed');
			}
			return realRmSync(targetPath, options as any);
		});

		const result = cleanupSandboxDirs({
			sandboxesHome: tmpHome,
			knownSandboxIds: [],
			activeSandboxIds: [],
			staleTtlMs: 0,
			nowMs: Date.now(),
		});

		rmSpy.mockRestore();

		expect(result.removedSandboxIds).toEqual([]);
		expect(result.failedSandboxIds).toEqual(['remove-fail']);
		expect(fs.existsSync(invalidDir)).toBe(true);
	});
});
