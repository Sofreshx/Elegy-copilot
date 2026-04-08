import crypto from 'crypto';
import http from 'http';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 4111;
const MAX_TRIGGER_HISTORY = 200;
const CONTRACT_VERSION = 'local_workflow_sidecar_v1';
const RUNTIME_BINDING_MISSING_REASON = 'workflow_runtime_binding_missing';

interface TriggerEnvelope {
  contractVersion: string;
  triggerId: string;
  eventType: string;
  at: string;
  source: string;
  context?: Record<string, unknown>;
  data?: Record<string, unknown> | null;
}

interface CapturedTrigger extends TriggerEnvelope {
  capturedAt: string;
}

interface WorkflowRuntimeBindingStatus {
  present: boolean;
  verified: boolean;
  reason: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return normalized === '127.0.0.1' || normalized === 'localhost' || normalized === '::1';
}

function writeJson(res: http.ServerResponse, statusCode: number, body: unknown): void {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

function readJsonBody(req: http.IncomingMessage, maxBytes = 256 * 1024): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > maxBytes) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(buffer);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function validateTriggerEnvelope(input: unknown): TriggerEnvelope {
  if (!isRecord(input)) {
    throw Object.assign(new Error('Invalid workflow trigger payload'), { statusCode: 400 });
  }

  const triggerId = asTrimmedString(input.triggerId);
  const eventType = asTrimmedString(input.eventType);
  const at = asTrimmedString(input.at);
  const source = asTrimmedString(input.source) || 'executor';
  if (!triggerId || !eventType || !at) {
    throw Object.assign(new Error('workflow trigger payload requires triggerId, eventType, and at'), { statusCode: 400 });
  }

  return {
    contractVersion: asTrimmedString(input.contractVersion) || 'local_workflow_trigger_v1',
    triggerId,
    eventType,
    at,
    source,
    context: isRecord(input.context) ? input.context : undefined,
    data: isRecord(input.data) ? input.data : null,
  };
}

export class WorkflowSidecarServer {
  private readonly host: string;
  private readonly port: number;
  private readonly bearerToken: string;
  private server: http.Server | null = null;
  private readonly triggerHistory: CapturedTrigger[] = [];

  constructor() {
    this.host = asTrimmedString(process.env.INSTRUCTION_ENGINE_WORKFLOW_SIDECAR_HOST) || DEFAULT_HOST;
    this.port = Number.parseInt(asTrimmedString(process.env.INSTRUCTION_ENGINE_WORKFLOW_SIDECAR_PORT) || String(DEFAULT_PORT), 10);
    this.bearerToken = asTrimmedString(process.env.INSTRUCTION_ENGINE_WORKFLOW_SIDECAR_TOKEN);

    if (!isLoopbackHost(this.host)) {
      throw new Error(`[workflow-sidecar] host must stay loopback-only: ${this.host}`);
    }
    if (!Number.isInteger(this.port) || this.port < 1 || this.port > 65535) {
      throw new Error(`[workflow-sidecar] invalid port: ${this.port}`);
    }
    if (!this.bearerToken) {
      throw new Error('[workflow-sidecar] bearer token is required');
    }
  }

  async start(): Promise<void> {
    if (this.server) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        void this.handleRequest(req, res);
      });
      this.server.once('error', reject);
      this.server.listen(this.port, this.host, () => {
        console.log(`[workflow-sidecar] listening on http://${this.host}:${this.port}`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    const activeServer = this.server;
    this.server = null;
    if (!activeServer) {
      return;
    }
    await new Promise<void>((resolve) => activeServer.close(() => resolve()));
  }

  private authenticate(req: http.IncomingMessage): boolean {
    const authHeader = req.headers.authorization;
    if (!authHeader) return false;
    const [scheme, token] = authHeader.split(' ');
    if (scheme !== 'Bearer' || !token) return false;
    const a = Buffer.from(token);
    const b = Buffer.from(this.bearerToken);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }

  private getRuntimeBindingStatus(): WorkflowRuntimeBindingStatus {
    return {
      present: false,
      verified: false,
      reason: RUNTIME_BINDING_MISSING_REASON,
    };
  }

  private getStatus() {
    const latest = this.triggerHistory[this.triggerHistory.length - 1] || null;
    const runtimeBinding = this.getRuntimeBindingStatus();
    return {
      contractVersion: CONTRACT_VERSION,
      preferredRuntime: 'n8n',
      runtime: 'contract-only',
      state: 'unavailable',
      ready: false,
      loopbackOnly: true,
      auth: 'bearer',
      host: this.host,
      port: this.port,
      triggerPath: '/api/triggers',
      healthPath: '/api/status',
      runtimeBinding,
      lastError: 'Workflow sidecar runtime binding is unavailable.',
      capturedTriggerCount: this.triggerHistory.length,
      lastTriggerAt: latest ? latest.capturedAt : null,
      lastTriggerId: latest ? latest.triggerId : null,
    };
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const method = req.method || 'GET';
    const pathname = new URL(req.url || '/', 'http://127.0.0.1').pathname;

    if (!this.authenticate(req)) {
      writeJson(res, 401, { error: 'Unauthorized' });
      return;
    }

    if (method === 'GET' && pathname === '/api/status') {
      writeJson(res, 200, this.getStatus());
      return;
    }

    if (method === 'POST' && pathname === '/api/triggers') {
      const runtimeBinding = this.getRuntimeBindingStatus();
      if (!runtimeBinding.verified) {
        writeJson(res, 503, {
          ok: false,
          accepted: false,
          error: 'Workflow sidecar runtime binding is unavailable.',
          code: runtimeBinding.reason,
        });
        return;
      }
      try {
        const payload = validateTriggerEnvelope(await readJsonBody(req));
        this.triggerHistory.push({
          ...payload,
          capturedAt: new Date().toISOString(),
        });
        if (this.triggerHistory.length > MAX_TRIGGER_HISTORY) {
          this.triggerHistory.splice(0, this.triggerHistory.length - MAX_TRIGGER_HISTORY);
        }
        writeJson(res, 202, {
          ok: true,
          accepted: true,
          captureMode: 'contract-only',
          triggerId: payload.triggerId,
          capturedTriggerCount: this.triggerHistory.length,
        });
      } catch (error) {
        const statusCode = Number((error as { statusCode?: unknown })?.statusCode) || 400;
        writeJson(res, statusCode, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    writeJson(res, 404, { error: 'Not found' });
  }
}

export async function main(): Promise<void> {
  const server = new WorkflowSidecarServer();
  await server.start();

  const shutdown = async () => {
    await server.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => {
    void shutdown();
  });
  process.on('SIGTERM', () => {
    void shutdown();
  });
}

if (require.main === module) {
  void main().catch((error) => {
    console.error('[workflow-sidecar] startup failed', error);
    process.exit(1);
  });
}
