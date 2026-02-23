import http from 'http';

import { GatewayHttpServer } from '../gatewayHttpServer';

const TEST_TOKEN = 'test-secret-token-abc123';

function makeRequest(
    port: number,
    options: { method?: string; path: string; token?: string; body?: string },
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
                res.on('data', (chunk) => {
                    data += chunk;
                });
                res.on('end', () => resolve({ statusCode: res.statusCode!, body: data }));
            },
        );
        req.on('error', reject);
        if (options.body) req.write(options.body);
        req.end();
    });
}

describe('GatewayHttpServer', () => {
    let server: GatewayHttpServer;
    let port: number;

    const mockGetSessions = jest.fn<Promise<unknown>, []>().mockResolvedValue([
        { id: 'sess-1', name: 'Session 1' },
        { id: 'sess-2', name: 'Session 2' },
    ]);
    const mockGetPendingPermissions = jest.fn<unknown[], []>().mockReturnValue([
        { callbackId: 'perm-1', tool: 'readFile' },
    ]);
    const mockApprovePermission = jest.fn<Promise<void>, [string, string]>().mockResolvedValue(undefined);
    const mockDenyPermission = jest.fn<Promise<void>, [string, string]>().mockResolvedValue(undefined);

    beforeAll(async () => {
        server = new GatewayHttpServer({
            port: 0,
            host: '127.0.0.1',
            bearerToken: TEST_TOKEN,
            getSessions: mockGetSessions,
            getPendingPermissions: mockGetPendingPermissions,
            approvePermission: mockApprovePermission,
            denyPermission: mockDenyPermission,
        });
        await server.start();
        port = server.getPort()!;
    });

    afterAll(async () => {
        await server.stop();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        mockGetSessions.mockResolvedValue([
            { id: 'sess-1', name: 'Session 1' },
            { id: 'sess-2', name: 'Session 2' },
        ]);
        mockGetPendingPermissions.mockReturnValue([
            { callbackId: 'perm-1', tool: 'readFile' },
        ]);
        mockApprovePermission.mockResolvedValue(undefined);
        mockDenyPermission.mockResolvedValue(undefined);
    });

    it('returns 401 when no auth header', async () => {
        const res = await makeRequest(port, { path: '/api/sessions/live' });
        expect(res.statusCode).toBe(401);
        expect(JSON.parse(res.body)).toEqual({ error: 'Unauthorized' });
    });

    it('returns 401 when wrong token', async () => {
        const res = await makeRequest(port, { path: '/api/sessions/live', token: 'wrong-token' });
        expect(res.statusCode).toBe(401);
        expect(JSON.parse(res.body)).toEqual({ error: 'Unauthorized' });
    });

    it('GET /api/sessions/live returns sessions', async () => {
        const res = await makeRequest(port, { path: '/api/sessions/live', token: TEST_TOKEN });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body).toEqual([
            { id: 'sess-1', name: 'Session 1' },
            { id: 'sess-2', name: 'Session 2' },
        ]);
        expect(mockGetSessions).toHaveBeenCalledTimes(1);
    });

    it('GET /api/permissions/pending returns pending list', async () => {
        const res = await makeRequest(port, { path: '/api/permissions/pending', token: TEST_TOKEN });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body).toEqual({ permissions: [{ callbackId: 'perm-1', tool: 'readFile' }] });
        expect(mockGetPendingPermissions).toHaveBeenCalledTimes(1);
    });

    it('POST /api/permissions/:id/approve resolves permission', async () => {
        const res = await makeRequest(port, {
            method: 'POST',
            path: '/api/permissions/perm-1/approve',
            token: TEST_TOKEN,
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body).toEqual({ ok: true, callbackId: 'perm-1', approved: true });
        expect(mockApprovePermission).toHaveBeenCalledWith('perm-1', 'copilot-ui');
    });

    it('POST /api/permissions/:id/deny resolves permission', async () => {
        const res = await makeRequest(port, {
            method: 'POST',
            path: '/api/permissions/perm-2/deny',
            token: TEST_TOKEN,
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body).toEqual({ ok: true, callbackId: 'perm-2', approved: false });
        expect(mockDenyPermission).toHaveBeenCalledWith('perm-2', 'copilot-ui');
    });

    it('POST with invalid callbackId returns 400', async () => {
        const res = await makeRequest(port, {
            method: 'POST',
            path: '/api/permissions/perm!bad%3Cscript%3E/approve',
            token: TEST_TOKEN,
        });
        expect(res.statusCode).toBe(400);
        const body = JSON.parse(res.body);
        expect(body).toEqual({ error: 'Invalid callbackId format' });
    });

    it('GET /api/events returns SSE stream with connected event', async () => {
        const data = await new Promise<string>((resolve, reject) => {
            const req = http.request(
                {
                    hostname: '127.0.0.1',
                    port,
                    path: '/api/events',
                    method: 'GET',
                    headers: { Authorization: `Bearer ${TEST_TOKEN}` },
                },
                (res) => {
                    expect(res.statusCode).toBe(200);
                    expect(res.headers['content-type']).toBe('text/event-stream');
                    let received = '';
                    res.on('data', (chunk) => {
                        received += chunk;
                        // After receiving the connected event, close
                        if (received.includes('event: connected')) {
                            req.destroy();
                            resolve(received);
                        }
                    });
                },
            );
            req.on('error', (err) => {
                // ECONNRESET is expected after req.destroy()
                if ((err as NodeJS.ErrnoException).code !== 'ECONNRESET') reject(err);
            });
            req.end();
        });

        expect(data).toContain('event: connected');
        expect(data).toContain('data: {}');
    });

    it('pushLiveEvent() sends to SSE clients', async () => {
        const receivedEvents: string[] = [];

        const eventPromise = new Promise<void>((resolve, reject) => {
            const req = http.request(
                {
                    hostname: '127.0.0.1',
                    port,
                    path: '/api/events',
                    method: 'GET',
                    headers: { Authorization: `Bearer ${TEST_TOKEN}` },
                },
                (res) => {
                    res.on('data', (chunk) => {
                        receivedEvents.push(chunk.toString());
                        // Wait for the live event after connected
                        const allData = receivedEvents.join('');
                        if (allData.includes('event: live')) {
                            req.destroy();
                            resolve();
                        }
                    });
                },
            );
            req.on('error', (err) => {
                if ((err as NodeJS.ErrnoException).code !== 'ECONNRESET') reject(err);
            });
            req.end();
        });

        // Give the SSE connection time to establish
        await new Promise((r) => setTimeout(r, 50));

        server.pushLiveEvent({ type: 'session.created', data: { id: 'sess-3' } });

        await eventPromise;

        const allData = receivedEvents.join('');
        expect(allData).toContain('event: live');
        expect(allData).toContain('"type":"session.created"');
        expect(allData).toContain('"id":"sess-3"');
    });

    it('GET unknown path returns 404', async () => {
        const res = await makeRequest(port, { path: '/api/nonexistent', token: TEST_TOKEN });
        expect(res.statusCode).toBe(404);
        expect(JSON.parse(res.body)).toEqual({ error: 'Not found' });
    });

    it('returns 401 with malformed Authorization header (no Bearer prefix)', async () => {
        const res = await makeRequest(port, { path: '/api/sessions/live', token: '' });
        // Empty token sends "Bearer " with empty value
        expect(res.statusCode).toBe(401);
    });

    it('returns 401 when token has correct length but wrong content', async () => {
        // Same length as TEST_TOKEN but different chars - tests constant-time comparison
        const sameLength = 'x'.repeat(TEST_TOKEN.length);
        const res = await makeRequest(port, { path: '/api/sessions/live', token: sameLength });
        expect(res.statusCode).toBe(401);
    });

    it('returns 401 when token is longer than expected', async () => {
        const res = await makeRequest(port, { path: '/api/sessions/live', token: TEST_TOKEN + 'extra' });
        expect(res.statusCode).toBe(401);
    });

    it('returns 401 when token is shorter than expected', async () => {
        const res = await makeRequest(port, { path: '/api/sessions/live', token: TEST_TOKEN.slice(0, 5) });
        expect(res.statusCode).toBe(401);
    });

    it('rejects request with Basic auth instead of Bearer', async () => {
        const res = await new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
            const req = http.request({
                hostname: '127.0.0.1',
                port,
                path: '/api/sessions/live',
                method: 'GET',
                headers: { Authorization: `Basic ${Buffer.from('user:pass').toString('base64')}` },
            }, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => resolve({ statusCode: res.statusCode!, body: data }));
            });
            req.on('error', reject);
            req.end();
        });
        expect(res.statusCode).toBe(401);
    });

    it('all endpoints require auth (POST approve without token)', async () => {
        const res = await makeRequest(port, { method: 'POST', path: '/api/permissions/test-id/approve' });
        expect(res.statusCode).toBe(401);
    });

    it('SSE endpoint requires auth', async () => {
        const res = await makeRequest(port, { path: '/api/events' });
        expect(res.statusCode).toBe(401);
    });
});

describe('constructor validation', () => {
    it('throws when bearerToken is empty string', () => {
        expect(() => new GatewayHttpServer({
            bearerToken: '',
            getSessions: async () => [],
            getPendingPermissions: () => [],
            approvePermission: async () => {},
            denyPermission: async () => {},
        })).toThrow('[GatewayHttpServer] bearerToken is required');
    });

    it('throws when bearerToken is whitespace only', () => {
        expect(() => new GatewayHttpServer({
            bearerToken: '   ',
            getSessions: async () => [],
            getPendingPermissions: () => [],
            approvePermission: async () => {},
            denyPermission: async () => {},
        })).toThrow('[GatewayHttpServer] bearerToken is required');
    });
});
