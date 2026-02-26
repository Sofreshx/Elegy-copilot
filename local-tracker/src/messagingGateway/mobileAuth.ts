import crypto from 'crypto';

const DEFAULT_SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const TOKEN_BYTES = 32;

export interface MobileSession {
    sessionId: string;
    sessionToken: string;
    leaseId: string;
    expiresAtMs: number;
    issuedAtMs: number;
}

export interface MobileSessionValidation {
    valid: boolean;
    sessionId?: string;
    leaseId?: string;
    reason?: string;
}

interface SessionRecord {
    sessionToken: string;
    leaseId: string;
    expiresAtMs: number;
    issuedAtMs: number;
    revoked: boolean;
}

const sessions = new Map<string, SessionRecord>();

export function issueMobileSession(
    leaseId: string,
    options?: { ttlMs?: number },
    nowMs: number = Date.now(),
): MobileSession {
    const lid = String(leaseId || '').trim();
    if (!lid) throw new Error('leaseId is required');

    const ttl = options?.ttlMs ?? DEFAULT_SESSION_TTL_MS;
    if (!Number.isFinite(ttl) || ttl <= 0 || ttl > MAX_SESSION_TTL_MS) {
        throw new Error(`Session TTL must be between 1 and ${MAX_SESSION_TTL_MS}`);
    }

    const sessionId = crypto.randomUUID();
    const sessionToken = crypto.randomBytes(TOKEN_BYTES).toString('hex');
    const expiresAtMs = nowMs + ttl;

    sessions.set(sessionId, {
        sessionToken,
        leaseId: lid,
        expiresAtMs,
        issuedAtMs: nowMs,
        revoked: false,
    });

    return { sessionId, sessionToken, leaseId: lid, expiresAtMs, issuedAtMs: nowMs };
}

export function validateMobileSession(
    sessionToken: string,
    nowMs: number = Date.now(),
): MobileSessionValidation {
    const token = String(sessionToken || '').trim();
    if (!token) return { valid: false, reason: 'missing_token' };

    for (const [sessionId, record] of sessions) {
        // Constant-time comparison for the token
        const a = Buffer.from(token);
        const b = Buffer.from(record.sessionToken);
        if (a.length !== b.length) continue;
        if (!crypto.timingSafeEqual(a, b)) continue;

        if (record.revoked) return { valid: false, sessionId, reason: 'revoked' };
        if (record.expiresAtMs <= nowMs) return { valid: false, sessionId, reason: 'expired' };

        return { valid: true, sessionId, leaseId: record.leaseId };
    }

    return { valid: false, reason: 'invalid_token' };
}

export function revokeMobileSession(sessionId: string): boolean {
    const id = String(sessionId || '').trim();
    if (!id) return false;
    const record = sessions.get(id);
    if (!record) return false;
    record.revoked = true;
    return true;
}

export function rotateMobileSession(
    sessionId: string,
    options?: { ttlMs?: number },
    nowMs: number = Date.now(),
): MobileSession | undefined {
    const id = String(sessionId || '').trim();
    if (!id) return undefined;
    const old = sessions.get(id);
    if (!old || old.revoked || old.expiresAtMs <= nowMs) return undefined;

    // Revoke old session
    old.revoked = true;

    // Issue new session linked to same lease
    return issueMobileSession(old.leaseId, options, nowMs);
}

/** Clear all sessions (for testing). @internal */
export function _clearAllSessions(): void {
    sessions.clear();
}
