/**
 * Mobile transport contract — canonical JSON-RPC 2.0 envelope
 * with a compatibility shim for legacy { type: "request", payload } format.
 */

export const MOBILE_TRANSPORT_CONTRACT_VERSION = '1';

/** Canonical JSON-RPC 2.0 request envelope */
export interface MobileRpcRequest {
    jsonrpc: '2.0';
    id: string | number;
    method: string;
    params?: Record<string, unknown>;
}

/** Canonical JSON-RPC 2.0 response envelope */
export interface MobileRpcResponse {
    jsonrpc: '2.0';
    id: string | number;
    result?: unknown;
    error?: {
        code: number;
        message: string;
        data?: unknown;
    };
}

/** Legacy request format (pre-JSON-RPC 2.0) */
interface LegacyRequest {
    type: 'request';
    payload: {
        method: string;
        params?: Record<string, unknown>;
        id?: string | number;
    };
}

/**
 * Normalize an incoming request to canonical JSON-RPC 2.0 format.
 * Handles both canonical and legacy formats.
 * Throws on unrecognized formats.
 */
export function normalizeRequest(raw: unknown): MobileRpcRequest {
    if (typeof raw !== 'object' || raw === null) {
        throw new MobileTransportError('Invalid request: must be an object');
    }

    const obj = raw as Record<string, unknown>;

    // Canonical JSON-RPC 2.0 format
    if (obj.jsonrpc === '2.0') {
        if (typeof obj.method !== 'string' || !obj.method) {
            throw new MobileTransportError('Invalid JSON-RPC request: missing method');
        }
        if (obj.id === undefined || obj.id === null) {
            throw new MobileTransportError('Invalid JSON-RPC request: missing id');
        }
        return {
            jsonrpc: '2.0',
            id: obj.id as string | number,
            method: obj.method,
            params: (typeof obj.params === 'object' && obj.params !== null)
                ? obj.params as Record<string, unknown>
                : undefined,
        };
    }

    // Legacy format: { type: "request", payload: { method, params?, id? } }
    if (obj.type === 'request' && typeof obj.payload === 'object' && obj.payload !== null) {
        const payload = obj.payload as Record<string, unknown>;
        if (typeof payload.method !== 'string' || !payload.method) {
            throw new MobileTransportError('Invalid legacy request: missing method in payload');
        }
        const id = payload.id ?? `legacy-${Date.now()}`;
        return {
            jsonrpc: '2.0',
            id: id as string | number,
            method: payload.method,
            params: (typeof payload.params === 'object' && payload.params !== null)
                ? payload.params as Record<string, unknown>
                : undefined,
        };
    }

    throw new MobileTransportError('Unrecognized request format: expected JSON-RPC 2.0 or legacy { type: "request", payload }');
}

/**
 * Build a successful JSON-RPC 2.0 response.
 */
export function buildSuccessResponse(id: string | number, result: unknown): MobileRpcResponse {
    return { jsonrpc: '2.0', id, result };
}

/**
 * Build an error JSON-RPC 2.0 response.
 */
export function buildErrorResponse(id: string | number, code: number, message: string, data?: unknown): MobileRpcResponse {
    return { jsonrpc: '2.0', id, error: { code, message, data } };
}

/** Standard JSON-RPC error codes */
export const RPC_ERROR = {
    PARSE_ERROR: -32700,
    INVALID_REQUEST: -32600,
    METHOD_NOT_FOUND: -32601,
    INVALID_PARAMS: -32602,
    INTERNAL_ERROR: -32603,
} as const;

export class MobileTransportError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'MobileTransportError';
    }
}
