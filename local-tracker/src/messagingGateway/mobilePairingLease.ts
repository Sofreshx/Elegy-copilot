import crypto from 'crypto';

const DEFAULT_MOBILE_PAIRING_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_TTL_MS = 15 * 60 * 1000; // 15 minutes max

export interface MobilePairingLease {
	leaseId: string;
	pairingToken: string;
	expiresAtMs: number;
}

export interface MobilePairingLeaseStatus {
	state: 'missing' | 'active' | 'expired' | 'completed' | 'revoked';
	leaseId?: string;
	expiresAtMs?: number;
}

interface LeaseRecord {
	pairingToken: string;
	expiresAtMs: number;
	issuedAtMs: number;
	state: 'active' | 'completed' | 'revoked';
}

const leases = new Map<string, LeaseRecord>();

/**
 * Issue a new mobile pairing lease with a cryptographically random token.
 * The pairing token is shown to the user (e.g., QR code) and must be presented
 * by the mobile app to complete pairing.
 */
export function issueMobilePairingLease(
	options?: { ttlMs?: number },
	nowMs: number = Date.now(),
): MobilePairingLease {
	const ttl = options?.ttlMs ?? DEFAULT_MOBILE_PAIRING_TTL_MS;
	if (!Number.isFinite(ttl) || ttl <= 0 || ttl > MAX_TTL_MS) {
		throw new Error(`[Gateway] Mobile pairing TTL must be between 1 and ${MAX_TTL_MS}`);
	}

	const leaseId = crypto.randomUUID();
	const pairingToken = crypto.randomBytes(32).toString('hex');
	const expiresAtMs = nowMs + ttl;

	leases.set(leaseId, {
		pairingToken,
		expiresAtMs,
		issuedAtMs: nowMs,
		state: 'active',
	});

	return { leaseId, pairingToken, expiresAtMs };
}

/**
 * Resolve a mobile pairing lease by presenting the pairing token.
 * Returns the leaseId if the token matches and the lease is still active.
 * Returns undefined if the token is invalid, expired, or already used.
 */
export function resolveMobilePairingLease(
	pairingToken: string,
	nowMs: number = Date.now(),
): string | undefined {
	const token = String(pairingToken || '').trim();
	if (!token) return undefined;

	for (const [leaseId, record] of leases) {
		const a = Buffer.from(token);
		const b = Buffer.from(record.pairingToken);
		if (a.length !== b.length) continue;
		if (!crypto.timingSafeEqual(a, b)) continue;
		if (record.state !== 'active') return undefined;
		if (record.expiresAtMs <= nowMs) {
			leases.delete(leaseId);
			return undefined;
		}
		// Mark as completed — one-time use
		record.state = 'completed';
		return leaseId;
	}

	return undefined;
}

/**
 * Revoke a mobile pairing lease by leaseId.
 */
export function revokeMobilePairingLease(leaseId: string): boolean {
	const id = String(leaseId || '').trim();
	if (!id) return false;

	const record = leases.get(id);
	if (!record) return false;
	record.state = 'revoked';
	return true;
}

/**
 * Get the status of a mobile pairing lease.
 */
export function getMobilePairingLeaseStatus(
	leaseId: string,
	nowMs: number = Date.now(),
): MobilePairingLeaseStatus {
	const id = String(leaseId || '').trim();
	if (!id) return { state: 'missing' };

	const record = leases.get(id);
	if (!record) return { state: 'missing' };
	if (record.state === 'revoked') return { state: 'revoked', leaseId: id, expiresAtMs: record.expiresAtMs };
	if (record.state === 'completed') return { state: 'completed', leaseId: id, expiresAtMs: record.expiresAtMs };
	if (record.expiresAtMs <= nowMs) return { state: 'expired', leaseId: id, expiresAtMs: record.expiresAtMs };
	return { state: 'active', leaseId: id, expiresAtMs: record.expiresAtMs };
}

/**
 * Clear all leases (for testing).
 * @internal
 */
export function _clearAllLeases(): void {
	leases.clear();
}
