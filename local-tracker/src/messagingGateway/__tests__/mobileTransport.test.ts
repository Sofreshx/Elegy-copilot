import {
    normalizeRequest,
    buildSuccessResponse,
    buildErrorResponse,
    MobileTransportError,
    RPC_ERROR,
    MOBILE_TRANSPORT_CONTRACT_VERSION,
} from '../mobileTransport';

describe('MOBILE_TRANSPORT_CONTRACT_VERSION', () => {
    it('is defined', () => {
        expect(MOBILE_TRANSPORT_CONTRACT_VERSION).toBe('1');
    });
});

describe('normalizeRequest', () => {
    it('parses canonical JSON-RPC 2.0 request with params', () => {
        const raw = { jsonrpc: '2.0', id: 1, method: 'ping', params: { foo: 'bar' } };
        const result = normalizeRequest(raw);
        expect(result).toEqual({ jsonrpc: '2.0', id: 1, method: 'ping', params: { foo: 'bar' } });
    });

    it('parses canonical JSON-RPC 2.0 request without params', () => {
        const raw = { jsonrpc: '2.0', id: 'abc', method: 'health' };
        const result = normalizeRequest(raw);
        expect(result).toEqual({ jsonrpc: '2.0', id: 'abc', method: 'health', params: undefined });
    });

    it('throws on missing method in canonical format', () => {
        expect(() => normalizeRequest({ jsonrpc: '2.0', id: 1 }))
            .toThrow(MobileTransportError);
        expect(() => normalizeRequest({ jsonrpc: '2.0', id: 1 }))
            .toThrow('missing method');
    });

    it('throws on empty string method in canonical format', () => {
        expect(() => normalizeRequest({ jsonrpc: '2.0', id: 1, method: '' }))
            .toThrow('missing method');
    });

    it('throws on missing id in canonical format', () => {
        expect(() => normalizeRequest({ jsonrpc: '2.0', method: 'ping' }))
            .toThrow('missing id');
    });

    it('throws on null id in canonical format', () => {
        expect(() => normalizeRequest({ jsonrpc: '2.0', id: null, method: 'ping' }))
            .toThrow('missing id');
    });

    it('parses legacy format with id', () => {
        const raw = { type: 'request', payload: { method: 'doStuff', params: { a: 1 }, id: 42 } };
        const result = normalizeRequest(raw);
        expect(result).toEqual({ jsonrpc: '2.0', id: 42, method: 'doStuff', params: { a: 1 } });
    });

    it('parses legacy format without id (generates one)', () => {
        const raw = { type: 'request', payload: { method: 'doStuff' } };
        const result = normalizeRequest(raw);
        expect(result.jsonrpc).toBe('2.0');
        expect(result.method).toBe('doStuff');
        expect(typeof result.id).toBe('string');
        expect((result.id as string).startsWith('legacy-')).toBe(true);
    });

    it('parses legacy format without params', () => {
        const raw = { type: 'request', payload: { method: 'noop', id: 'x' } };
        const result = normalizeRequest(raw);
        expect(result.params).toBeUndefined();
    });

    it('throws on legacy format with missing method', () => {
        expect(() => normalizeRequest({ type: 'request', payload: { id: 1 } }))
            .toThrow('missing method in payload');
    });

    it('throws on null input', () => {
        expect(() => normalizeRequest(null)).toThrow('must be an object');
    });

    it('throws on string input', () => {
        expect(() => normalizeRequest('hello')).toThrow('must be an object');
    });

    it('throws on unrecognized format', () => {
        expect(() => normalizeRequest({ type: 'something' }))
            .toThrow('Unrecognized request format');
    });
});

describe('buildSuccessResponse', () => {
    it('returns correct envelope', () => {
        expect(buildSuccessResponse(1, 'ok')).toEqual({
            jsonrpc: '2.0', id: 1, result: 'ok',
        });
    });

    it('handles object result', () => {
        const result = buildSuccessResponse('req-1', { data: [1, 2, 3] });
        expect(result.result).toEqual({ data: [1, 2, 3] });
    });

    it('handles null result', () => {
        expect(buildSuccessResponse(99, null).result).toBeNull();
    });
});

describe('buildErrorResponse', () => {
    it('returns correct error envelope', () => {
        const resp = buildErrorResponse(1, RPC_ERROR.INTERNAL_ERROR, 'boom');
        expect(resp).toEqual({
            jsonrpc: '2.0', id: 1,
            error: { code: -32603, message: 'boom', data: undefined },
        });
    });

    it('includes optional data field', () => {
        const resp = buildErrorResponse(2, RPC_ERROR.INVALID_PARAMS, 'bad', { field: 'x' });
        expect(resp.error).toEqual({ code: -32602, message: 'bad', data: { field: 'x' } });
    });
});

describe('RPC_ERROR', () => {
    it('has standard JSON-RPC error codes', () => {
        expect(RPC_ERROR.PARSE_ERROR).toBe(-32700);
        expect(RPC_ERROR.INVALID_REQUEST).toBe(-32600);
        expect(RPC_ERROR.METHOD_NOT_FOUND).toBe(-32601);
        expect(RPC_ERROR.INVALID_PARAMS).toBe(-32602);
        expect(RPC_ERROR.INTERNAL_ERROR).toBe(-32603);
    });
});
