import http from 'http';

import {
    GatewayHttpServer,
    LIFECYCLE_MIXED_VERSION_COMPATIBILITY_CAPABILITY,
    LIFECYCLE_MIXED_VERSION_COMPATIBILITY_CONTRACT_VERSION,
} from '../gatewayHttpServer';

const TEST_TOKEN = 'test-secret-token-abc123';

function makeRequest(
    port: number,
    options: {
        method?: string;
        path: string;
        token?: string;
        body?: string;
        headers?: Record<string, string>;
        includeLifecycleCompatibilityHeaders?: boolean;
    },
): Promise<{ statusCode: number; body: string; headers: http.IncomingHttpHeaders }> {
    return new Promise((resolve, reject) => {
        const includeLifecycleCompatibilityHeaders = options.includeLifecycleCompatibilityHeaders !== false
            && options.path.startsWith('/api/lifecycle/');
        const req = http.request(
            {
                hostname: '127.0.0.1',
                port,
                path: options.path,
                method: options.method ?? 'GET',
                headers: {
                    ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
                    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
                    ...(includeLifecycleCompatibilityHeaders
                        ? {
                            'X-Instruction-Engine-Lifecycle-Contract-Version': LIFECYCLE_MIXED_VERSION_COMPATIBILITY_CONTRACT_VERSION,
                            'X-Instruction-Engine-Lifecycle-Capability': LIFECYCLE_MIXED_VERSION_COMPATIBILITY_CAPABILITY,
                        }
                        : {}),
                    ...(options.headers ?? {}),
                },
            },
            (res) => {
                let data = '';
                res.on('data', (chunk) => {
                    data += chunk;
                });
                res.on('end', () => resolve({ statusCode: res.statusCode!, body: data, headers: res.headers }));
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
    const mockAuthorizeLifecycleAction = jest.fn().mockReturnValue({ allowed: true });
    const mockHandleLifecycleAction = jest.fn<Promise<unknown>, [string, unknown, http.IncomingMessage]>().mockResolvedValue({ status: 'queued' });
    const mockGetPolicyGateStatus = jest.fn().mockReturnValue({ ok: true });

    beforeAll(async () => {
        server = new GatewayHttpServer({
            port: 0,
            host: '127.0.0.1',
            bearerToken: TEST_TOKEN,
            getSessions: mockGetSessions,
            getPendingPermissions: mockGetPendingPermissions,
            approvePermission: mockApprovePermission,
            denyPermission: mockDenyPermission,
            authorizeLifecycleAction: mockAuthorizeLifecycleAction,
            handleLifecycleAction: mockHandleLifecycleAction,
            getPolicyGateStatus: mockGetPolicyGateStatus,
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
        mockAuthorizeLifecycleAction.mockReturnValue({ allowed: true });
        mockHandleLifecycleAction.mockResolvedValue({ status: 'queued' });
        mockGetPolicyGateStatus.mockReturnValue({ ok: true });
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

    it('POST /api/lifecycle/create preserves envelope while returning canonical sandbox metadata', async () => {
        mockHandleLifecycleAction.mockResolvedValue({ sandboxId: 'sb-1', sandboxIdSource: 'user', status: 'created' });

        const res = await makeRequest(port, {
            method: 'POST',
            path: '/api/lifecycle/create',
            token: TEST_TOKEN,
            body: JSON.stringify({ sandboxId: 'sb-1' }),
        });

        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body).toEqual({
            ok: true,
            action: 'create',
            result: {
                sandboxId: 'sb-1',
                sandboxIdSource: 'user',
                status: 'created',
            },
        });
        expect(mockAuthorizeLifecycleAction).toHaveBeenCalled();
        expect(mockHandleLifecycleAction).toHaveBeenCalledWith('create', { sandboxId: 'sb-1' }, expect.anything());
        expect(res.headers['x-instruction-engine-lifecycle-contract-version']).toBe(LIFECYCLE_MIXED_VERSION_COMPATIBILITY_CONTRACT_VERSION);
        expect(res.headers['x-instruction-engine-lifecycle-capability']).toBe(LIFECYCLE_MIXED_VERSION_COMPATIBILITY_CAPABILITY);
    });

    it('POST /api/lifecycle/create fails closed with deterministic unsupported marker when compatibility headers are missing', async () => {
        const res = await makeRequest(port, {
            method: 'POST',
            path: '/api/lifecycle/create',
            token: TEST_TOKEN,
            body: JSON.stringify({ sandboxId: 'sb-1' }),
            includeLifecycleCompatibilityHeaders: false,
        });

        expect(res.statusCode).toBe(501);
        expect(JSON.parse(res.body)).toEqual({
            error: 'Lifecycle compatibility unsupported',
            code: 'lifecycle_compatibility_unsupported',
            action: 'create',
            reason: 'client_contract_version_missing',
            deterministic: true,
            unsupported: {
                marker: 'unsupported',
                direction: 'old_client_new_tracker',
                expected: {
                    contractVersion: LIFECYCLE_MIXED_VERSION_COMPATIBILITY_CONTRACT_VERSION,
                    capability: LIFECYCLE_MIXED_VERSION_COMPATIBILITY_CAPABILITY,
                },
                received: {
                    contractVersion: null,
                    capability: null,
                },
            },
            compatibility: {
                contractVersion: LIFECYCLE_MIXED_VERSION_COMPATIBILITY_CONTRACT_VERSION,
                capability: LIFECYCLE_MIXED_VERSION_COMPATIBILITY_CAPABILITY,
                direction: 'old_client_new_tracker',
            },
        });
        expect(mockHandleLifecycleAction).not.toHaveBeenCalled();
    });

    it('POST /api/lifecycle/create forwards empty payload when sandboxId is omitted', async () => {
        const res = await makeRequest(port, {
            method: 'POST',
            path: '/api/lifecycle/create',
            token: TEST_TOKEN,
            body: JSON.stringify({}),
        });

        expect(res.statusCode).toBe(200);
        expect(mockHandleLifecycleAction).toHaveBeenCalledWith('create', {}, expect.anything());
    });

    it('POST /api/lifecycle/create preserves canonical auto-generated sandbox metadata', async () => {
        mockHandleLifecycleAction.mockResolvedValue({ sandboxId: 'sb-auto-1', sandboxIdSource: 'auto', status: 'created' });

        const res = await makeRequest(port, {
            method: 'POST',
            path: '/api/lifecycle/create',
            token: TEST_TOKEN,
            body: JSON.stringify({}),
        });

        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual({
            ok: true,
            action: 'create',
            result: {
                sandboxId: 'sb-auto-1',
                sandboxIdSource: 'auto',
                status: 'created',
            },
        });
        expect(mockHandleLifecycleAction).toHaveBeenCalledWith('create', {}, expect.anything());
    });

    it('POST /api/lifecycle/finish preserves deterministic envelope and forwards optional PR payload', async () => {
        mockHandleLifecycleAction.mockResolvedValue({
            sandboxId: 'sb-finish-1',
            status: 'finished',
            closeAllowed: true,
        });

        const payload = {
            sandboxId: 'sb-finish-1',
            prAction: 'skip-pr',
        };

        const res = await makeRequest(port, {
            method: 'POST',
            path: '/api/lifecycle/finish',
            token: TEST_TOKEN,
            body: JSON.stringify(payload),
        });

        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual({
            ok: true,
            action: 'finish',
            result: {
                sandboxId: 'sb-finish-1',
                status: 'finished',
                closeAllowed: true,
            },
        });
        expect(mockHandleLifecycleAction).toHaveBeenCalledWith('finish', payload, expect.anything());
    });

    it('POST /api/lifecycle/finish retry keeps canonical sandboxId envelope stable across repeated requests', async () => {
        const payload = {
            sandboxId: 'sb-edited-canonical',
            prAction: 'skip-pr',
        };

        mockHandleLifecycleAction
            .mockResolvedValueOnce({
                sandboxId: 'sb-edited-canonical',
                status: 'finished',
                closeAllowed: true,
                deduped: true,
                coalescedCallCount: 2,
            })
            .mockResolvedValueOnce({
                sandboxId: 'sb-edited-canonical',
                status: 'finished',
                closeAllowed: true,
                idempotent: true,
            });

        const first = await makeRequest(port, {
            method: 'POST',
            path: '/api/lifecycle/finish',
            token: TEST_TOKEN,
            body: JSON.stringify(payload),
        });

        const retry = await makeRequest(port, {
            method: 'POST',
            path: '/api/lifecycle/finish',
            token: TEST_TOKEN,
            body: JSON.stringify(payload),
        });

        expect(first.statusCode).toBe(200);
        expect(retry.statusCode).toBe(200);
        expect(JSON.parse(first.body)).toEqual({
            ok: true,
            action: 'finish',
            result: {
                sandboxId: 'sb-edited-canonical',
                status: 'finished',
                closeAllowed: true,
                deduped: true,
                coalescedCallCount: 2,
            },
        });
        expect(JSON.parse(retry.body)).toEqual({
            ok: true,
            action: 'finish',
            result: {
                sandboxId: 'sb-edited-canonical',
                status: 'finished',
                closeAllowed: true,
                idempotent: true,
            },
        });
        expect(mockHandleLifecycleAction).toHaveBeenNthCalledWith(1, 'finish', payload, expect.anything());
        expect(mockHandleLifecycleAction).toHaveBeenNthCalledWith(2, 'finish', payload, expect.anything());
    });

    it('POST /api/lifecycle/finish returns deterministic conflict-fast envelope when idempotency key payload mismatches', async () => {
        const conflictError = Object.assign(new Error('Invalid lifecycle payload: idempotency_key_payload_mismatch'), {
            name: 'LifecyclePayloadValidationError',
            code: 'idempotency_conflict',
            reason: 'idempotency_key_payload_mismatch',
            action: 'finish',
        });
        mockHandleLifecycleAction.mockRejectedValue(conflictError);

        const res = await makeRequest(port, {
            method: 'POST',
            path: '/api/lifecycle/finish',
            token: TEST_TOKEN,
            body: JSON.stringify({ sandboxId: 'sb-finish-1', prAction: 'skip-pr' }),
        });

        expect(res.statusCode).toBe(400);
        expect(JSON.parse(res.body)).toEqual({
            error: 'Invalid lifecycle payload',
            code: 'idempotency_conflict',
            action: 'finish',
            reason: 'idempotency_key_payload_mismatch',
        });
    });

    it('POST /api/lifecycle/open-terminal returns deterministic 403 when action is forbidden', async () => {
        mockAuthorizeLifecycleAction.mockImplementation((action: string) => {
            if (action === 'open-terminal') return { allowed: false, reason: 'local_machine_only' };
            return { allowed: true };
        });

        const res = await makeRequest(port, {
            method: 'POST',
            path: '/api/lifecycle/open-terminal',
            token: TEST_TOKEN,
            body: JSON.stringify({ sandboxId: 'sb-1' }),
        });

        expect(res.statusCode).toBe(403);
        expect(JSON.parse(res.body)).toEqual({
            error: 'Forbidden',
            code: 'action_not_allowed',
            action: 'open-terminal',
            reason: 'local_machine_only',
        });
        expect(mockHandleLifecycleAction).not.toHaveBeenCalled();
    });

    it('POST /api/lifecycle/:action returns 400 for invalid json', async () => {
        const res = await makeRequest(port, {
            method: 'POST',
            path: '/api/lifecycle/pr-open',
            token: TEST_TOKEN,
            body: '{invalid-json',
        });

        expect(res.statusCode).toBe(400);
        expect(JSON.parse(res.body)).toEqual({
            error: 'Invalid JSON body',
            code: 'invalid_json',
            action: 'pr-open',
        });
    });

    it('POST /api/lifecycle/open-terminal returns deterministic 400 for invalid payload schema', async () => {
        const res = await makeRequest(port, {
            method: 'POST',
            path: '/api/lifecycle/open-terminal',
            token: TEST_TOKEN,
            body: JSON.stringify({ launcher: 'pwsh' }),
        });

        expect(res.statusCode).toBe(400);
        expect(JSON.parse(res.body)).toEqual({
            error: 'Invalid lifecycle payload',
            code: 'invalid_lifecycle_payload',
            action: 'open-terminal',
            reason: 'missing_or_invalid_sandbox_id',
        });
        expect(mockHandleLifecycleAction).not.toHaveBeenCalled();
    });

    it('POST /api/lifecycle/open-terminal denies env injection fields with deterministic 400', async () => {
        const res = await makeRequest(port, {
            method: 'POST',
            path: '/api/lifecycle/open-terminal',
            token: TEST_TOKEN,
            body: JSON.stringify({ sandboxId: 'sb-1', env: { PATH: '/tmp' } }),
        });

        expect(res.statusCode).toBe(400);
        expect(JSON.parse(res.body)).toEqual({
            error: 'Invalid lifecycle payload',
            code: 'env_injection_denied',
            action: 'open-terminal',
            reason: 'forbidden_field:env',
        });
        expect(mockHandleLifecycleAction).not.toHaveBeenCalled();
    });

    it('POST /api/lifecycle/open-terminal rejects shell metacharacter fuzz inputs', async () => {
        const fuzzInputs = [
            'sb-1;whoami',
            'sb-1&&echo bad',
            'sb-1|cat /etc/passwd',
            'sb-1${HOME}',
            'sb-1$(whoami)',
        ];

        for (const sandboxId of fuzzInputs) {
            const res = await makeRequest(port, {
                method: 'POST',
                path: '/api/lifecycle/open-terminal',
                token: TEST_TOKEN,
                body: JSON.stringify({ sandboxId }),
            });

            expect(res.statusCode).toBe(400);
            expect(JSON.parse(res.body)).toEqual({
                error: 'Invalid lifecycle payload',
                code: 'invalid_lifecycle_payload',
                action: 'open-terminal',
                reason: 'unsafe_shell_syntax:sandboxId',
            });
        }

        expect(mockHandleLifecycleAction).not.toHaveBeenCalled();
    });

    it('blocks mutating routes when policy gate fails closed', async () => {
        mockGetPolicyGateStatus.mockReturnValue({
            ok: false,
            reason: 'validation_failed',
            message: 'policy lock mismatch',
        });

        const res = await makeRequest(port, {
            method: 'POST',
            path: '/api/permissions/perm-1/approve',
            token: TEST_TOKEN,
        });

        expect(res.statusCode).toBe(503);
        expect(JSON.parse(res.body)).toEqual({
            error: 'Policy gate blocked mutating request',
            code: 'policy_gate_blocked',
            reason: 'validation_failed',
            message: 'policy lock mismatch',
        });
        expect(mockApprovePermission).not.toHaveBeenCalled();
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
