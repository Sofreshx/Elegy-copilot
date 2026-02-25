jest.mock('@napi-rs/keyring/keytar', () => ({
	getPassword: jest.fn(),
	setPassword: jest.fn(),
	deletePassword: jest.fn(),
}));

import {
	getPrTokenLeaseStatus,
	issuePrTokenLease,
	resolvePrTokenLease,
	revokePrTokenLease,
} from '../secrets';

describe('PR token lease lifecycle', () => {
	it('issuePrTokenLease rejects missing token', () => {
		expect(() => issuePrTokenLease({ token: '' }, 1_000)).toThrow('token is required');
		expect(() => issuePrTokenLease({ token: '   ' }, 1_000)).toThrow('token is required');
	});

	it('issuePrTokenLease rejects invalid ttl bounds', () => {
		expect(() => issuePrTokenLease({ token: 'ghp_test', ttlMs: 0 }, 1_000)).toThrow('ttlMs must be between 1 and 86400000');
		expect(() => issuePrTokenLease({ token: 'ghp_test', ttlMs: -1 }, 1_000)).toThrow('ttlMs must be between 1 and 86400000');
		expect(() => issuePrTokenLease({ token: 'ghp_test', ttlMs: 86_400_001 }, 1_000)).toThrow('ttlMs must be between 1 and 86400000');
	});

	it('issuePrTokenLease + resolvePrTokenLease returns token while active', () => {
		const nowMs = 10_000;
		const token = 'ghp_active_token';
		const lease = issuePrTokenLease({ token, ttlMs: 5_000, scope: 'pr-open' }, nowMs);

		expect(resolvePrTokenLease(lease.leaseId, nowMs)).toBe(token);
		expect(resolvePrTokenLease(lease.leaseId, nowMs + 4_999)).toBe(token);
	});

	it('getPrTokenLeaseStatus returns active/expired/revoked/missing correctly', () => {
		const nowMs = 20_000;

		const activeLease = issuePrTokenLease({ token: 'ghp_active', ttlMs: 1_000, scope: 'active-scope' }, nowMs);
		expect(getPrTokenLeaseStatus(activeLease.leaseId, nowMs)).toEqual({
			state: 'active',
			scope: 'active-scope',
			expiresAtMs: nowMs + 1_000,
		});

		const expiredLease = issuePrTokenLease({ token: 'ghp_expired', ttlMs: 1_000, scope: 'expired-scope' }, nowMs);
		expect(getPrTokenLeaseStatus(expiredLease.leaseId, nowMs + 1_001)).toEqual({
			state: 'expired',
			scope: 'expired-scope',
			expiresAtMs: nowMs + 1_000,
		});

		const revokedLease = issuePrTokenLease({ token: 'ghp_revoked', ttlMs: 1_000, scope: 'revoked-scope' }, nowMs);
		expect(revokePrTokenLease(revokedLease.leaseId)).toBe(true);
		expect(getPrTokenLeaseStatus(revokedLease.leaseId, nowMs)).toEqual({
			state: 'revoked',
			scope: 'revoked-scope',
			expiresAtMs: nowMs + 1_000,
		});

		expect(getPrTokenLeaseStatus('missing-lease-id', nowMs)).toEqual({ state: 'missing' });
	});

	it('revokePrTokenLease handles existing and non-existing leases', () => {
		const nowMs = 30_000;
		const lease = issuePrTokenLease({ token: 'ghp_revoke_target', ttlMs: 2_000, scope: 'revoke-scope' }, nowMs);

		expect(revokePrTokenLease(lease.leaseId)).toBe(true);
		expect(resolvePrTokenLease(lease.leaseId, nowMs)).toBeUndefined();
		expect(getPrTokenLeaseStatus(lease.leaseId, nowMs)).toEqual({
			state: 'revoked',
			scope: 'revoke-scope',
			expiresAtMs: nowMs + 2_000,
		});

		expect(revokePrTokenLease('missing-lease-id')).toBe(false);
		expect(revokePrTokenLease('   ')).toBe(false);
	});
});