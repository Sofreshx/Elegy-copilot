import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiError } from '../apiClient';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock authService — we control getValidToken / logout without importing the real service.
const mockGetValidToken = vi.fn<[], Promise<string | null>>();
const mockLogout = vi.fn();

vi.mock('../authService', () => ({
  resolveRelayHttpUrl: () => 'https://relay.test',
  getAuthService: () => ({
    getValidToken: mockGetValidToken,
    logout: mockLogout,
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ApiClient', () => {
  let client: ApiClient;

  beforeEach(() => {
    client = new ApiClient('https://relay.test');
    mockGetValidToken.mockReset();
    mockLogout.mockReset();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // Successful requests
  // -----------------------------------------------------------------------

  it('sends GET with Authorization header and returns typed data', async () => {
    mockGetValidToken.mockResolvedValue('token-abc');
    const payload = { items: [1, 2, 3] };
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse(payload));

    const result = await client.get<{ items: number[] }>('/things');

    expect(result).toEqual(payload);

    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe('https://relay.test/things');
    expect((init?.headers as Headers).get('Authorization')).toBe('Bearer token-abc');
  });

  it('sends POST with JSON body', async () => {
    mockGetValidToken.mockResolvedValue('token-abc');
    const responsePayload = { id: '1' };
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse(responsePayload, 201));

    const result = await client.post<{ id: string }>('/items', { name: 'test' });

    expect(result).toEqual(responsePayload);

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe(JSON.stringify({ name: 'test' }));
    expect((init?.headers as Headers).get('Content-Type')).toBe('application/json');
  });

  it('sends PUT with JSON body', async () => {
    mockGetValidToken.mockResolvedValue('tok');
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({ ok: true }));

    await client.put('/items/1', { name: 'updated' });

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(init?.method).toBe('PUT');
    expect(init?.body).toBe(JSON.stringify({ name: 'updated' }));
  });

  it('sends DELETE request', async () => {
    mockGetValidToken.mockResolvedValue('tok');
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({ deleted: true }));

    const result = await client.delete<{ deleted: boolean }>('/items/1');

    expect(result).toEqual({ deleted: true });
    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(init?.method).toBe('DELETE');
  });

  it('handles 204 No Content', async () => {
    mockGetValidToken.mockResolvedValue('tok');
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(null, { status: 204 }),
    );

    const result = await client.delete('/items/1');

    expect(result).toBeUndefined();
  });

  // -----------------------------------------------------------------------
  // 401 → auto-refresh → retry
  // -----------------------------------------------------------------------

  it('retries once with fresh token on 401', async () => {
    // First call returns valid token; server responds 401
    // Second call returns refreshed token; server responds 200
    mockGetValidToken
      .mockResolvedValueOnce('old-token')
      .mockResolvedValueOnce('new-token');

    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    const result = await client.get<{ ok: boolean }>('/protected');

    expect(result).toEqual({ ok: true });
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    // Second call should use refreshed token
    const [, retryInit] = fetchSpy.mock.calls[1]!;
    expect((retryInit?.headers as Headers).get('Authorization')).toBe('Bearer new-token');
  });

  // -----------------------------------------------------------------------
  // 401 → refresh fails → logout + throw
  // -----------------------------------------------------------------------

  it('logs out and throws when refresh fails after 401', async () => {
    mockGetValidToken
      .mockResolvedValueOnce('old-token')
      .mockResolvedValueOnce(null); // refresh failed

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('Unauthorized', { status: 401 }),
    );

    const err = await client.get('/protected').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toMatch(/session expired/i);

    expect(mockLogout).toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // No token at all → throw immediately
  // -----------------------------------------------------------------------

  it('throws 401 ApiError when no token is available', async () => {
    mockGetValidToken.mockResolvedValue(null);

    const err = await client.get('/anything').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(401);
    expect((err as ApiError).message).toMatch(/authentication required/i);
  });

  // -----------------------------------------------------------------------
  // Non-401 error responses
  // -----------------------------------------------------------------------

  it('throws ApiError with parsed JSON error body', async () => {
    mockGetValidToken.mockResolvedValue('tok');
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({ error: 'not_found', message: 'Resource not found' }, 404),
    );

    const err = await client.get('/missing').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(404);
    expect((err as ApiError).message).toBe('not_found');
  });

  it('throws ApiError with JSON-RPC style nested error', async () => {
    mockGetValidToken.mockResolvedValue('tok');
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({ error: { message: 'Bad input', code: -32600, data: { field: 'name' } } }, 400),
    );

    const err = await client.get('/bad').catch((e: unknown) => e) as ApiError;

    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(400);
    expect(err.message).toBe('Bad input');
    expect(err.code).toBe(-32600);
    expect(err.data).toEqual({ field: 'name' });
  });

  it('throws ApiError with generic message when body is not JSON', async () => {
    mockGetValidToken.mockResolvedValue('tok');
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('Internal Server Error', { status: 500 }),
    );

    const err = await client.get('/broken').catch((e: unknown) => e) as ApiError;

    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(500);
    expect(err.message).toMatch(/request failed.*500/i);
  });

  // -----------------------------------------------------------------------
  // Network errors
  // -----------------------------------------------------------------------

  it('propagates network errors from fetch', async () => {
    mockGetValidToken.mockResolvedValue('tok');
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await expect(client.get('/unreachable')).rejects.toThrow('Failed to fetch');
  });

  // -----------------------------------------------------------------------
  // ApiError properties
  // -----------------------------------------------------------------------

  it('ApiError has correct name and enumerable properties', () => {
    const err = new ApiError('test', 418, -32000, { detail: 'teapot' });

    expect(err.name).toBe('ApiError');
    expect(err.message).toBe('test');
    expect(err.status).toBe(418);
    expect(err.code).toBe(-32000);
    expect(err.data).toEqual({ detail: 'teapot' });
    expect(err).toBeInstanceOf(Error);
  });
});
