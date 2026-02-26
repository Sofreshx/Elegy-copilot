import http from 'http';
import { GatewayHttpServer } from '../gatewayHttpServer';

const BEARER_TOKEN = 'test-bearer-token-xyz';
const WEBHOOK_SECRET = 'telegram-secret-abc123';

function makeRequest(
    port: number,
    options: {
        method?: string;
        path: string;
        body?: string | Buffer;
        headers?: Record<string, string>;
    },
): Promise<{ statusCode: number; body: string; headers: http.IncomingHttpHeaders }> {
    return new Promise((resolve, reject) => {
        const req = http.request(
            {
                hostname: '127.0.0.1',
                port,
                path: options.path,
                method: options.method ?? 'GET',
                headers: {
                    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
                    ...(options.headers ?? {}),
                },
            },
            (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => resolve({ statusCode: res.statusCode!, body: data, headers: res.headers }));
            },
        );
        req.on('error', reject);
        if (options.body) req.write(options.body);
        req.end();
    });
}

describe('Telegram webhook route', () => {
    let server: GatewayHttpServer;
    let port: number;
    const mockOnUpdate = jest.fn<void | Promise<void>, [unknown]>();

    beforeAll(async () => {
        server = new GatewayHttpServer({
            port: 0,
            host: '127.0.0.1',
            bearerToken: BEARER_TOKEN,
            getSessions: async () => [],
            getPendingPermissions: () => [],
            approvePermission: async () => {},
            denyPermission: async () => {},
            telegramWebhook: {
                secretToken: WEBHOOK_SECRET,
                onUpdate: mockOnUpdate,
            },
        });
        await server.start();
        port = server.getPort()!;
    });

    afterAll(async () => {
        await server.stop();
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('correct secret → 200, onUpdate called', async () => {
        const update = { update_id: 1, message: { text: 'hello' } };
        const res = await makeRequest(port, {
            method: 'POST',
            path: '/api/telegram/webhook',
            body: JSON.stringify(update),
            headers: { 'X-Telegram-Bot-Api-Secret-Token': WEBHOOK_SECRET },
        });
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ ok: true });
        expect(mockOnUpdate).toHaveBeenCalledTimes(1);
        expect(mockOnUpdate).toHaveBeenCalledWith(update);
    });

    it('wrong secret → 403', async () => {
        const res = await makeRequest(port, {
            method: 'POST',
            path: '/api/telegram/webhook',
            body: JSON.stringify({ update_id: 2 }),
            headers: { 'X-Telegram-Bot-Api-Secret-Token': 'wrong-secret' },
        });
        expect(res.statusCode).toBe(403);
        expect(JSON.parse(res.body)).toEqual({ error: 'Forbidden' });
        expect(mockOnUpdate).not.toHaveBeenCalled();
    });

    it('missing secret → 403', async () => {
        const res = await makeRequest(port, {
            method: 'POST',
            path: '/api/telegram/webhook',
            body: JSON.stringify({ update_id: 3 }),
        });
        expect(res.statusCode).toBe(403);
        expect(JSON.parse(res.body)).toEqual({ error: 'Forbidden' });
        expect(mockOnUpdate).not.toHaveBeenCalled();
    });

    it('duplicate update_id → 200 with deduplicated:true, onUpdate NOT called again', async () => {
        const update = { update_id: 100, message: { text: 'dup test' } };
        const headers = { 'X-Telegram-Bot-Api-Secret-Token': WEBHOOK_SECRET };

        // First call
        const res1 = await makeRequest(port, {
            method: 'POST',
            path: '/api/telegram/webhook',
            body: JSON.stringify(update),
            headers,
        });
        expect(res1.statusCode).toBe(200);
        expect(JSON.parse(res1.body)).toEqual({ ok: true });
        expect(mockOnUpdate).toHaveBeenCalledTimes(1);

        mockOnUpdate.mockClear();

        // Second call (duplicate)
        const res2 = await makeRequest(port, {
            method: 'POST',
            path: '/api/telegram/webhook',
            body: JSON.stringify(update),
            headers,
        });
        expect(res2.statusCode).toBe(200);
        expect(JSON.parse(res2.body)).toEqual({ ok: true, deduplicated: true });
        expect(mockOnUpdate).not.toHaveBeenCalled();
    });

    it('body too large (>64KB) → 413', async () => {
        const largeBody = JSON.stringify({ update_id: 4, data: 'x'.repeat(65 * 1024) });
        const res = await makeRequest(port, {
            method: 'POST',
            path: '/api/telegram/webhook',
            body: largeBody,
            headers: { 'X-Telegram-Bot-Api-Secret-Token': WEBHOOK_SECRET },
        });
        expect(res.statusCode).toBe(413);
        expect(mockOnUpdate).not.toHaveBeenCalled();
    });

    it('invalid JSON → 400', async () => {
        const res = await makeRequest(port, {
            method: 'POST',
            path: '/api/telegram/webhook',
            body: '{not valid json',
            headers: { 'X-Telegram-Bot-Api-Secret-Token': WEBHOOK_SECRET },
        });
        expect(res.statusCode).toBe(400);
        expect(JSON.parse(res.body)).toEqual({ error: 'Invalid JSON' });
        expect(mockOnUpdate).not.toHaveBeenCalled();
    });

    it('other routes still require bearer auth', async () => {
        const res = await makeRequest(port, {
            method: 'GET',
            path: '/api/sessions/live',
            // No bearer token
        });
        expect(res.statusCode).toBe(401);
        expect(JSON.parse(res.body)).toEqual({ error: 'Unauthorized' });
    });
});

describe('Telegram webhook not configured', () => {
    let server: GatewayHttpServer;
    let port: number;

    beforeAll(async () => {
        server = new GatewayHttpServer({
            port: 0,
            host: '127.0.0.1',
            bearerToken: BEARER_TOKEN,
            getSessions: async () => [],
            getPendingPermissions: () => [],
            approvePermission: async () => {},
            denyPermission: async () => {},
            // No telegramWebhook
        });
        await server.start();
        port = server.getPort()!;
    });

    afterAll(async () => {
        await server.stop();
    });

    it('webhook not configured → 404', async () => {
        const res = await makeRequest(port, {
            method: 'POST',
            path: '/api/telegram/webhook',
            body: JSON.stringify({ update_id: 1 }),
            headers: { 'X-Telegram-Bot-Api-Secret-Token': 'anything' },
        });
        expect(res.statusCode).toBe(404);
        expect(JSON.parse(res.body)).toEqual({ error: 'Telegram webhook not configured' });
    });
});
