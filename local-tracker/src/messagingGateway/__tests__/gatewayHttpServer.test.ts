import http from 'http';

import {
    buildEmptyMessagingGatewayDiscoveryTelemetrySummary,
    buildMessagingGatewayReadinessMetadata,
    type SyncedNoteSourceRecord,
} from '@elegy-copilot/contracts';
import {
    GatewayHttpServer,
    LIFECYCLE_MIXED_VERSION_COMPATIBILITY_CAPABILITY,
    LIFECYCLE_MIXED_VERSION_COMPATIBILITY_CONTRACT_VERSION,
} from '../gatewayHttpServer';
import type { MessagingGatewayStatusV1 } from '../statusFile';
import type { WorkflowHttpRunResponse } from '../workflows/workflowHttpRoutes';
import { parseWorkflowDefinition, type WorkflowDefinition } from '../workflows/workflowSchema';

const TEST_TOKEN = 'test-secret-token-abc123';
const TEMPLATE_DEFINITION: WorkflowDefinition = {
    id: 'template-1',
    name: 'Template One',
    version: '1.0.0',
    schemaVersion: '1.0',
    steps: [{
        id: 'step-1',
        name: 'Step 1',
        type: 'action',
        action: 'noop',
        streaming: false,
        dependsOn: [],
    }],
};

const PERSISTED_DEFINITION: WorkflowDefinition = {
    id: 'saved-1',
    name: 'Saved Workflow One',
    version: '1.0.0',
    schemaVersion: '1.0',
    steps: [{
        id: 'step-1',
        name: 'Step 1',
        type: 'action',
        action: 'noop',
        streaming: false,
        dependsOn: [],
    }],
};

const SYNCED_NOTE_SOURCE: SyncedNoteSourceRecord = {
    id: 'snsrc_1234567890abcdef1234567890abcdef',
    provider: 'github',
    host: 'github.com',
    owner: 'InstructionEngine',
    repo: 'workspace',
    branch: 'main',
    notesPath: 'docs/planning/synced-note.md',
    localCheckoutPath: 'C:\\Repos\\instruction-engine',
    createdAt: '2026-03-18T00:00:00.000Z',
    updatedAt: '2026-03-18T00:00:00.000Z',
};

function buildSyncedNoteSourceResponse(payload: unknown, id = SYNCED_NOTE_SOURCE.id): SyncedNoteSourceRecord {
    const overrides = payload && typeof payload === 'object'
        ? payload as Partial<typeof SYNCED_NOTE_SOURCE>
        : {};

    return {
        ...SYNCED_NOTE_SOURCE,
        ...overrides,
        provider: overrides.provider ?? SYNCED_NOTE_SOURCE.provider,
        id,
    };
}

