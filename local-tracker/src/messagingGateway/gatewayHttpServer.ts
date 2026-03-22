import crypto from 'crypto';
import http from 'http';

import type { MessagingGatewayStatusV1 } from './statusFile';
import {
    isLifecyclePayloadValidationError,
    validateOpenTerminalPayload,
} from './lifecycleOpenTerminal';
import {
    handleWorkflowHttpRoute,
    type WorkflowHttpApiHandlers,
} from './workflows/workflowHttpRoutes';
import type {
    WorkflowBacklogSnapshot,
    WorkflowStreamEvent,
    WorkflowStreamListener,
} from './workflows/workflowStreaming';
import {
    issueMobileSession,
    rotateMobileSession,
    validateMobileSession,
} from './mobileAuth';
import {
    getMobilePairingLeaseStatus,
    issueMobilePairingLease,
    resolveMobilePairingLease,
    revokeMobilePairingLease,
} from './mobilePairingLease';

export type LifecycleAction = 'create' | 'start' | 'stop' | 'open-terminal' | 'pr-open' | 'finish';

const LIFECYCLE_ACTION_SET = new Set<LifecycleAction>(['create', 'start', 'stop', 'open-terminal', 'pr-open', 'finish']);
export const LIFECYCLE_MIXED_VERSION_COMPATIBILITY_CONTRACT_VERSION = '1';
export const LIFECYCLE_MIXED_VERSION_COMPATIBILITY_CAPABILITY = 'mixed-version-lifecycle-v1';
const LIFECYCLE_COMPATIBILITY_HEADER_CONTRACT_VERSION = 'x-instruction-engine-lifecycle-contract-version';
const LIFECYCLE_COMPATIBILITY_HEADER_CAPABILITY = 'x-instruction-engine-lifecycle-capability';
const LIFECYCLE_COMPATIBILITY_RESPONSE_HEADERS = {
    'X-Instruction-Engine-Lifecycle-Contract-Version': LIFECYCLE_MIXED_VERSION_COMPATIBILITY_CONTRACT_VERSION,
    'X-Instruction-Engine-Lifecycle-Capability': LIFECYCLE_MIXED_VERSION_COMPATIBILITY_CAPABILITY,
};

export interface LifecycleAuthorizationResult {
    allowed: boolean;
    reason?: string;
}

export interface PolicyGateStatus {
    ok: boolean;
    reason?: string;
    message?: string;
}

interface LifecycleCompatibilityResult {
    compatible: boolean;
    reason: string;
    receivedContractVersion: string | null;
    receivedCapability: string | null;
}

export interface TelegramWebhookOptions {
    /** Shared secret from Telegram webhook registration (`X-Telegram-Bot-Api-Secret-Token`). */
    secretToken: string;
    /** Update handler callback (typically delegates to TelegramPlatform.handleUpdate). */
    onUpdate: (update: unknown) => void | Promise<void>;
    /** Max accepted request body size in bytes. Default: 64KB. */
    maxBodyBytes?: number;
    /** Dedupe TTL window for update_id values in ms. Default: 10 minutes. */
    dedupeTtlMs?: number;
}

export interface WorkflowStreamingSseOptions {
    subscribe: (listener: WorkflowStreamListener) => void;
    unsubscribe: (listener: WorkflowStreamListener) => void;
    getBacklogSnapshot: (runId: string) => WorkflowBacklogSnapshot;
}

function normalizeLifecycleCompatibilityToken(value: unknown): string {
    if (Array.isArray(value)) {
        return normalizeLifecycleCompatibilityToken(value.length > 0 ? value[0] : '');
    }
    if (typeof value !== 'string') {
        return '';
    }
    return value.trim().toLowerCase();
}

