import {
	issueMobileSession,
	validateMobileSession,
	revokeMobileSession,
	rotateMobileSession,
	_clearAllSessions,
} from '../mobileAuth';

afterEach(() => {
	_clearAllSessions();
});

const NOW = 1_700_000_000_000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

describe('issueMobileSession', () => {
	it('issues session with valid leaseId', () => {
		const session = issueMobileSession('lease-1', undefined, NOW);
		expect(session.sessionId).toBeTruthy();
		expect(session.sessionToken).toBeTruthy();
		expect(session.leaseId).toBe('lease-1');
		expect(session.issuedAtMs).toBe(NOW);
	});

	it('session token is 64-char hex', () => {
		const session = issueMobileSession('lease-1', undefined, NOW);
		expect(session.sessionToken).toMatch(/^[0-9a-f]{64}$/);
	});

	it('throws on empty leaseId', () => {
		expect(() => issueMobileSession('', undefined, NOW)).toThrow('leaseId is required');
		expect(() => issueMobileSession('   ', undefined, NOW)).toThrow('leaseId is required');
	});

	it('throws on invalid TTL', () => {
		expect(() => issueMobileSession('lease-1', { ttlMs: 0 }, NOW)).toThrow();
		expect(() => issueMobileSession('lease-1', { ttlMs: -1 }, NOW)).toThrow();
		expect(() => issueMobileSession('lease-1', { ttlMs: NaN }, NOW)).toThrow();
		expect(() => issueMobileSession('lease-1', { ttlMs: SEVEN_DAYS_MS + 1 }, NOW)).toThrow();
	});

	it('default TTL is 24 hours', () => {
		const session = issueMobileSession('lease-1', undefined, NOW);
		expect(session.expiresAtMs).toBe(NOW + ONE_DAY_MS);
	});
});

describe('validateMobileSession', () => {
	it('valid session returns valid: true with sessionId and leaseId', () => {
		const session = issueMobileSession('lease-1', undefined, NOW);
		const result = validateMobileSession(session.sessionToken, NOW);
		expect(result.valid).toBe(true);
		expect(result.sessionId).toBe(session.sessionId);
		expect(result.leaseId).toBe('lease-1');
	});

	it('invalid token returns valid: false', () => {
		issueMobileSession('lease-1', undefined, NOW);
		const result = validateMobileSession('not-a-real-token', NOW);
		expect(result.valid).toBe(false);
		expect(result.reason).toBe('invalid_token');
	});

	it('empty token returns valid: false, reason: missing_token', () => {
		const result = validateMobileSession('', NOW);
		expect(result.valid).toBe(false);
		expect(result.reason).toBe('missing_token');
	});

	it('revoked session returns valid: false, reason: revoked', () => {
		const session = issueMobileSession('lease-1', undefined, NOW);
		revokeMobileSession(session.sessionId);
		const result = validateMobileSession(session.sessionToken, NOW);
		expect(result.valid).toBe(false);
		expect(result.reason).toBe('revoked');
		expect(result.sessionId).toBe(session.sessionId);
	});

	it('expired session returns valid: false, reason: expired', () => {
		const session = issueMobileSession('lease-1', { ttlMs: 1000 }, NOW);
		const result = validateMobileSession(session.sessionToken, NOW + 2000);
		expect(result.valid).toBe(false);
		expect(result.reason).toBe('expired');
		expect(result.sessionId).toBe(session.sessionId);
	});
});

describe('revokeMobileSession', () => {
	it('revokes active session', () => {
		const session = issueMobileSession('lease-1', undefined, NOW);
		expect(revokeMobileSession(session.sessionId)).toBe(true);
		const result = validateMobileSession(session.sessionToken, NOW);
		expect(result.valid).toBe(false);
		expect(result.reason).toBe('revoked');
	});

	it('returns false for unknown sessionId', () => {
		expect(revokeMobileSession('nonexistent-id')).toBe(false);
	});
});

describe('rotateMobileSession', () => {
	it('rotates session — returns new session, old is revoked', () => {
		const original = issueMobileSession('lease-1', undefined, NOW);
		const rotated = rotateMobileSession(original.sessionId, undefined, NOW);
		expect(rotated).toBeDefined();
		expect(rotated!.sessionId).not.toBe(original.sessionId);
		expect(rotated!.sessionToken).not.toBe(original.sessionToken);

		// Old session should be revoked
		const oldResult = validateMobileSession(original.sessionToken, NOW);
		expect(oldResult.valid).toBe(false);
		expect(oldResult.reason).toBe('revoked');

		// New session should be valid
		const newResult = validateMobileSession(rotated!.sessionToken, NOW);
		expect(newResult.valid).toBe(true);
	});

	it('new session has same leaseId', () => {
		const original = issueMobileSession('lease-42', undefined, NOW);
		const rotated = rotateMobileSession(original.sessionId, undefined, NOW);
		expect(rotated!.leaseId).toBe('lease-42');
	});

	it('cannot rotate revoked session', () => {
		const session = issueMobileSession('lease-1', undefined, NOW);
		revokeMobileSession(session.sessionId);
		expect(rotateMobileSession(session.sessionId, undefined, NOW)).toBeUndefined();
	});

	it('cannot rotate expired session', () => {
		const session = issueMobileSession('lease-1', { ttlMs: 1000 }, NOW);
		expect(rotateMobileSession(session.sessionId, undefined, NOW + 2000)).toBeUndefined();
	});
});