function makeGatewayStatus(overrides: Partial<MessagingGatewayStatusV1> = {}): MessagingGatewayStatusV1 {
    return {
        ...buildMessagingGatewayReadinessMetadata({ normalizedFrom: 'v1' }),
        readiness: {
            state: 'ready',
            reasonCode: 'gateway_ready',
            deterministic: true,
        },
        lastUpdatedUtc: '2026-03-17T00:00:00.000Z',
        config: {
            configPath: '/tmp/gateway-config.json',
            mode: 'connected',
            allowlists: {
                discordUsersCount: 1,
                workspaceRootsCount: 1,
            },
            workspaces: {
                activeRoot: '/tmp/workspace',
            },
        },
        secrets: {
            discordBotToken: { present: false, fromKeychain: false, fromEnv: false },
            gatewayHttpToken: { present: true, fromKeychain: true, fromEnv: false },
            telegramBotToken: { present: false, fromKeychain: false, fromEnv: false },
        },
        runtime: {
            discord: { connected: true, ready: true },
            discoveryTelemetry: buildEmptyMessagingGatewayDiscoveryTelemetrySummary(),
        },
        ...overrides,
    };
}

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
    const workflowListeners = new Set<(event: any) => void>();

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
    const mockGetStatus = jest.fn<MessagingGatewayStatusV1, []>().mockReturnValue(makeGatewayStatus());
    const mockWorkflowSubscribe = jest.fn((listener: (event: any) => void) => {
        workflowListeners.add(listener);
    });
    const mockWorkflowUnsubscribe = jest.fn((listener: (event: any) => void) => {
        workflowListeners.delete(listener);
    });
    const mockGetWorkflowBacklog = jest.fn().mockReturnValue({ events: [], droppedCount: 0 });
    const mockListTemplateDefinitions = jest.fn<WorkflowDefinition[], []>(() => [TEMPLATE_DEFINITION]);
    const mockGetTemplateDefinition = jest.fn<WorkflowDefinition | undefined, [string]>(
        (id: string) => (id === TEMPLATE_DEFINITION.id ? TEMPLATE_DEFINITION : undefined),
    );
    const mockListPersistedDefinitions = jest.fn<WorkflowDefinition[], []>(() => [PERSISTED_DEFINITION]);
    const mockGetPersistedDefinition = jest.fn<WorkflowDefinition | undefined, [string]>(
        (id: string) => (id === PERSISTED_DEFINITION.id ? PERSISTED_DEFINITION : undefined),
    );
    const mockCreatePersistedDefinition = jest.fn<WorkflowDefinition, [unknown]>(
        (payload: unknown) => parseWorkflowDefinition(payload),
    );
    const mockUpdatePersistedDefinition = jest.fn<WorkflowDefinition, [string, unknown]>(
        (_id: string, payload: unknown) => parseWorkflowDefinition(payload),
    );
    const mockDeletePersistedDefinition = jest.fn((id: string) => id === PERSISTED_DEFINITION.id);
    const mockRunPersistedDefinition = jest.fn<Promise<WorkflowHttpRunResponse>, [WorkflowDefinition]>(async () => ({
        result: {
            workflowId: PERSISTED_DEFINITION.id,
            status: 'completed',
            startedAtMs: 1,
            completedAtMs: 2,
            steps: [{ stepId: 'step-1', status: 'success', durationMs: 1 }],
        },
        runId: 'run-http-1',
    }));
    const mockListSyncedNoteSources = jest.fn<SyncedNoteSourceRecord[], []>(() => [SYNCED_NOTE_SOURCE]);
    const mockGetSyncedNoteSource = jest.fn<SyncedNoteSourceRecord | undefined, [string]>(
        (id: string) => (id === SYNCED_NOTE_SOURCE.id ? SYNCED_NOTE_SOURCE : undefined),
    );
    const mockCreateSyncedNoteSource = jest.fn<SyncedNoteSourceRecord, [unknown]>(
        (payload: unknown) => buildSyncedNoteSourceResponse(payload),
    );
    const mockUpdateSyncedNoteSource = jest.fn<SyncedNoteSourceRecord, [string, unknown]>(
        (id: string, payload: unknown) => buildSyncedNoteSourceResponse(payload, id),
    );
    const mockDeleteSyncedNoteSource = jest.fn((id: string) => id === SYNCED_NOTE_SOURCE.id);

    beforeAll(async () => {
        server = new GatewayHttpServer({
            port: 0,
            host: '127.0.0.1',
            bearerToken: TEST_TOKEN,
            getSessions: mockGetSessions,
            getStatus: mockGetStatus,
            getPendingPermissions: mockGetPendingPermissions,
            approvePermission: mockApprovePermission,
            denyPermission: mockDenyPermission,
            authorizeLifecycleAction: mockAuthorizeLifecycleAction,
            handleLifecycleAction: mockHandleLifecycleAction,
            getPolicyGateStatus: mockGetPolicyGateStatus,
            workflowStreaming: {
                subscribe: mockWorkflowSubscribe,
                unsubscribe: mockWorkflowUnsubscribe,
                getBacklogSnapshot: mockGetWorkflowBacklog,
            },
            workflowApi: {
                listTemplateDefinitions: mockListTemplateDefinitions,
                getTemplateDefinition: mockGetTemplateDefinition,
                listPersistedDefinitions: mockListPersistedDefinitions,
                getPersistedDefinition: mockGetPersistedDefinition,
                createPersistedDefinition: mockCreatePersistedDefinition,
                updatePersistedDefinition: mockUpdatePersistedDefinition,
                deletePersistedDefinition: mockDeletePersistedDefinition,
                runPersistedDefinition: mockRunPersistedDefinition,
            },
            syncedNoteSourceApi: {
                listSources: mockListSyncedNoteSources,
                getSource: mockGetSyncedNoteSource,
                createSource: mockCreateSyncedNoteSource,
                updateSource: mockUpdateSyncedNoteSource,
                deleteSource: mockDeleteSyncedNoteSource,
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
        mockGetStatus.mockReturnValue(makeGatewayStatus());
        mockGetWorkflowBacklog.mockReturnValue({ events: [], droppedCount: 0 });
        mockListTemplateDefinitions.mockReturnValue([TEMPLATE_DEFINITION]);
        mockGetTemplateDefinition.mockImplementation((id: string) => (id === TEMPLATE_DEFINITION.id ? TEMPLATE_DEFINITION : undefined));
        mockListPersistedDefinitions.mockReturnValue([PERSISTED_DEFINITION]);
        mockGetPersistedDefinition.mockImplementation((id: string) => (id === PERSISTED_DEFINITION.id ? PERSISTED_DEFINITION : undefined));
        mockCreatePersistedDefinition.mockImplementation((payload: unknown) => parseWorkflowDefinition(payload));
        mockUpdatePersistedDefinition.mockImplementation((_id: string, payload: unknown) => parseWorkflowDefinition(payload));
        mockDeletePersistedDefinition.mockImplementation((id: string) => id === PERSISTED_DEFINITION.id);
        mockRunPersistedDefinition.mockResolvedValue({
            result: {
                workflowId: PERSISTED_DEFINITION.id,
                status: 'completed',
                startedAtMs: 1,
                completedAtMs: 2,
                steps: [{ stepId: 'step-1', status: 'success', durationMs: 1 }],
            },
            runId: 'run-http-1',
        });
        mockListSyncedNoteSources.mockReturnValue([SYNCED_NOTE_SOURCE]);
        mockGetSyncedNoteSource.mockImplementation((id: string) => (id === SYNCED_NOTE_SOURCE.id ? SYNCED_NOTE_SOURCE : undefined));
        mockCreateSyncedNoteSource.mockImplementation((payload: unknown) => buildSyncedNoteSourceResponse(payload));
        mockUpdateSyncedNoteSource.mockImplementation((id: string, payload: unknown) => buildSyncedNoteSourceResponse(payload, id));
        mockDeleteSyncedNoteSource.mockImplementation((id: string) => id === SYNCED_NOTE_SOURCE.id);
        workflowListeners.clear();
    });

    function emitWorkflowEvent(event: unknown): void {
        for (const listener of workflowListeners) {
            listener(event);
        }
    }

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

    it('GET /api/status returns canonical readiness payload when ready', async () => {
        const res = await makeRequest(port, { path: '/api/status', token: TEST_TOKEN });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.schemaVersion).toBe(1);
        expect(body.contractVersion).toBe('messaging_gateway_readiness_v1');
        expect(body.readiness).toEqual({
            state: 'ready',
            reasonCode: 'gateway_ready',
            deterministic: true,
        });
        expect(mockGetStatus).toHaveBeenCalledTimes(1);
    });

    it('GET /api/status returns canonical readiness payload with 503 when not ready', async () => {
        mockGetStatus.mockReturnValue(makeGatewayStatus({
            readiness: {
                state: 'not_ready',
                reasonCode: 'gateway_not_ready',
                deterministic: true,
            },
            runtime: {
                discord: { connected: true, ready: false },
                discoveryTelemetry: buildEmptyMessagingGatewayDiscoveryTelemetrySummary(),
            },
        }));

        const res = await makeRequest(port, { path: '/api/status', token: TEST_TOKEN });
        expect(res.statusCode).toBe(503);
        const body = JSON.parse(res.body);
        expect(body.readiness.state).toBe('not_ready');
        expect(body.readiness.reasonCode).toBe('gateway_not_ready');
    });

    it('GET /api/status returns deterministic 503 error when canonical status is unavailable', async () => {
        mockGetStatus.mockImplementation(() => {
            throw Object.assign(new Error('status file missing'), { code: 'messaging_gateway_status_missing' });
        });

        const res = await makeRequest(port, { path: '/api/status', token: TEST_TOKEN });
        expect(res.statusCode).toBe(503);
        const body = JSON.parse(res.body);
        expect(body.code).toBe('gateway_status_unavailable');
        expect(body.reason).toBe('gateway_status_missing');
        expect(body.deterministic).toBe(true);
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

    it('GET /api/workflows/templates returns template definitions', async () => {
        const res = await makeRequest(port, {
            method: 'GET',
            path: '/api/workflows/templates',
            token: TEST_TOKEN,
        });

        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual([TEMPLATE_DEFINITION]);
        expect(mockListTemplateDefinitions).toHaveBeenCalledTimes(1);
    });

    it('GET /api/workflows/templates/:id returns 404 when template is missing', async () => {
        const res = await makeRequest(port, {
            method: 'GET',
            path: '/api/workflows/templates/not-found',
            token: TEST_TOKEN,
        });

        expect(res.statusCode).toBe(404);
        expect(JSON.parse(res.body)).toEqual({ error: 'Workflow template not found' });
    });

    it('GET /api/workflows/definitions returns persisted definitions', async () => {
        const res = await makeRequest(port, {
            method: 'GET',
            path: '/api/workflows/definitions',
            token: TEST_TOKEN,
        });

        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual([PERSISTED_DEFINITION]);
        expect(mockListPersistedDefinitions).toHaveBeenCalledTimes(1);
    });

    it('POST /api/workflows/definitions creates a definition and returns 201', async () => {
        const payload = {
            id: 'created-1',
            name: 'Created Workflow',
            version: '1.0.0',
            schemaVersion: '1.0',
            steps: [{
                id: 'step-1',
                name: 'Step 1',
                type: 'action',
                action: 'noop',
                streaming: false,
                dependsOn: [],
            }],
        };

        mockCreatePersistedDefinition.mockImplementationOnce((input: unknown) => parseWorkflowDefinition(input));

        const res = await makeRequest(port, {
            method: 'POST',
            path: '/api/workflows/definitions',
            token: TEST_TOKEN,
            body: JSON.stringify(payload),
        });

        expect(res.statusCode).toBe(201);
        expect(JSON.parse(res.body)).toEqual(payload);
        expect(mockCreatePersistedDefinition).toHaveBeenCalledWith(payload);
    });

    it('PUT /api/workflows/definitions/:id returns 400 when body.id mismatches path id', async () => {
        const res = await makeRequest(port, {
            method: 'PUT',
            path: '/api/workflows/definitions/saved-1',
            token: TEST_TOKEN,
            body: JSON.stringify({
                id: 'other-id',
                name: 'Invalid Update',
                version: '1.0.0',
                schemaVersion: '1.0',
                steps: [{ id: 'step-1', name: 'Step 1', action: 'noop', dependsOn: [] }],
            }),
        });

        expect(res.statusCode).toBe(400);
        expect(JSON.parse(res.body)).toEqual({
            error: 'Body id must match route id',
            code: 'workflow_id_mismatch',
        });
        expect(mockUpdatePersistedDefinition).not.toHaveBeenCalled();
    });

    it('DELETE /api/workflows/definitions/:id returns 404 when definition is missing', async () => {
        const res = await makeRequest(port, {
            method: 'DELETE',
            path: '/api/workflows/definitions/missing-id',
            token: TEST_TOKEN,
        });

        expect(res.statusCode).toBe(404);
        expect(JSON.parse(res.body)).toEqual({ error: 'Workflow definition not found' });
    });

    it('POST /api/workflows/definitions/:id/run returns run result and runId', async () => {
        const res = await makeRequest(port, {
            method: 'POST',
            path: '/api/workflows/definitions/saved-1/run',
            token: TEST_TOKEN,
        });

        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual({
            result: {
                workflowId: 'saved-1',
                status: 'completed',
                startedAtMs: 1,
                completedAtMs: 2,
                steps: [{ stepId: 'step-1', status: 'success', durationMs: 1 }],
            },
            runId: 'run-http-1',
        });
        expect(mockRunPersistedDefinition).toHaveBeenCalledWith(PERSISTED_DEFINITION);
    });

    it('POST /api/workflows/definitions/:id/run returns 503 when runtime is unavailable', async () => {
        const runtimeUnavailableError = new Error('Workflow runtime unavailable: no extension client connected') as Error & {
            statusCode: number;
            code: string;
        };
        runtimeUnavailableError.statusCode = 503;
        runtimeUnavailableError.code = 'workflow_runtime_unavailable';
        mockRunPersistedDefinition.mockRejectedValueOnce(runtimeUnavailableError);

        const res = await makeRequest(port, {
            method: 'POST',
            path: '/api/workflows/definitions/saved-1/run',
            token: TEST_TOKEN,
        });

        expect(res.statusCode).toBe(503);
        expect(JSON.parse(res.body)).toEqual({
            error: 'Workflow runtime unavailable: no extension client connected',
            code: 'workflow_runtime_unavailable',
        });
    });

    it('GET /api/synced-notes/sources returns persisted synced-note sources', async () => {
        const res = await makeRequest(port, {
            method: 'GET',
            path: '/api/synced-notes/sources',
            token: TEST_TOKEN,
        });

        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual([SYNCED_NOTE_SOURCE]);
        expect(mockListSyncedNoteSources).toHaveBeenCalledTimes(1);
    });

    it('POST /api/synced-notes/sources creates a synced-note source and returns 201', async () => {
        const payload = {
            provider: 'github',
            host: 'github.com',
            owner: 'InstructionEngine',
            repo: 'workspace',
            branch: 'main',
            notesPath: 'docs/planning/seed.md',
        };

        const res = await makeRequest(port, {
            method: 'POST',
            path: '/api/synced-notes/sources',
            token: TEST_TOKEN,
            body: JSON.stringify(payload),
        });

        expect(res.statusCode).toBe(201);
        expect(JSON.parse(res.body)).toEqual({
            ...SYNCED_NOTE_SOURCE,
            ...payload,
        });
        expect(mockCreateSyncedNoteSource).toHaveBeenCalledWith(payload);
    });

    it('GET /api/synced-notes/sources/:id returns the selected synced-note source', async () => {
        const res = await makeRequest(port, {
            method: 'GET',
            path: `/api/synced-notes/sources/${SYNCED_NOTE_SOURCE.id}`,
            token: TEST_TOKEN,
        });

        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual(SYNCED_NOTE_SOURCE);
        expect(mockGetSyncedNoteSource).toHaveBeenCalledWith(SYNCED_NOTE_SOURCE.id);
    });

    it('GET /api/synced-notes/sources/:id rejects malformed ids deterministically', async () => {
        const res = await makeRequest(port, {
            method: 'GET',
            path: '/api/synced-notes/sources/not-a-valid-id',
            token: TEST_TOKEN,
        });

        expect(res.statusCode).toBe(400);
        expect(JSON.parse(res.body)).toEqual({
            error: 'Invalid synced-note source id format',
            code: 'invalid_synced_note_source_id',
        });
        expect(mockGetSyncedNoteSource).not.toHaveBeenCalled();
    });

    it('PUT /api/synced-notes/sources/:id updates a synced-note source', async () => {
        const payload = {
            provider: 'github',
            host: 'github.com',
            owner: 'InstructionEngine',
            repo: 'workspace',
            branch: 'main',
            notesPath: 'docs/planning/updated.md',
        };

        const res = await makeRequest(port, {
            method: 'PUT',
            path: `/api/synced-notes/sources/${SYNCED_NOTE_SOURCE.id}`,
            token: TEST_TOKEN,
            body: JSON.stringify(payload),
        });

        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual({
            ...SYNCED_NOTE_SOURCE,
            ...payload,
            id: SYNCED_NOTE_SOURCE.id,
        });
        expect(mockUpdateSyncedNoteSource).toHaveBeenCalledWith(SYNCED_NOTE_SOURCE.id, {
            ...payload,
            id: SYNCED_NOTE_SOURCE.id,
        });
    });

    it('PUT /api/synced-notes/sources/:id rejects body id mismatches before hitting the store', async () => {
        const res = await makeRequest(port, {
            method: 'PUT',
            path: `/api/synced-notes/sources/${SYNCED_NOTE_SOURCE.id}`,
            token: TEST_TOKEN,
            body: JSON.stringify({
                id: 'snsrc_abcdefabcdefabcdefabcdefabcdefab',
                provider: 'github',
                host: 'github.com',
                owner: 'InstructionEngine',
                repo: 'workspace',
                branch: 'main',
                notesPath: 'docs/planning/updated.md',
            }),
        });

        expect(res.statusCode).toBe(400);
        expect(JSON.parse(res.body)).toEqual({
            error: 'Body id must match route id',
            code: 'synced_note_source_id_mismatch',
        });
        expect(mockUpdateSyncedNoteSource).not.toHaveBeenCalled();
    });

    it('PUT /api/synced-notes/sources/:id returns deterministic locator drift errors from the store', async () => {
        const driftError = new Error('Payload locator does not match route id') as Error & {
            statusCode: number;
            code: string;
        };
        driftError.statusCode = 400;
        driftError.code = 'synced_note_source_locator_mismatch';
        mockUpdateSyncedNoteSource.mockImplementationOnce(() => {
            throw driftError;
        });

        const res = await makeRequest(port, {
            method: 'PUT',
            path: `/api/synced-notes/sources/${SYNCED_NOTE_SOURCE.id}`,
            token: TEST_TOKEN,
            body: JSON.stringify({
                provider: 'git',
                host: 'git.internal.test',
                owner: 'team-notes',
                repo: 'planning',
                branch: 'feature/synced-note',
                notesPath: 'notes/team.md',
            }),
        });

        expect(res.statusCode).toBe(400);
        expect(JSON.parse(res.body)).toEqual({
            error: 'Payload locator does not match route id',
            code: 'synced_note_source_locator_mismatch',
        });
    });

    it('DELETE /api/synced-notes/sources/:id deletes a synced-note source', async () => {
        const res = await makeRequest(port, {
            method: 'DELETE',
            path: `/api/synced-notes/sources/${SYNCED_NOTE_SOURCE.id}`,
            token: TEST_TOKEN,
        });

        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ ok: true, id: SYNCED_NOTE_SOURCE.id });
        expect(mockDeleteSyncedNoteSource).toHaveBeenCalledWith(SYNCED_NOTE_SOURCE.id);
    });

    it('DELETE /api/synced-notes/sources/:id returns deterministic not-found errors', async () => {
        const res = await makeRequest(port, {
            method: 'DELETE',
            path: '/api/synced-notes/sources/snsrc_ffffffffffffffffffffffffffffffff',
            token: TEST_TOKEN,
        });

        expect(res.statusCode).toBe(404);
        expect(JSON.parse(res.body)).toEqual({
            error: 'Synced-note source not found',
            code: 'synced_note_source_not_found',
        });
    });

    it('GET /api/workflows/events requires auth', async () => {
        const res = await makeRequest(port, { path: '/api/workflows/events?runId=run-1' });
        expect(res.statusCode).toBe(401);
    });

    it('GET /api/workflows/events returns 400 when runId is missing', async () => {
        const res = await makeRequest(port, { path: '/api/workflows/events', token: TEST_TOKEN });
        expect(res.statusCode).toBe(400);
        expect(JSON.parse(res.body)).toEqual({ error: 'Missing or invalid runId' });
    });

    it('GET /api/workflows/events returns SSE stream with connected event', async () => {
        const data = await new Promise<string>((resolve, reject) => {
            const req = http.request(
                {
                    hostname: '127.0.0.1',
                    port,
                    path: '/api/workflows/events?runId=run-1',
                    method: 'GET',
                    headers: { Authorization: `Bearer ${TEST_TOKEN}` },
                },
                (res) => {
                    expect(res.statusCode).toBe(200);
                    expect(res.headers['content-type']).toBe('text/event-stream');
                    let received = '';
                    res.on('data', (chunk) => {
                        received += chunk;
                        if (received.includes('event: connected')) {
                            req.destroy();
                            resolve(received);
                        }
                    });
                },
            );
            req.on('error', (err) => {
                if ((err as NodeJS.ErrnoException).code !== 'ECONNRESET') reject(err);
            });
            req.end();
        });

        expect(data).toContain('event: connected');
        expect(data).toContain('"runId":"run-1"');
    });

    it('GET /api/workflows/events replays backlog and sends reconnect hint when events were dropped', async () => {
        mockGetWorkflowBacklog.mockReturnValueOnce({
            droppedCount: 3,
            events: [
                {
                    type: 'run.started',
                    protocolVersion: 'workflow-stream-v1',
                    runId: 'run-backlog-1',
                    workflowId: 'wf-1',
                    emittedAtMs: 1,
                    workflowName: 'Workflow 1',
                    stepCount: 1,
                    startedAtMs: 0,
                },
                {
                    type: 'step.completed',
                    protocolVersion: 'workflow-stream-v1',
                    runId: 'run-backlog-1',
                    workflowId: 'wf-1',
                    emittedAtMs: 2,
                    stepId: 'build',
                    status: 'success',
                    durationMs: 10,
                },
            ],
        });

        const data = await new Promise<string>((resolve, reject) => {
            const req = http.request(
                {
                    hostname: '127.0.0.1',
                    port,
                    path: '/api/workflows/events?runId=run-backlog-1',
                    method: 'GET',
                    headers: { Authorization: `Bearer ${TEST_TOKEN}` },
                },
                (res) => {
                    expect(res.statusCode).toBe(200);
                    let received = '';
                    res.on('data', (chunk) => {
                        received += chunk;
                        if (received.includes('event: reconnect-hint') && received.includes('"type":"step.completed"')) {
                            req.destroy();
                            resolve(received);
                        }
                    });
                },
            );
            req.on('error', (err) => {
                if ((err as NodeJS.ErrnoException).code !== 'ECONNRESET') reject(err);
            });
            req.end();
        });

        expect(data).toContain('event: reconnect-hint');
        expect(data).toContain('"droppedCount":3');
        expect(data).toContain('event: workflow');
        expect(data).toContain('"type":"run.started"');
        expect(data).toContain('"type":"step.completed"');
    });

    it('GET /api/workflows/events delivers live events only to matching runId subscribers', async () => {
        const receivedData = await new Promise<string>((resolve, reject) => {
            const req = http.request(
                {
                    hostname: '127.0.0.1',
                    port,
                    path: '/api/workflows/events?runId=run-live-1',
                    method: 'GET',
                    headers: { Authorization: `Bearer ${TEST_TOKEN}` },
                },
                (res) => {
                    expect(res.statusCode).toBe(200);
                    let connected = false;
                    let received = '';
                    res.on('data', (chunk) => {
                        received += chunk;
                        if (!connected && received.includes('event: connected')) {
                            connected = true;
                            emitWorkflowEvent({
                                type: 'step.started',
                                protocolVersion: 'workflow-stream-v1',
                                runId: 'run-other',
                                workflowId: 'wf-other',
                                emittedAtMs: 10,
                                stepId: 'x',
                                stepName: 'X',
                                action: 'noop',
                            });
                            emitWorkflowEvent({
                                type: 'step.completed',
                                protocolVersion: 'workflow-stream-v1',
                                runId: 'run-live-1',
                                workflowId: 'wf-live',
                                emittedAtMs: 11,
                                stepId: 'build',
                                status: 'success',
                                durationMs: 22,
                            });
                        }

                        if (received.includes('event: workflow') && received.includes('"runId":"run-live-1"')) {
                            req.destroy();
                            resolve(received);
                        }
                    });
                },
            );
            req.on('error', (err) => {
                if ((err as NodeJS.ErrnoException).code !== 'ECONNRESET') reject(err);
            });
            req.end();
        });

        expect(receivedData).toContain('"runId":"run-live-1"');
        expect(receivedData).not.toContain('"runId":"run-other"');
    });

    it('GET /api/workflows/events returns 429 when more than 10 clients connect for the same runId', async () => {
        const openRequests: http.ClientRequest[] = [];

        const openWorkflowSseClient = async (runId: string): Promise<void> => {
            await new Promise<void>((resolve, reject) => {
                const req = http.request(
                    {
                        hostname: '127.0.0.1',
                        port,
                        path: `/api/workflows/events?runId=${runId}`,
                        method: 'GET',
                        headers: { Authorization: `Bearer ${TEST_TOKEN}` },
                    },
                    (res) => {
                        expect(res.statusCode).toBe(200);
                        let received = '';
                        res.on('data', (chunk) => {
                            received += chunk;
                            if (received.includes('event: connected')) {
                                openRequests.push(req);
                                resolve();
                            }
                        });
                    },
                );
                req.on('error', reject);
                req.end();
            });
        };

        try {
            for (let index = 0; index < 10; index += 1) {
                await openWorkflowSseClient('run-cap-1');
            }

            const overflow = await makeRequest(port, {
                path: '/api/workflows/events?runId=run-cap-1',
                token: TEST_TOKEN,
            });

            expect(overflow.statusCode).toBe(429);
            expect(JSON.parse(overflow.body)).toEqual({ error: 'Too many workflow stream clients for runId' });
        } finally {
            for (const req of openRequests) {
                req.destroy();
            }
        }
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
        expect(JSON.parse(first.body).result.sandboxId).toBe('sb-edited-canonical');
        expect(JSON.parse(retry.body).result.sandboxId).toBe('sb-edited-canonical');
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
