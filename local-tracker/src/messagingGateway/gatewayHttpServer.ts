import crypto from 'crypto';
import http from 'http';

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
        } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Not found' }));
        }
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