export interface GatewayHttpServerOptions {
    /** Port to listen on. Default: 4100 */
    port?: number;
    /** Host to bind to. Default: '127.0.0.1' (loopback only) */
    host?: string;
    /** Bearer token for authentication. All endpoints require this. */
    bearerToken: string;
    /** Get live sessions from ACP */
    getSessions: () => Promise<unknown>;
    /** Get canonical gateway readiness status. */
    getStatus?: () => MessagingGatewayStatusV1;
    /** Get pending permissions */
    getPendingPermissions: () => unknown[];
    /** Approve a permission */
    approvePermission: (callbackId: string, resolvedBy: string) => Promise<void>;
    /** Deny a permission */
    denyPermission: (callbackId: string, resolvedBy: string) => Promise<void>;
    /** Optional authorization callback for lifecycle action endpoints. */
    authorizeLifecycleAction?: (action: LifecycleAction, req: http.IncomingMessage) => LifecycleAuthorizationResult;
    /** Optional lifecycle action handler. */
    handleLifecycleAction?: (action: LifecycleAction, payload: unknown, req: http.IncomingMessage) => Promise<unknown>;
    /** Optional policy gate callback for fail-closed mutating routes. */
    getPolicyGateStatus?: () => PolicyGateStatus;
    /** Optional Telegram webhook endpoint (`POST /api/telegram/webhook`) configuration. */
    telegramWebhook?: TelegramWebhookOptions;
    /** Enables mobile pairing and session endpoints (`/api/mobile/*`). */
    mobilePairing?: boolean;
    /** Optional workflow streaming endpoint wiring (`GET /api/workflows/events?runId=<id>`). */
    workflowStreaming?: WorkflowStreamingSseOptions;
    /** Optional workflow CRUD + run endpoint wiring (`/api/workflows/*`). */
    workflowApi?: WorkflowHttpApiHandlers;
}

export class GatewayHttpServer {
    private server: http.Server | null = null;
    private readonly port: number;
    private readonly host: string;
    private readonly bearerToken: string;
    private readonly getSessions: () => Promise<unknown>;
    private readonly getStatus: (() => MessagingGatewayStatusV1) | undefined;
    private readonly getPendingPermissions: () => unknown[];
    private readonly approvePermission: (callbackId: string, resolvedBy: string) => Promise<void>;
    private readonly denyPermission: (callbackId: string, resolvedBy: string) => Promise<void>;
    private readonly authorizeLifecycleAction: (action: LifecycleAction, req: http.IncomingMessage) => LifecycleAuthorizationResult;
    private readonly handleLifecycleAction: ((action: LifecycleAction, payload: unknown, req: http.IncomingMessage) => Promise<unknown>) | undefined;
    private readonly getPolicyGateStatus: (() => PolicyGateStatus) | undefined;
    private readonly telegramWebhook: TelegramWebhookOptions | undefined;
    private readonly mobilePairingEnabled: boolean;
    private readonly workflowStreaming: WorkflowStreamingSseOptions | undefined;
    private readonly workflowApi: WorkflowHttpApiHandlers | undefined;
    private readonly telegramSeenUpdateIds = new Map<number, number>();

    // SSE connections
    private readonly sseClients = new Set<http.ServerResponse>();
    private readonly workflowSseClientsByRunId = new Map<string, Set<http.ServerResponse>>();
    private readonly workflowSseListenerByRunId = new Map<string, WorkflowStreamListener>();
    private heartbeatTimer: NodeJS.Timeout | null = null;

    constructor(options: GatewayHttpServerOptions) {
        this.port = options.port ?? 4100;
        this.host = options.host ?? '127.0.0.1';
        this.bearerToken = options.bearerToken;
        if (!this.bearerToken || this.bearerToken.trim().length === 0) {
            throw new Error('[GatewayHttpServer] bearerToken is required');
        }
        this.getSessions = options.getSessions;
        this.getStatus = options.getStatus;
        this.getPendingPermissions = options.getPendingPermissions;
        this.approvePermission = options.approvePermission;
        this.denyPermission = options.denyPermission;
        this.authorizeLifecycleAction = options.authorizeLifecycleAction ?? (() => ({ allowed: true }));
        this.handleLifecycleAction = options.handleLifecycleAction;
        this.getPolicyGateStatus = options.getPolicyGateStatus;
        this.telegramWebhook = options.telegramWebhook;
        this.mobilePairingEnabled = options.mobilePairing === true;
        this.workflowStreaming = options.workflowStreaming;
        this.workflowApi = options.workflowApi;

        if (this.telegramWebhook) {
            if (typeof this.telegramWebhook.secretToken !== 'string' || this.telegramWebhook.secretToken.trim().length === 0) {
                throw new Error('[GatewayHttpServer] telegramWebhook.secretToken is required when telegramWebhook is configured');
            }
            if (typeof this.telegramWebhook.onUpdate !== 'function') {
                throw new Error('[GatewayHttpServer] telegramWebhook.onUpdate must be a function when telegramWebhook is configured');
            }
        }
    }

