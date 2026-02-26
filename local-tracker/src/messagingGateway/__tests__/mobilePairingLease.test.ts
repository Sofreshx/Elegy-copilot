import {
	issueMobilePairingLease,
	resolveMobilePairingLease,
	revokeMobilePairingLease,
	getMobilePairingLeaseStatus,
	_clearAllLeases,
} from '../mobilePairingLease';

afterEach(() => {
	_clearAllLeases();
});

const NOW = 1_700_000_000_000;

describe('issueMobilePairingLease', () => {
	it('issues a lease with a 64-char hex pairing token', () => {
		const lease = issueMobilePairingLease(undefined, NOW);
		expect(lease.pairingToken).toMatch(/^[0-9a-f]{64}$/);
		expect(lease.leaseId).toBeTruthy();
	});

	it('sets correct default expiry (5 minutes)', () => {
		const lease = issueMobilePairingLease(undefined, NOW);
		expect(lease.expiresAtMs).toBe(NOW + 5 * 60 * 1000);
	});

	it('respects custom TTL', () => {
		const lease = issueMobilePairingLease({ ttlMs: 60_000 }, NOW);
		expect(lease.expiresAtMs).toBe(NOW + 60_000);
	});

	it('throws on invalid TTL (negative, zero, too large)', () => {
		expect(() => issueMobilePairingLease({ ttlMs: 0 }, NOW)).toThrow();
		expect(() => issueMobilePairingLease({ ttlMs: -1 }, NOW)).toThrow();
		expect(() => issueMobilePairingLease({ ttlMs: 16 * 60 * 1000 }, NOW)).toThrow();
		expect(() => issueMobilePairingLease({ ttlMs: NaN }, NOW)).toThrow();
	});

	it('each lease has unique leaseId and token', () => {
		const a = issueMobilePairingLease(undefined, NOW);
		const b = issueMobilePairingLease(undefined, NOW);
		expect(a.leaseId).not.toBe(b.leaseId);
		expect(a.pairingToken).not.toBe(b.pairingToken);
	});
});

describe('resolveMobilePairingLease', () => {
	it('resolves active lease by token and returns leaseId', () => {
		const lease = issueMobilePairingLease(undefined, NOW);
		const result = resolveMobilePairingLease(lease.pairingToken, NOW);
		expect(result).toBe(lease.leaseId);
	});

	it('returns undefined for unknown token', () => {
		expect(resolveMobilePairingLease('deadbeef', NOW)).toBeUndefined();
	});

	it('returns undefined for expired lease', () => {
		const lease = issueMobilePairingLease({ ttlMs: 1000 }, NOW);
		expect(resolveMobilePairingLease(lease.pairingToken, NOW + 2000)).toBeUndefined();
	});

	it('returns undefined for already-resolved (completed) lease — one-time use', () => {
		const lease = issueMobilePairingLease(undefined, NOW);
		resolveMobilePairingLease(lease.pairingToken, NOW);
		expect(resolveMobilePairingLease(lease.pairingToken, NOW)).toBeUndefined();
	});

	it('returns undefined for revoked lease', () => {
		const lease = issueMobilePairingLease(undefined, NOW);
		revokeMobilePairingLease(lease.leaseId);
		expect(resolveMobilePairingLease(lease.pairingToken, NOW)).toBeUndefined();
	});
});

describe('revokeMobilePairingLease', () => {
	it('revokes an active lease', () => {
		const lease = issueMobilePairingLease(undefined, NOW);
		expect(revokeMobilePairingLease(lease.leaseId)).toBe(true);
		expect(getMobilePairingLeaseStatus(lease.leaseId, NOW).state).toBe('revoked');
	});

	it('returns false for unknown leaseId', () => {
		expect(revokeMobilePairingLease('no-such-id')).toBe(false);
	});
});

describe('getMobilePairingLeaseStatus', () => {
	it('returns active for active lease', () => {
		const lease = issueMobilePairingLease(undefined, NOW);
		const status = getMobilePairingLeaseStatus(lease.leaseId, NOW);
		expect(status.state).toBe('active');
		expect(status.leaseId).toBe(lease.leaseId);
		expect(status.expiresAtMs).toBe(lease.expiresAtMs);
	});

	it('returns expired for expired lease', () => {
		const lease = issueMobilePairingLease({ ttlMs: 1000 }, NOW);
		expect(getMobilePairingLeaseStatus(lease.leaseId, NOW + 2000).state).toBe('expired');
	});

	it('returns revoked for revoked lease', () => {
		const lease = issueMobilePairingLease(undefined, NOW);
		revokeMobilePairingLease(lease.leaseId);
		expect(getMobilePairingLeaseStatus(lease.leaseId, NOW).state).toBe('revoked');
	});

	it('returns completed for resolved lease', () => {
		const lease = issueMobilePairingLease(undefined, NOW);
		resolveMobilePairingLease(lease.pairingToken, NOW);
		expect(getMobilePairingLeaseStatus(lease.leaseId, NOW).state).toBe('completed');
	});

	it('returns missing for unknown leaseId', () => {
		expect(getMobilePairingLeaseStatus('no-such-id', NOW).state).toBe('missing');
	});
});
