import http from 'http';

import { GatewayHttpServer } from '../gatewayHttpServer';
import { _clearAllLeases } from '../mobilePairingLease';

const TEST_TOKEN = 'test-mobile-pairing-token';

function makeRequest(
    port: number,
    options: {
        method?: string;
        path: string;
        token?: string;
        body?: string;
    },
): Promise<{ statusCode: number; body: string }> {
    return new Promise((resolve, reject) => {
        const req = http.request(
            {
                hostname: '127.0.0.1',
                port,
                path: options.path,
                method: options.method ?? 'GET',
                headers: {
                    ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
                    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
                },
            },
            (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => resolve({ statusCode: res.statusCode!, body: data }));
            },
        );
        req.on('error', reject);
        if (options.body) req.write(options.body);
        req.end();
    });
}

describe('Mobile Pairing HTTP Endpoints', () => {
    let server: GatewayHttpServer;
    let port: number;

    beforeAll(async () => {
        server = new GatewayHttpServer({
            port: 0,
            host: '127.0.0.1',
            bearerToken: TEST_TOKEN,
            mobilePairing: true,
            getSessions: async () => [],
            getPendingPermissions: () => [],
            approvePermission: async () => {},
            denyPermission: async () => {},
        });
        await server.start();
        port = server.getPort()!;
    });

    afterEach(() => {
        _clearAllLeases();
    });

    afterAll(async () => {
        await server.stop();
    });

    describe('POST /api/mobile/pair/initiate', () => {
        it('returns 201 with leaseId, pairingToken, expiresAtMs', async () => {
            const res = await makeRequest(port, {
                method: 'POST',
                path: '/api/mobile/pair/initiate',
                token: TEST_TOKEN,
                body: JSON.stringify({}),
            });
            expect(res.statusCode).toBe(201);
            const json = JSON.parse(res.body);
            expect(json.ok).toBe(true);
            expect(typeof json.leaseId).toBe('string');
            expect(typeof json.pairingToken).toBe('string');
            expect(typeof json.expiresAtMs).toBe('number');
        });

        it('returns 401 without bearer token', async () => {
            const res = await makeRequest(port, {
                method: 'POST',
                path: '/api/mobile/pair/initiate',
                body: JSON.stringify({}),
            });
            expect(res.statusCode).toBe(401);
        });

        it('returns 404 when mobilePairing is disabled', async () => {
            const disabledServer = new GatewayHttpServer({
                port: 0,
                host: '127.0.0.1',
                bearerToken: TEST_TOKEN,
                mobilePairing: false,
                getSessions: async () => [],
                getPendingPermissions: () => [],
                approvePermission: async () => {},
                denyPermission: async () => {},
            });
            await disabledServer.start();
            const disabledPort = disabledServer.getPort()!;
            try {
                const res = await makeRequest(disabledPort, {
                    method: 'POST',
                    path: '/api/mobile/pair/initiate',
                    token: TEST_TOKEN,
                    body: JSON.stringify({}),
                });
                expect(res.statusCode).toBe(404);
            } finally {
                await disabledServer.stop();
            }
        });
    });

    describe('POST /api/mobile/pair/complete', () => {
        it('returns 200 with leaseId when valid pairingToken provided', async () => {
            // First initiate a lease
            const initRes = await makeRequest(port, {
                method: 'POST',
                path: '/api/mobile/pair/initiate',
                token: TEST_TOKEN,
                body: JSON.stringify({}),
            });
            const initJson = JSON.parse(initRes.body);

            // Complete the pairing
            const res = await makeRequest(port, {
                method: 'POST',
                path: '/api/mobile/pair/complete',
                token: TEST_TOKEN,
                body: JSON.stringify({ pairingToken: initJson.pairingToken }),
            });
            expect(res.statusCode).toBe(200);
            const json = JSON.parse(res.body);
            expect(json.ok).toBe(true);
            expect(json.leaseId).toBe(initJson.leaseId);
        });

        it('returns 401 when invalid pairingToken', async () => {
            const res = await makeRequest(port, {
                method: 'POST',
                path: '/api/mobile/pair/complete',
                token: TEST_TOKEN,
                body: JSON.stringify({ pairingToken: 'bogus-token' }),
            });
            expect(res.statusCode).toBe(401);
            const json = JSON.parse(res.body);
            expect(json.error).toMatch(/Invalid or expired/);
        });

        it('returns 400 when pairingToken missing', async () => {
            const res = await makeRequest(port, {
                method: 'POST',
                path: '/api/mobile/pair/complete',
                token: TEST_TOKEN,
                body: JSON.stringify({}),
            });
            expect(res.statusCode).toBe(400);
            const json = JSON.parse(res.body);
            expect(json.error).toMatch(/Missing pairingToken/);
        });
    });

    describe('GET /api/mobile/pair/:leaseId', () => {
        it('returns lease status for valid leaseId', async () => {
            const initRes = await makeRequest(port, {
                method: 'POST',
                path: '/api/mobile/pair/initiate',
                token: TEST_TOKEN,
                body: JSON.stringify({}),
            });
            const initJson = JSON.parse(initRes.body);

            const res = await makeRequest(port, {
                method: 'GET',
                path: `/api/mobile/pair/${initJson.leaseId}`,
                token: TEST_TOKEN,
            });
            expect(res.statusCode).toBe(200);
            const json = JSON.parse(res.body);
            expect(json.state).toBe('active');
            expect(json.leaseId).toBe(initJson.leaseId);
        });

        it('returns missing state for unknown leaseId', async () => {
            const res = await makeRequest(port, {
                method: 'GET',
                path: '/api/mobile/pair/nonexistent-id',
                token: TEST_TOKEN,
            });
            expect(res.statusCode).toBe(200);
            const json = JSON.parse(res.body);
            expect(json.state).toBe('missing');
        });
    });

    describe('POST /api/mobile/pair/:leaseId/revoke', () => {
        it('returns 200 and revokes lease', async () => {
            const initRes = await makeRequest(port, {
                method: 'POST',
                path: '/api/mobile/pair/initiate',
                token: TEST_TOKEN,
                body: JSON.stringify({}),
            });
            const initJson = JSON.parse(initRes.body);

            const res = await makeRequest(port, {
                method: 'POST',
                path: `/api/mobile/pair/${initJson.leaseId}/revoke`,
                token: TEST_TOKEN,
            });
            expect(res.statusCode).toBe(200);
            const json = JSON.parse(res.body);
            expect(json.ok).toBe(true);
            expect(json.leaseId).toBe(initJson.leaseId);

            // Verify it's actually revoked
            const statusRes = await makeRequest(port, {
                method: 'GET',
                path: `/api/mobile/pair/${initJson.leaseId}`,
                token: TEST_TOKEN,
            });
            const statusJson = JSON.parse(statusRes.body);
            expect(statusJson.state).toBe('revoked');
        });

        it('returns 404 for unknown leaseId', async () => {
            const res = await makeRequest(port, {
                method: 'POST',
                path: '/api/mobile/pair/nonexistent-id/revoke',
                token: TEST_TOKEN,
            });
            expect(res.statusCode).toBe(404);
            const json = JSON.parse(res.body);
            expect(json.error).toMatch(/Lease not found/);
        });
    });
});