    async start(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.server = http.createServer((req, res) => this.handleRequest(req, res));
            this.server.on('error', reject);
            this.server.listen(this.port, this.host, () => {
                console.log(`[GatewayHttp] Listening on http://${this.host}:${this.port}`);
                this.startHeartbeat();
                resolve();
            });
        });
    }

    async stop(): Promise<void> {
        this.stopHeartbeat();
        // Close all SSE connections
        for (const client of this.sseClients) {
            try { client.end(); } catch { /* ignore */ }
        }
        this.sseClients.clear();

        for (const [, runClients] of this.workflowSseClientsByRunId.entries()) {
            for (const client of runClients) {
                try { client.end(); } catch { /* ignore */ }
            }
        }
        this.workflowSseClientsByRunId.clear();

        if (this.workflowStreaming) {
            for (const listener of this.workflowSseListenerByRunId.values()) {
                this.workflowStreaming.unsubscribe(listener);
            }
        }
        this.workflowSseListenerByRunId.clear();

        return new Promise((resolve) => {
            if (!this.server) { resolve(); return; }
            this.server.close(() => resolve());
        });
    }

    getPort(): number | null {
        const addr = this.server?.address();
        return addr && typeof addr === 'object' ? addr.port : null;
    }

    /** Push a live event to all SSE clients. */
    pushLiveEvent(event: { type: string; data: unknown }): void {
        const payload = `event: live\ndata: ${JSON.stringify(event)}\n\n`;
        for (const client of this.sseClients) {
            try { client.write(payload); } catch { /* ignore dead connections */ }
        }
    }

    private authenticate(req: http.IncomingMessage): boolean {
        const authHeader = req.headers.authorization;
        if (!authHeader) return false;
        const parts = authHeader.split(' ');
        if (parts.length !== 2 || parts[0] !== 'Bearer') return false;
        // Constant-time comparison to prevent timing attacks
        const token = parts[1];
        const a = Buffer.from(token);
        const b = Buffer.from(this.bearerToken);
        if (a.length !== b.length) return false;
        return crypto.timingSafeEqual(a, b);
    }

    private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
        const rawUrl = req.url ?? '';
        const method = req.method ?? 'GET';
        let parsedUrl: URL;
        try {
            parsedUrl = new URL(rawUrl, 'http://127.0.0.1');
        } catch {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid request URL' }));
            return;
        }
        const pathname = parsedUrl.pathname;

        if (method === 'POST' && pathname === '/api/telegram/webhook') {
            if (!this.telegramWebhook) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Telegram webhook not configured' }));
                return;
            }
            void this.handleTelegramWebhook(req, res);
            return;
        }

        const isMobileSessionRoute =
            (method === 'POST' && pathname === '/api/mobile/command')
            || (method === 'POST' && pathname === '/api/mobile/session/rotate');

        // Auth check on all non-mobile-session endpoints.
        if (!isMobileSessionRoute && !this.authenticate(req)) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Unauthorized' }));
            return;
        }

        if (method === 'GET' && pathname === '/api/status') {
            this.handleStatus(res);
            return;
        }

        const isMutating = !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());
        if (isMutating && this.getPolicyGateStatus) {
            const gate = this.getPolicyGateStatus();
            if (!gate.ok) {
                res.writeHead(503, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    error: 'Policy gate blocked mutating request',
                    code: 'policy_gate_blocked',
                    reason: gate.reason ?? 'policy_gate_failed',
                    message: gate.message,
                }));
                return;
            }
        }

        // Route
        if (method === 'GET' && pathname === '/api/events') {
            this.handleSSE(req, res);
        } else if (method === 'GET' && pathname === '/api/workflows/events') {
            this.handleWorkflowEventsSSE(req, res, parsedUrl.searchParams.get('runId'));
        } else if (pathname.startsWith('/api/workflows/')) {
            void this.handleWorkflowApiRequest(method, pathname, req, res);
        } else if (method === 'GET' && pathname === '/api/sessions/live') {
            void this.handleGetSessions(res);
        } else if (method === 'GET' && pathname === '/api/permissions/pending') {
            this.handleGetPendingPermissions(res);
        } else if (method === 'POST' && pathname.match(/^\/api\/permissions\/[^/]+\/approve$/)) {
            const callbackId = pathname.split('/')[3];
            void this.handlePermissionAction(callbackId, true, req, res);
        } else if (method === 'POST' && pathname.match(/^\/api\/permissions\/[^/]+\/deny$/)) {
            const callbackId = pathname.split('/')[3];
            void this.handlePermissionAction(callbackId, false, req, res);
        } else if (method === 'POST' && pathname === '/api/mobile/pair/initiate') {
            void this.handleMobilePairInitiate(req, res);
        } else if (method === 'POST' && pathname === '/api/mobile/pair/complete') {
            void this.handleMobilePairComplete(req, res);
        } else if (method === 'GET' && pathname.match(/^\/api\/mobile\/pair\/[^/]+$/)) {
            this.handleMobilePairStatus(decodeURIComponent(pathname.split('/')[4] ?? ''), res);
        } else if (method === 'POST' && pathname.match(/^\/api\/mobile\/pair\/[^/]+\/revoke$/)) {
            this.handleMobilePairRevoke(decodeURIComponent(pathname.split('/')[4] ?? ''), res);
        } else if (method === 'POST' && pathname === '/api/mobile/command') {
            void this.handleMobileCommand(req, res);
        } else if (method === 'POST' && pathname === '/api/mobile/session/rotate') {
            this.handleMobileSessionRotate(req, res);
        } else if (method === 'POST' && pathname.match(/^\/api\/lifecycle\/[^/]+$/)) {
            const rawAction = decodeURIComponent(pathname.split('/')[3] ?? '');
            const action = this.parseLifecycleAction(rawAction);
            if (!action) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Not found' }));
                return;
            }
            void this.handleLifecycleActionRequest(action, req, res);
        } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Not found' }));
        }
    }

    private async handleWorkflowApiRequest(
        method: string,
        pathname: string,
        req: http.IncomingMessage,
        res: http.ServerResponse,
    ): Promise<void> {
        const handled = await handleWorkflowHttpRoute({
            method,
            pathname,
            req,
            res,
            handlers: this.workflowApi,
            readJsonBody: (request, maxBytes) => this.readJsonBody(request, maxBytes),
        });

        if (handled) {
            return;
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
    }

    private handleStatus(res: http.ServerResponse): void {
        if (!this.getStatus) {
            res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            res.end(JSON.stringify({
                contractVersion: 'gateway_http_status_v1',
                deterministic: true,
                ok: true,
                status: 'ready',
                checkedAt: new Date().toISOString(),
            }));
            return;
        }

        try {
            const status = this.getStatus();
            const ready = status?.readiness?.state === 'ready';
            res.writeHead(ready ? 200 : 503, {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-store',
            });
            res.end(JSON.stringify(status));
        } catch (error) {
            const code = typeof error === 'object' && error && 'code' in error && typeof (error as { code?: unknown }).code === 'string'
                ? (error as { code: string }).code
                : 'messaging_gateway_status_invalid';
            const reason = code === 'messaging_gateway_status_missing'
                ? 'gateway_status_missing'
                : 'gateway_status_invalid';
            const message = error instanceof Error ? error.message : String(error);

            res.writeHead(503, {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-store',
            });
            res.end(JSON.stringify({
                error: 'Gateway readiness unavailable',
                code: 'gateway_status_unavailable',
                reason,
                message,
                deterministic: true,
                checkedAt: new Date().toISOString(),
            }));
        }
    }

    private sendLifecyclePayloadValidationError(
        res: http.ServerResponse,
        action: LifecycleAction,
        failure: { code: string; reason: string },
    ): void {
        res.writeHead(400, this.getLifecycleResponseHeaders());
        res.end(JSON.stringify({
            error: 'Invalid lifecycle payload',
            code: failure.code,
            action,
            reason: failure.reason,
        }));
    }

    private getLifecycleResponseHeaders(): Record<string, string> {
        return {
            'Content-Type': 'application/json',
            ...LIFECYCLE_COMPATIBILITY_RESPONSE_HEADERS,
        };
    }

    private evaluateLifecycleCompatibility(req: http.IncomingMessage): LifecycleCompatibilityResult {
        const expectedContractVersion = normalizeLifecycleCompatibilityToken(LIFECYCLE_MIXED_VERSION_COMPATIBILITY_CONTRACT_VERSION);
        const expectedCapability = normalizeLifecycleCompatibilityToken(LIFECYCLE_MIXED_VERSION_COMPATIBILITY_CAPABILITY);
        const receivedContractVersion = normalizeLifecycleCompatibilityToken(req.headers[LIFECYCLE_COMPATIBILITY_HEADER_CONTRACT_VERSION]);
        const receivedCapability = normalizeLifecycleCompatibilityToken(req.headers[LIFECYCLE_COMPATIBILITY_HEADER_CAPABILITY]);

        if (!receivedContractVersion) {
            return {
                compatible: false,
                reason: 'client_contract_version_missing',
                receivedContractVersion: null,
                receivedCapability: receivedCapability || null,
            };
        }

        if (receivedContractVersion !== expectedContractVersion) {
            return {
                compatible: false,
                reason: 'client_contract_version_unsupported',
                receivedContractVersion,
                receivedCapability: receivedCapability || null,
            };
        }

        if (!receivedCapability) {
            return {
                compatible: false,
                reason: 'client_capability_missing',
                receivedContractVersion,
                receivedCapability: null,
            };
        }

        if (receivedCapability !== expectedCapability) {
            return {
                compatible: false,
                reason: 'client_capability_unsupported',
                receivedContractVersion,
                receivedCapability,
            };
        }

        return {
            compatible: true,
            reason: 'compatibility_supported',
            receivedContractVersion,
            receivedCapability,
        };
    }

    private buildLifecycleCompatibilityUnsupportedBody(action: LifecycleAction, compatibility: LifecycleCompatibilityResult): Record<string, unknown> {
        return {
            error: 'Lifecycle compatibility unsupported',
            code: 'lifecycle_compatibility_unsupported',
            action,
            reason: compatibility.reason,
            deterministic: true,
            unsupported: {
                marker: 'unsupported',
                direction: 'old_client_new_tracker',
                expected: {
                    contractVersion: LIFECYCLE_MIXED_VERSION_COMPATIBILITY_CONTRACT_VERSION,
                    capability: LIFECYCLE_MIXED_VERSION_COMPATIBILITY_CAPABILITY,
                },
                received: {
                    contractVersion: compatibility.receivedContractVersion,
                    capability: compatibility.receivedCapability,
                },
            },
            compatibility: {
                contractVersion: LIFECYCLE_MIXED_VERSION_COMPATIBILITY_CONTRACT_VERSION,
                capability: LIFECYCLE_MIXED_VERSION_COMPATIBILITY_CAPABILITY,
                direction: 'old_client_new_tracker',
            },
        };
    }

    private parseLifecycleAction(input: string): LifecycleAction | null {
        if (LIFECYCLE_ACTION_SET.has(input as LifecycleAction)) {
            return input as LifecycleAction;
        }
        return null;
    }

    private writeSseHeaders(res: http.ServerResponse): void {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
        });
    }

    private sendSseEvent(res: http.ServerResponse, eventName: string, payload: unknown): void {
        res.write(`event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`);
    }

    private isValidRunId(runId: string): boolean {
        return /^[a-zA-Z0-9_-]{1,128}$/.test(runId);
    }

    private handleSSE(req: http.IncomingMessage, res: http.ServerResponse): void {
        this.writeSseHeaders(res);
        this.sendSseEvent(res, 'connected', {});
        this.sseClients.add(res);

        req.on('close', () => {
            this.sseClients.delete(res);
        });
    }

    private handleWorkflowEventsSSE(req: http.IncomingMessage, res: http.ServerResponse, rawRunId: string | null): void {
        if (!this.workflowStreaming) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Not found' }));
            return;
        }

        const runId = (rawRunId ?? '').trim();
        if (!this.isValidRunId(runId)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing or invalid runId' }));
            return;
        }

        let clientsForRun = this.workflowSseClientsByRunId.get(runId);
        if (!clientsForRun) {
            clientsForRun = new Set<http.ServerResponse>();
            this.workflowSseClientsByRunId.set(runId, clientsForRun);
        }

        if (clientsForRun.size >= 10) {
            res.writeHead(429, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Too many workflow stream clients for runId' }));
            return;
        }

        this.writeSseHeaders(res);
        this.sendSseEvent(res, 'connected', { runId });

        const backlog = this.workflowStreaming.getBacklogSnapshot(runId);
        if (backlog.droppedCount > 0) {
            this.sendSseEvent(res, 'reconnect-hint', { runId, droppedCount: backlog.droppedCount });
        }
        for (const event of backlog.events) {
            this.sendSseEvent(res, 'workflow', event);
        }

        if (!this.workflowSseListenerByRunId.has(runId)) {
            const listener: WorkflowStreamListener = (event: WorkflowStreamEvent) => {
                if (event.runId !== runId) return;

                const activeClients = this.workflowSseClientsByRunId.get(runId);
                if (!activeClients || activeClients.size === 0) return;

                for (const client of activeClients) {
                    try {
                        this.sendSseEvent(client, 'workflow', event);
                    } catch {
                        // Ignore dead sockets. Close handlers remove them from maps.
                    }
                }
            };

            this.workflowSseListenerByRunId.set(runId, listener);
            this.workflowStreaming.subscribe(listener);
        }

        clientsForRun.add(res);

        req.on('close', () => {
            this.removeWorkflowSseClient(runId, res);
        });
    }

    private removeWorkflowSseClient(runId: string, client: http.ServerResponse): void {
        const clientsForRun = this.workflowSseClientsByRunId.get(runId);
        if (!clientsForRun) return;

        clientsForRun.delete(client);
        if (clientsForRun.size > 0) {
            return;
        }

        this.workflowSseClientsByRunId.delete(runId);

        const listener = this.workflowSseListenerByRunId.get(runId);
        if (!listener || !this.workflowStreaming) {
            return;
        }

        this.workflowSseListenerByRunId.delete(runId);
        this.workflowStreaming.unsubscribe(listener);
    }

    private async handleGetSessions(res: http.ServerResponse): Promise<void> {
        try {
            const sessions = await this.getSessions();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(sessions));
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: message }));
        }
    }

    private handleGetPendingPermissions(res: http.ServerResponse): void {
        const pending = this.getPendingPermissions();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ permissions: pending }));
    }

    private async handlePermissionAction(
        callbackId: string,
        approved: boolean,
        req: http.IncomingMessage,
        res: http.ServerResponse,
    ): Promise<void> {
        if (!callbackId || callbackId.trim().length === 0) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing callbackId' }));
            return;
        }

        // Validate callbackId format (prevent path traversal / injection)
        if (!/^[a-zA-Z0-9_-]{1,128}$/.test(callbackId)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid callbackId format' }));
            return;
        }

        try {
            const resolvedBy = 'copilot-ui';
            if (approved) {
                await this.approvePermission(callbackId, resolvedBy);
            } else {
                await this.denyPermission(callbackId, resolvedBy);
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, callbackId, approved }));
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: message }));
        }
    }

    private ensureMobilePairingEnabled(res: http.ServerResponse): boolean {
        if (this.mobilePairingEnabled) {
            return true;
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Mobile pairing not configured' }));
        return false;
    }

    private readMobileSessionToken(req: http.IncomingMessage): string {
        return this.readSingleHeaderValue(req.headers['x-mobile-session-token']);
    }

    private validateMobileSessionRequest(
        req: http.IncomingMessage,
        res: http.ServerResponse,
    ): { sessionId: string; leaseId?: string } | null {
        if (!this.ensureMobilePairingEnabled(res)) {
            return null;
        }

        const sessionToken = this.readMobileSessionToken(req);
        const validation = validateMobileSession(sessionToken);
        if (!validation.valid || !validation.sessionId) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                error: 'Invalid or expired session',
                reason: validation.reason ?? 'invalid_token',
            }));
            return null;
        }

        return {
            sessionId: validation.sessionId,
            leaseId: validation.leaseId,
        };
    }

    private async handleMobilePairInitiate(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        if (!this.ensureMobilePairingEnabled(res)) {
            return;
        }

        let payload: unknown;
        try {
            payload = await this.readJsonBody(req);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: message }));
            return;
        }

        try {
            const ttlMs = typeof payload === 'object' && payload !== null && typeof (payload as { ttlMs?: unknown }).ttlMs === 'number'
                ? (payload as { ttlMs: number }).ttlMs
                : undefined;
            const lease = issueMobilePairingLease(ttlMs === undefined ? undefined : { ttlMs });
            res.writeHead(201, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, ...lease }));
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: message }));
        }
    }

    private async handleMobilePairComplete(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        if (!this.ensureMobilePairingEnabled(res)) {
            return;
        }

        let payload: unknown;
        try {
            payload = await this.readJsonBody(req);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: message }));
            return;
        }

        const pairingToken = typeof payload === 'object' && payload !== null && typeof (payload as { pairingToken?: unknown }).pairingToken === 'string'
            ? (payload as { pairingToken: string }).pairingToken.trim()
            : '';
        if (!pairingToken) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing pairingToken' }));
            return;
        }

        const leaseId = resolveMobilePairingLease(pairingToken);
        if (!leaseId) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid or expired pairingToken' }));
            return;
        }

        const session = issueMobileSession(leaseId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, ...session }));
    }

    private handleMobilePairStatus(leaseId: string, res: http.ServerResponse): void {
        if (!this.ensureMobilePairingEnabled(res)) {
            return;
        }

        const status = getMobilePairingLeaseStatus(leaseId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(status));
    }

    private handleMobilePairRevoke(leaseId: string, res: http.ServerResponse): void {
        if (!this.ensureMobilePairingEnabled(res)) {
            return;
        }

        if (!revokeMobilePairingLease(leaseId)) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Lease not found' }));
            return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, leaseId }));
    }

    private async handleMobileCommand(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        const session = this.validateMobileSessionRequest(req, res);
        if (!session) {
            return;
        }

        let payload: unknown;
        try {
            payload = await this.readJsonBody(req);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: message }));
            return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, sessionId: session.sessionId, leaseId: session.leaseId, command: payload }));
    }

    private handleMobileSessionRotate(req: http.IncomingMessage, res: http.ServerResponse): void {
        const session = this.validateMobileSessionRequest(req, res);
        if (!session) {
            return;
        }

        const rotated = rotateMobileSession(session.sessionId);
        if (!rotated) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid or expired session' }));
            return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, ...rotated }));
    }

    private async readJsonBody(req: http.IncomingMessage, maxBytes = 128 * 1024): Promise<unknown> {
        return new Promise((resolve, reject) => {
            let size = 0;
            let tooLarge = false;
            const chunks: Buffer[] = [];
            req.on('data', (chunk: Buffer) => {
                if (tooLarge) return;
                size += chunk.length;
                if (size > maxBytes) {
                    tooLarge = true;
                    reject(new Error('Request body too large'));
                    return;
                }
                chunks.push(chunk);
            });
            req.on('end', () => {
                if (tooLarge) return;
                if (chunks.length === 0) {
                    resolve({});
                    return;
                }
                const raw = Buffer.concat(chunks).toString('utf8');
                try {
                    resolve(JSON.parse(raw));
                } catch {
                    reject(new Error('Invalid JSON body'));
                }
            });
            req.on('error', reject);
        });
    }

    private readSingleHeaderValue(value: string | string[] | undefined): string {
        if (Array.isArray(value)) return this.readSingleHeaderValue(value.length > 0 ? value[0] : '');
        return typeof value === 'string' ? value.trim() : '';
    }

    private compareSecretToken(received: string, expected: string): boolean {
        const a = Buffer.from(received);
        const b = Buffer.from(expected);
        if (a.length !== b.length) return false;
        return crypto.timingSafeEqual(a, b);
    }

    private pruneTelegramDedupeMap(nowMs: number, ttlMs: number): void {
        const cutoff = nowMs - ttlMs;
        for (const [updateId, seenAt] of this.telegramSeenUpdateIds.entries()) {
            if (seenAt < cutoff) this.telegramSeenUpdateIds.delete(updateId);
        }
    }

    private async handleTelegramWebhook(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        const webhook = this.telegramWebhook;
        if (!webhook) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Telegram webhook not configured' }));
            return;
        }

        const receivedSecret = this.readSingleHeaderValue(req.headers['x-telegram-bot-api-secret-token']);
        const expectedSecret = webhook.secretToken.trim();
        if (!receivedSecret || !this.compareSecretToken(receivedSecret, expectedSecret)) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Forbidden' }));
            return;
        }

        let payload: unknown;
        try {
            payload = await this.readJsonBody(req, webhook.maxBodyBytes ?? 64 * 1024);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (message === 'Request body too large') {
                res.writeHead(413, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Payload too large' }));
                return;
            }
            if (message === 'Invalid JSON body') {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid JSON' }));
                return;
            }
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid request body' }));
            return;
        }

        const updateId =
            typeof payload === 'object' && payload !== null && typeof (payload as { update_id?: unknown }).update_id === 'number'
                ? (payload as { update_id: number }).update_id
                : undefined;

        if (typeof updateId === 'number') {
            const nowMs = Date.now();
            const dedupeTtlMs = webhook.dedupeTtlMs ?? 10 * 60 * 1000;
            this.pruneTelegramDedupeMap(nowMs, dedupeTtlMs);

            if (this.telegramSeenUpdateIds.has(updateId)) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true, deduplicated: true }));
                return;
            }

            this.telegramSeenUpdateIds.set(updateId, nowMs);
        }

        try {
            await webhook.onUpdate(payload);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
        } catch (err) {
            console.error('[GatewayHttp] Telegram webhook update handler failed:', err);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, dropped: true, reason: 'handler_error' }));
        }
    }

    private async handleLifecycleActionRequest(
        action: LifecycleAction,
        req: http.IncomingMessage,
        res: http.ServerResponse,
    ): Promise<void> {
        const compatibility = this.evaluateLifecycleCompatibility(req);
        if (!compatibility.compatible) {
            res.writeHead(501, this.getLifecycleResponseHeaders());
            res.end(JSON.stringify(this.buildLifecycleCompatibilityUnsupportedBody(action, compatibility)));
            return;
        }

        const authz = this.authorizeLifecycleAction(action, req);
        if (!authz.allowed) {
            res.writeHead(403, this.getLifecycleResponseHeaders());
            res.end(JSON.stringify({
                error: 'Forbidden',
                code: 'action_not_allowed',
                action,
                reason: authz.reason ?? 'forbidden',
            }));
            return;
        }

        if (!this.handleLifecycleAction) {
            res.writeHead(501, this.getLifecycleResponseHeaders());
            res.end(JSON.stringify({
                error: 'Not implemented',
                code: 'lifecycle_not_implemented',
                action,
            }));
            return;
        }

        let payload: unknown;
        try {
            payload = await this.readJsonBody(req);
        } catch (err) {
            res.writeHead(400, this.getLifecycleResponseHeaders());
            res.end(JSON.stringify({
                error: err instanceof Error ? err.message : 'Invalid request body',
                code: 'invalid_json',
                action,
            }));
            return;
        }

        if (action === 'open-terminal') {
            const validation = validateOpenTerminalPayload(payload);
            if (!validation.ok) {
                this.sendLifecyclePayloadValidationError(res, action, validation.error);
                return;
            }
            payload = validation.value;
        }

        try {
            const result = await this.handleLifecycleAction(action, payload, req);
            res.writeHead(200, this.getLifecycleResponseHeaders());
            res.end(JSON.stringify({ ok: true, action, result }));
        } catch (err) {
            if (isLifecyclePayloadValidationError(err)) {
                this.sendLifecyclePayloadValidationError(res, action, {
                    code: err.code,
                    reason: err.reason,
                });
                return;
            }
            const message = err instanceof Error ? err.message : String(err);
            res.writeHead(500, this.getLifecycleResponseHeaders());
            res.end(JSON.stringify({ error: message, code: 'lifecycle_action_failed', action }));
        }
    }

    private startHeartbeat(): void {
        this.heartbeatTimer = setInterval(() => {
            const heartbeat = `:heartbeat ${new Date().toISOString()}\n\n`;
            for (const client of this.sseClients) {
                try { client.write(heartbeat); } catch { /* ignore */ }
            }
            for (const runClients of this.workflowSseClientsByRunId.values()) {
                for (const client of runClients) {
                    try { client.write(heartbeat); } catch { /* ignore */ }
                }
            }
        }, 15_000);
    }

    private stopHeartbeat(): void {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }
}
