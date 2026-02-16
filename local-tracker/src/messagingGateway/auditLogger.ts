import fs from 'fs';
import path from 'path';
import { sanitizeOutboundText } from './sanitizer';

export type AuditLogRecord = Record<string, unknown>;

export interface AuditLoggerOptions {
	workspaceRoot: string;
	maxFileBytes?: number;
	fileName?: string;
	now?: () => Date;
	maxStringLength?: number;
}

const DEFAULT_MAX_FILE_BYTES = 10 * 1024 * 1024;
const DEFAULT_FILE_NAME = 'remote-audit.jsonl';

function ensureDirExists(dirPath: string): void {
	fs.mkdirSync(dirPath, { recursive: true });
}

function isoCompact(date: Date): string {
	const pad2 = (n: number) => String(n).padStart(2, '0');
	return (
		`${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}-` +
		`${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function looksSensitiveKey(key: string): boolean {
	return /(token|jwt|secret|password|authorization|cookie|api[_-]?key|apikey|refresh[_-]?token|access[_-]?token)/i.test(key);
}

function capString(text: string, maxLength: number): string {
	if (text.length <= maxLength) return text;
	if (maxLength <= 0) return '';
	const marker = '…(truncated)';
	const allowed = Math.max(0, maxLength - marker.length);
	return `${text.slice(0, allowed).trimEnd()}${marker}`.slice(0, maxLength);
}

function sanitizeAuditValue(value: unknown, maxStringLength: number, seen: WeakSet<object>): unknown {
	if (value === null) return null;
	if (value === undefined) return undefined;

	if (typeof value === 'string') {
		return capString(sanitizeOutboundText(value), maxStringLength);
	}
	if (typeof value === 'number' || typeof value === 'boolean') return value;
	if (typeof value === 'bigint') return value.toString();
	if (typeof value === 'symbol') return String(value);
	if (typeof value === 'function') return '[Function]';

	if (Array.isArray(value)) {
		return value.map((v) => sanitizeAuditValue(v, maxStringLength, seen));
	}

	if (isRecord(value)) {
		if (seen.has(value)) return '[Circular]';
		seen.add(value);

		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value)) {
			if (looksSensitiveKey(k)) {
				out[k] = '[REDACTED]';
				continue;
			}
			out[k] = sanitizeAuditValue(v, maxStringLength, seen);
		}
		return out;
	}

	return sanitizeOutboundText(String(value));
}

function safeJsonlStringify(record: AuditLogRecord, maxStringLength: number): string {
	const seen = new WeakSet<object>();
	const sanitized = sanitizeAuditValue(record, maxStringLength, seen);
	// sanitizeAuditValue returns unknown; ensure it's an object for JSONL.
	const asObject: Record<string, unknown> = isRecord(sanitized) ? sanitized : { value: sanitized };
	return JSON.stringify(asObject);
}

export function getAuditLogFilePath(workspaceRoot: string, fileName: string = DEFAULT_FILE_NAME): string {
	return path.join(path.resolve(workspaceRoot), '.instructions-output', fileName);
}

export class AuditLogger {
	private readonly workspaceRoot: string;
	private readonly maxFileBytes: number;
	private readonly fileName: string;
	private readonly now: () => Date;
	private readonly maxStringLength: number;

	constructor(options: AuditLoggerOptions) {
		this.workspaceRoot = path.resolve(options.workspaceRoot);
		this.maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
		this.fileName = options.fileName ?? DEFAULT_FILE_NAME;
		this.now = options.now ?? (() => new Date());
		this.maxStringLength = options.maxStringLength ?? 2000;
	}

	log(record: AuditLogRecord): void {
		const ts = this.now().toISOString();
		const enriched: AuditLogRecord = {
			ts,
			...record,
		};

		const logFilePath = getAuditLogFilePath(this.workspaceRoot, this.fileName);
		const dir = path.dirname(logFilePath);
		ensureDirExists(dir);

		this.rotateIfNeeded(logFilePath);

		const line = safeJsonlStringify(enriched, this.maxStringLength);
		fs.appendFileSync(logFilePath, `${line}\n`, { encoding: 'utf8' });
	}

	private rotateIfNeeded(logFilePath: string): void {
		try {
			if (!fs.existsSync(logFilePath)) return;
			const st = fs.statSync(logFilePath);
			if (st.size < this.maxFileBytes) return;

			const rotatedName = `remote-audit.${isoCompact(this.now())}.jsonl`;
			const rotatedPath = path.join(path.dirname(logFilePath), rotatedName);
			fs.renameSync(logFilePath, rotatedPath);
		} catch {
			// Fail closed: if rotation fails, still attempt to log to the primary file.
		}
	}
}
