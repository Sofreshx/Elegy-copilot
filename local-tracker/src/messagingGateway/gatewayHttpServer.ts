import crypto from 'crypto';
import http from 'http';

import {
    isLifecyclePayloadValidationError,
    validateOpenTerminalPayload,
} from './lifecycleOpenTerminal';

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
}

export class GatewayHttpServer {
    private server: http.Server | null = null;
    private readonly port: number;
    private readonly host: string;
    private readonly bearerToken: string;
    private readonly getSessions: () => Promise<unknown>;
    private readonly getPendingPermissions: () => unknown[];
    private readonly approvePermission: (callbackId: string, resolvedBy: string) => Promise<void>;
    private readonly denyPermission: (callbackId: string, resolvedBy: string) => Promise<void>;
    private readonly authorizeLifecycleAction: (action: LifecycleAction, req: http.IncomingMessage) => LifecycleAuthorizationResult;
    private readonly handleLifecycleAction: ((action: LifecycleAction, payload: unknown, req: http.IncomingMessage) => Promise<unknown>) | undefined;
    private readonly getPolicyGateStatus: (() => PolicyGateStatus) | undefined;

    // SSE connections
    private readonly sseClients = new Set<http.ServerResponse>();
    private heartbeatTimer: NodeJS.Timeout | null = null;

    constructor(options: GatewayHttpServerOptions) {
        this.port = options.port ?? 4100;
        this.host = options.host ?? '127.0.0.1';
        this.bearerToken = options.bearerToken;
        if (!this.bearerToken || this.bearerToken.trim().length === 0) {
            throw new Error('[GatewayHttpServer] bearerToken is required');
        }
        this.getSessions = options.getSessions;
        this.getPendingPermissions = options.getPendingPermissions;
        this.approvePermission = options.approvePermission;
        this.denyPermission = options.denyPermission;
        this.authorizeLifecycleAction = options.authorizeLifecycleAction ?? (() => ({ allowed: true }));
        this.handleLifecycleAction = options.handleLifecycleAction;
        this.getPolicyGateStatus = options.getPolicyGateStatus;
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
        const url = req.url ?? '';
        const method = req.method ?? 'GET';

        // Auth check on all endpoints
        if (!this.authenticate(req)) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Unauthorized' }));
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
        if (method === 'GET' && url === '/api/events') {
            this.handleSSE(req, res);
        } else if (method === 'GET' && url === '/api/sessions/live') {
            void this.handleGetSessions(res);
        } else if (method === 'GET' && url === '/api/permissions/pending') {
            this.handleGetPendingPermissions(res);
        } else if (method === 'POST' && url.match(/^\/api\/permissions\/[^/]+\/approve$/)) {
            const callbackId = url.split('/')[3];
            void this.handlePermissionAction(callbackId, true, req, res);
        } else if (method === 'POST' && url.match(/^\/api\/permissions\/[^/]+\/deny$/)) {
            const callbackId = url.split('/')[3];
            void this.handlePermissionAction(callbackId, false, req, res);
        } else if (method === 'POST' && url.match(/^\/api\/lifecycle\/[^/]+$/)) {
            const rawAction = decodeURIComponent(url.split('/')[3] ?? '');
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

    private handleSSE(req: http.IncomingMessage, res: http.ServerResponse): void {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
        });
        res.write('event: connected\ndata: {}\n\n');
        this.sseClients.add(res);

        req.on('close', () => {
            this.sseClients.delete(res);
        });
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

    private async readJsonBody(req: http.IncomingMessage, maxBytes = 128 * 1024): Promise<unknown> {
        return new Promise((resolve, reject) => {
            let size = 0;
            const chunks: Buffer[] = [];
            req.on('data', (chunk: Buffer) => {
                size += chunk.length;
                if (size > maxBytes) {
                    reject(new Error('Request body too large'));
                    req.destroy();
                    return;
                }
                chunks.push(chunk);
            });
            req.on('end', () => {
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
        }, 15_000);
    }

    private stopHeartbeat(): void {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }
}
