import fs from 'fs';
import os from 'os';
import path from 'path';

import {
	resolveSandboxDirs,
	ensureSandboxDirs,
	removeSandboxDirs,
	listSandboxIds,
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
