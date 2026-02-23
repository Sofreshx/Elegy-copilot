import net from 'net';

export interface AcpReadinessProbeOptions {
	host: string;
	port: number;
	/** Default: 30_000 */
	timeoutMs?: number;
}

export class SandboxReadinessFailed extends Error {
	readonly host: string;
	readonly port: number;
	readonly timeoutMs: number;
	readonly attempts: number;
	readonly lastError?: unknown;

	constructor(args: { host: string; port: number; timeoutMs: number; attempts: number; lastError?: unknown }) {
		super(
			`Sandbox readiness failed: ACP JSON-RPC initialize handshake did not succeed for ${args.host}:${args.port} within ${args.timeoutMs}ms`,
		);
		this.name = 'SandboxReadinessFailed';
		this.host = args.host;
		this.port = args.port;
		this.timeoutMs = args.timeoutMs;
		this.attempts = args.attempts;
		this.lastError = args.lastError;
		// Best-effort: align with modern Error.cause without depending on TS lib config.
		try {
			(this as any).cause = args.lastError;
		} catch {
			// ignore
		}
	}
}

interface JsonRpcSuccessResponse {
	jsonrpc: '2.0';
	id: number;
	result: unknown;
}

interface JsonRpcErrorObject {
	code: number;
	message: string;
	data?: unknown;
}

interface JsonRpcErrorResponse {
	jsonrpc: '2.0';
	id: number;
	error: JsonRpcErrorObject;
}

type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function isJsonRpcResponse(value: unknown): value is JsonRpcResponse {
	if (!isRecord(value)) return false;
	if (value.jsonrpc !== '2.0') return false;
	if (typeof value.id !== 'number') return false;
	return value.result !== undefined || value.error !== undefined;
}

function assertValidOptions(options: AcpReadinessProbeOptions): void {
	if (typeof options.host !== 'string' || options.host.trim().length === 0) {
		throw new Error('[AcpReadinessProbe] Invalid host (expected non-empty string)');
	}
	if (!Number.isFinite(options.port) || !Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
		throw new Error('[AcpReadinessProbe] Invalid port (expected integer 1-65535)');
	}
	if (options.timeoutMs !== undefined) {
		const n = options.timeoutMs;
		if (!Number.isFinite(n) || n <= 0) {
			throw new Error('[AcpReadinessProbe] Invalid timeoutMs (expected > 0)');
		}
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function computeBackoffMs(attempt: number): number {
	// Exponential backoff with a small floor and a cap for fast readiness loops.
	const base = 50;
	const cap = 1_000;
	const exp = base * Math.pow(2, Math.max(0, attempt - 1));
	return Math.min(cap, Math.round(exp));
}

async function tryInitializeHandshakeOnce(args: {
	host: string;
	port: number;
	attemptTimeoutMs: number;
}): Promise<void> {
	const { host, port, attemptTimeoutMs } = args;
	const rpcId = 1;

	return await new Promise<void>((resolve, reject) => {
		let done = false;
		let recvBuffer = '';
		let timeout: NodeJS.Timeout | undefined;

		const socket = net.createConnection({ host, port });
		socket.setNoDelay(true);

		const finish = (err?: Error) => {
			if (done) return;
			done = true;
			if (timeout) clearTimeout(timeout);
			try {
				socket.end();
			} catch {
				// ignore
			}
			try {
				socket.destroy();
			} catch {
				// ignore
			}
			if (err) reject(err);
			else resolve();
		};

		timeout = setTimeout(() => {
			finish(new Error('[AcpReadinessProbe] initialize handshake timed out'));
		}, attemptTimeoutMs);

		socket.once('error', (err) => {
			finish(err);
		});

		socket.once('connect', () => {
			const request = {
				jsonrpc: '2.0',
				method: 'initialize',
				id: rpcId,
				params: {
					protocolVersion: 1,
					clientCapabilities: {},
					clientInfo: {
						name: 'instruction-engine-sandbox-readiness-probe',
						title: 'Instruction Engine Sandbox Readiness Probe',
						version: '0.1.0',
					},
				},
			};

			try {
				socket.write(`${JSON.stringify(request)}\n`, 'utf8');
			} catch (err) {
				finish(err instanceof Error ? err : new Error(String(err)));
			}
		});

		socket.on('data', (chunk: Buffer) => {
			recvBuffer += chunk.toString('utf8');
			while (true) {
				const idx = recvBuffer.indexOf('\n');
				if (idx < 0) break;
				const line = recvBuffer.slice(0, idx).trim();
				recvBuffer = recvBuffer.slice(idx + 1);
				if (!line) continue;

				let parsed: unknown;
				try {
					parsed = JSON.parse(line);
				} catch {
					finish(new Error('[AcpReadinessProbe] Received non-JSON response during initialize handshake'));
					return;
				}

				if (!isJsonRpcResponse(parsed)) continue;
				if (parsed.id !== rpcId) continue;

				if ('result' in parsed) {
					finish();
					return;
				}
				if ('error' in parsed && parsed.error) {
					finish(new Error(`[AcpReadinessProbe] initialize failed: ${parsed.error.message}`));
					return;
				}
			}
		});

		socket.once('close', () => {
			// If the socket closes before we saw a response, treat as failure.
			if (!done) finish(new Error('[AcpReadinessProbe] Connection closed before initialize response'));
		});
	});
}

/**
 * Readiness probe for Copilot CLI ACP (TCP + NDJSON JSON-RPC).
 *
 * Connects to `host:port` and performs a JSON-RPC `initialize` request.
 * Retries with backoff until success or timeout.
 */
export async function waitForAcpReadiness(options: AcpReadinessProbeOptions): Promise<void> {
	assertValidOptions(options);

	const host = options.host.trim();
	const port = options.port;
	const timeoutMs = options.timeoutMs ?? 30_000;
	const deadline = Date.now() + timeoutMs;

	let attempts = 0;
	let lastError: unknown;

	while (Date.now() < deadline) {
		attempts++;
		const remainingMs = Math.max(1, deadline - Date.now());
		const attemptTimeoutMs = Math.min(1_000, remainingMs);

		try {
			await tryInitializeHandshakeOnce({ host, port, attemptTimeoutMs });
			return;
		} catch (err) {
			lastError = err;
		}

		const remainingAfterAttempt = deadline - Date.now();
		if (remainingAfterAttempt <= 0) break;

		const backoffMs = Math.min(computeBackoffMs(attempts), remainingAfterAttempt);
		await sleep(backoffMs);
	}

	throw new SandboxReadinessFailed({ host, port, timeoutMs, attempts, lastError });
}
