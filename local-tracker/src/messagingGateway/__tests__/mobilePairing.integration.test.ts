import http from 'node:http';

import { GatewayHttpServer } from '../gatewayHttpServer';
import { _clearAllLeases } from '../mobilePairingLease';
import { _clearAllSessions } from '../mobileAuth';

const BEARER = 'integration-test-token-42';

function request(options: {
    method: string;
    path: string;
    port: number;
    headers?: Record<string, string>;
    body?: unknown;
}): Promise<{ status: number; body: Record<string, unknown> }> {
    return new Promise((resolve, reject) => {
        const req = http.request(
            {
                hostname: '127.0.0.1',
                port: options.port,
                path: options.path,
                method: options.method,
                headers: {
                    'Content-Type': 'application/json',
                    ...options.headers,
                },
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (c: Buffer) => chunks.push(c));
                res.on('end', () => {
                    const raw = Buffer.concat(chunks).toString('utf8');
                    try {
                        resolve({ status: res.statusCode!, body: JSON.parse(raw) });
                    } catch {
                        resolve({ status: res.statusCode!, body: { raw } });
                    }
                });
            },
        );
        req.on('error', reject);
        if (options.body !== undefined) req.write(JSON.stringify(options.body));
        req.end();
    });
}

describe('Mobile pairing integration', () => {
    let server: GatewayHttpServer;
    let port: number;

    beforeAll(async () => {
        server = new GatewayHttpServer({
            port: 0,
            bearerToken: BEARER,
            mobilePairing: true,
            getSessions: async () => [],
            getPendingPermissions: () => [],
            approvePermission: async () => {},
            denyPermission: async () => {},
        });
        await server.start();
        port = server.getPort()!;
    });

    afterAll(async () => {
        await server.stop();
    });

    afterEach(() => {
        _clearAllLeases();
        _clearAllSessions();
    });

    const bearerHeaders = { Authorization: `Bearer ${BEARER}` };

    it('full happy-path handshake: initiate → complete → command → rotate → command with new token', async () => {
        // 1. Initiate pairing
        const initRes = await request({
            method: 'POST',
            path: '/api/mobile/pair/initiate',
            port,
            headers: bearerHeaders,
            body: {},
        });
        expect(initRes.status).toBe(201);
        expect(initRes.body.ok).toBe(true);
        const { pairingToken, leaseId } = initRes.body as { pairingToken: string; leaseId: string };
        expect(typeof pairingToken).toBe('string');
        expect(typeof leaseId).toBe('string');

        // 2. Complete pairing → get session token
        const completeRes = await request({
            method: 'POST',
            path: '/api/mobile/pair/complete',
            port,
            headers: bearerHeaders,
            body: { pairingToken },
        });
        expect(completeRes.status).toBe(200);
        expect(completeRes.body.ok).toBe(true);
        expect(completeRes.body.leaseId).toBe(leaseId);
        const sessionToken = completeRes.body.sessionToken as string;
        expect(typeof sessionToken).toBe('string');

        // 3. Send command with session token
        const cmdRes = await request({
            method: 'POST',
            path: '/api/mobile/command',
            port,
            headers: { 'X-Mobile-Session-Token': sessionToken },
            body: { jsonrpc: '2.0', id: 1, method: 'ping' },
        });
        expect(cmdRes.status).toBe(200);
        expect(cmdRes.body.ok).toBe(true);

        // 4. Rotate session
        const rotateRes = await request({
            method: 'POST',
            path: '/api/mobile/session/rotate',
            port,
            headers: { 'X-Mobile-Session-Token': sessionToken },
        });
        expect(rotateRes.status).toBe(200);
        expect(rotateRes.body.ok).toBe(true);
        const newSessionToken = rotateRes.body.sessionToken as string;
        expect(typeof newSessionToken).toBe('string');
        expect(newSessionToken).not.toBe(sessionToken);

        // 5. Old token is rejected
        const oldCmdRes = await request({
            method: 'POST',
            path: '/api/mobile/command',
            port,
            headers: { 'X-Mobile-Session-Token': sessionToken },
            body: { jsonrpc: '2.0', id: 2, method: 'ping' },
        });
        expect(oldCmdRes.status).toBe(401);

        // 6. New token works
        const newCmdRes = await request({
            method: 'POST',
            path: '/api/mobile/command',
            port,
            headers: { 'X-Mobile-Session-Token': newSessionToken },
            body: { jsonrpc: '2.0', id: 3, method: 'ping' },
        });
        expect(newCmdRes.status).toBe(200);
        expect(newCmdRes.body.ok).toBe(true);
    });

    it('wrong pairing token → 401 on complete', async () => {
        // Initiate to create a real lease
        await request({
            method: 'POST',
            path: '/api/mobile/pair/initiate',
            port,
            headers: bearerHeaders,
            body: {},
        });

        // Try to complete with a bogus token
        const res = await request({
            method: 'POST',
            path: '/api/mobile/pair/complete',
            port,
            headers: bearerHeaders,
            body: { pairingToken: 'totally-wrong-token' },
        });
        expect(res.status).toBe(401);
        expect(res.body.error).toMatch(/Invalid or expired/);
    });

    it('double-complete (replay) → 401 on second attempt', async () => {
        const initRes = await request({
            method: 'POST',
            path: '/api/mobile/pair/initiate',
            port,
            headers: bearerHeaders,
            body: {},
        });
        const { pairingToken } = initRes.body as { pairingToken: string };

        // First complete succeeds
        const first = await request({
            method: 'POST',
            path: '/api/mobile/pair/complete',
            port,
            headers: bearerHeaders,
            body: { pairingToken },
        });
        expect(first.status).toBe(200);

        // Second complete with same token fails (already consumed)
        const second = await request({
            method: 'POST',
            path: '/api/mobile/pair/complete',
            port,
            headers: bearerHeaders,
            body: { pairingToken },
        });
        expect(second.status).toBe(401);
    });

    it('revoked lease → complete fails with 401', async () => {
        const initRes = await request({
            method: 'POST',
            path: '/api/mobile/pair/initiate',
            port,
            headers: bearerHeaders,
            body: {},
        });
        const { leaseId, pairingToken } = initRes.body as { leaseId: string; pairingToken: string };

        // Revoke the lease
        const revokeRes = await request({
            method: 'POST',
            path: `/api/mobile/pair/${leaseId}/revoke`,
            port,
            headers: bearerHeaders,
        });
        expect(revokeRes.status).toBe(200);
        expect(revokeRes.body.ok).toBe(true);

        // Try to complete → should fail
        const completeRes = await request({
            method: 'POST',
            path: '/api/mobile/pair/complete',
            port,
            headers: bearerHeaders,
            body: { pairingToken },
        });
        expect(completeRes.status).toBe(401);
    });

    it('invalid session token for command → 401', async () => {
        const res = await request({
            method: 'POST',
            path: '/api/mobile/command',
            port,
            headers: { 'X-Mobile-Session-Token': 'garbage-session-token' },
            body: { jsonrpc: '2.0', id: 1, method: 'ping' },
        });
        expect(res.status).toBe(401);
        expect(res.body.error).toMatch(/Invalid or expired session/);
    });

    it('session rotate invalidates old token', async () => {
        // Set up a valid session
        const initRes = await request({
            method: 'POST',
            path: '/api/mobile/pair/initiate',
            port,
            headers: bearerHeaders,
            body: {},
        });
        const { pairingToken } = initRes.body as { pairingToken: string };

        const completeRes = await request({
            method: 'POST',
            path: '/api/mobile/pair/complete',
            port,
            headers: bearerHeaders,
            body: { pairingToken },
        });
        const oldToken = completeRes.body.sessionToken as string;

        // Rotate
        const rotateRes = await request({
            method: 'POST',
            path: '/api/mobile/session/rotate',
            port,
            headers: { 'X-Mobile-Session-Token': oldToken },
        });
        expect(rotateRes.status).toBe(200);

        // Old token must be rejected
        const cmdRes = await request({
            method: 'POST',
            path: '/api/mobile/command',
            port,
            headers: { 'X-Mobile-Session-Token': oldToken },
            body: { jsonrpc: '2.0', id: 1, method: 'ping' },
        });
        expect(cmdRes.status).toBe(401);
    });

    it('lease status is completed after successful pairing', async () => {
        const initRes = await request({
            method: 'POST',
            path: '/api/mobile/pair/initiate',
            port,
            headers: bearerHeaders,
            body: {},
        });
        const { leaseId, pairingToken } = initRes.body as { leaseId: string; pairingToken: string };

        // Complete the pairing
        await request({
            method: 'POST',
            path: '/api/mobile/pair/complete',
            port,
            headers: bearerHeaders,
            body: { pairingToken },
        });

        // Check status
        const statusRes = await request({
            method: 'GET',
            path: `/api/mobile/pair/${leaseId}`,
            port,
            headers: bearerHeaders,
        });
        expect(statusRes.status).toBe(200);
        expect(statusRes.body.state).toBe('completed');
        expect(statusRes.body.leaseId).toBe(leaseId);
    });

    it('no bearer auth on pair/initiate → 401', async () => {
        const res = await request({
            method: 'POST',
            path: '/api/mobile/pair/initiate',
            port,
            body: {},
        });
        expect(res.status).toBe(401);
    });
});
