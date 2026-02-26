import fs from 'fs';
import os from 'os';
import path from 'path';
import { AuditLogger, getAuditLogFilePath } from '../auditLogger';

describe('AuditLogger', () => {
	let tmpRoot: string;
	const fixedDate = new Date('2025-06-15T12:00:00.000Z');
	const fakeClock = () => fixedDate;

	beforeEach(() => {
		tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-logger-'));
	});

	afterEach(() => {
		fs.rmSync(tmpRoot, { recursive: true, force: true });
	});

	function makeLogger(overrides: Partial<Parameters<typeof AuditLogger['prototype']['log']>[0]> & Record<string, unknown> = {}) {
		return new AuditLogger({
			workspaceRoot: tmpRoot,
			now: fakeClock,
			...overrides,
		});
	}

	function readLines(filePath: string): unknown[] {
		return fs
			.readFileSync(filePath, 'utf8')
			.trim()
			.split('\n')
			.map((l) => JSON.parse(l));
	}

	test('log() writes JSONL with timestamp to correct file path', () => {
		const logger = makeLogger();
		logger.log({ action: 'test' });

		const logPath = getAuditLogFilePath(tmpRoot);
		expect(fs.existsSync(logPath)).toBe(true);

		const lines = readLines(logPath);
		expect(lines).toHaveLength(1);
		expect(lines[0]).toMatchObject({ ts: fixedDate.toISOString(), action: 'test' });
	});

	test('log() creates output directory if it does not exist', () => {
		const deepRoot = path.join(tmpRoot, 'nested', 'deep');
		const logger = new AuditLogger({ workspaceRoot: deepRoot, now: fakeClock });
		logger.log({ init: true });

		const logPath = getAuditLogFilePath(deepRoot);
		expect(fs.existsSync(logPath)).toBe(true);
	});

	test('log() redacts sensitive keys', () => {
		const logger = makeLogger();
		logger.log({
			token: 'abc123',
			api_key: 'secret-key',
			password: 'hunter2',
			jwt: 'eyJhbGciOi...',
			authorization: 'Bearer xyz',
			safe: 'visible',
		});

		const lines = readLines(getAuditLogFilePath(tmpRoot));
		const entry = lines[0] as Record<string, unknown>;
		expect(entry.token).toBe('[REDACTED]');
		expect(entry.api_key).toBe('[REDACTED]');
		expect(entry.password).toBe('[REDACTED]');
		expect(entry.jwt).toBe('[REDACTED]');
		expect(entry.authorization).toBe('[REDACTED]');
		expect(entry.safe).toBe('visible');
	});

	test('log() truncates long strings to maxStringLength', () => {
		const maxLen = 50;
		const logger = makeLogger({ maxStringLength: maxLen });
		const longString = 'a'.repeat(200);
		logger.log({ data: longString });

		const lines = readLines(getAuditLogFilePath(tmpRoot));
		const entry = lines[0] as Record<string, unknown>;
		expect((entry.data as string).length).toBeLessThanOrEqual(maxLen);
	});

	test('logSecurityEvent() adds category and eventType fields', () => {
		const logger = makeLogger();
		logger.logSecurityEvent('login_attempt', { user: 'alice' });

		const lines = readLines(getAuditLogFilePath(tmpRoot));
		expect(lines[0]).toMatchObject({
			ts: fixedDate.toISOString(),
			category: 'security',
			eventType: 'login_attempt',
			user: 'alice',
		});
	});

	test('file rotation occurs when file exceeds maxFileBytes', () => {
		const logger = makeLogger({ maxFileBytes: 100 });
		// Write enough data to exceed 100 bytes
		logger.log({ payload: 'x'.repeat(80) });
		// Second write should trigger rotation
		logger.log({ payload: 'after-rotate' });

		const outputDir = path.dirname(getAuditLogFilePath(tmpRoot));
		const files = fs.readdirSync(outputDir);
		// Should have the primary file plus a rotated file
		expect(files.length).toBeGreaterThanOrEqual(2);
		const rotated = files.filter((f) => f !== 'remote-audit.jsonl');
		expect(rotated.length).toBeGreaterThanOrEqual(1);
		expect(rotated[0]).toMatch(/^remote-audit\.\d{8}-\d{6}\.jsonl$/);
	});

	test('multiple log() calls append lines (JSONL format)', () => {
		const logger = makeLogger();
		logger.log({ seq: 1 });
		logger.log({ seq: 2 });
		logger.log({ seq: 3 });

		const lines = readLines(getAuditLogFilePath(tmpRoot));
		expect(lines).toHaveLength(3);
		expect(lines.map((l) => (l as Record<string, unknown>).seq)).toEqual([1, 2, 3]);
	});
});

describe('getAuditLogFilePath', () => {
	test('returns correct default path', () => {
		const result = getAuditLogFilePath('/workspace');
		expect(result).toBe(path.join(path.resolve('/workspace'), '.instructions-output', 'remote-audit.jsonl'));
	});

	test('returns correct path with custom fileName', () => {
		const result = getAuditLogFilePath('/workspace', 'custom.jsonl');
		expect(result).toBe(path.join(path.resolve('/workspace'), '.instructions-output', 'custom.jsonl'));
	});
});
