import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAuthConfigError, resolveRelayHttpUrl, AuthService } from '../authService';

// ---------------------------------------------------------------------------
// Configuration tests (existing)
// ---------------------------------------------------------------------------

describe('authService configuration', () => {
  it('returns error when GitHub client ID is empty', () => {
    expect(getAuthConfigError('')).toMatch(/client id.*not configured/i);
  });

  it('returns error when relay URL is not configured', () => {
    expect(getAuthConfigError('test-client-id')).toMatch(/relay.*not configured/i);
  });

  it('normalizes relay HTTP URLs', () => {
    expect(resolveRelayHttpUrl('wss://relay.example.com/')).toBe('https://relay.example.com');
    expect(resolveRelayHttpUrl('ws://localhost:3000/')).toBe('http://localhost:3000');
  });
});

// ---------------------------------------------------------------------------
// handleCallback tests
// ---------------------------------------------------------------------------

describe('AuthService.handleCallback', () => {
  let authService: AuthService;

  const fakeUser = {
    id: 'github|42',
    login: 'testuser',
    avatar_url: 'https://example.com/avatar.png',
  };

  beforeEach(() => {
    authService = new AuthService();
    // Stub out import.meta.env values used by resolveRelayHttpUrl / resolveClientId
    vi.stubEnv('VITE_RELAY_HTTP_URL', 'https://relay.test');
    vi.stubEnv('VITE_GITHUB_CLIENT_ID', 'fake-client-id');
    // Store a matching OAuth state so CSRF check passes
    sessionStorage.setItem('ie_mobile_oauth_state', 'valid-state');
    // Clear localStorage between tests
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    sessionStorage.clear();
    localStorage.clear();
  });

  it('returns success on a 200 response with tokens and user', async () => {
    const mockResponse = {
      access_token: 'jwt-access-token',
      refresh_token: 'jwt-refresh-token',
      user: fakeUser,
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockResponse), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );

    const result = await authService.handleCallback('code-123', 'valid-state');

    expect(result).toEqual({ success: true });
    expect(authService.getToken()).toBe('jwt-access-token');
    expect(authService.getUser()).toMatchObject({ login: 'testuser', id: 42 });
    // Persisted to localStorage
    expect(localStorage.getItem('ie_relay_access_token')).toBe('jwt-access-token');
  });

  it('returns error details on a non-200 response with JSON error body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 401, headers: { 'Content-Type': 'application/json' } }),
    );

    const result = await authService.handleCallback('bad-code', 'valid-state');

    expect(result.success).toBe(false);
    expect(result.error).toBe('invalid_grant');
    expect(authService.getToken()).toBeNull();
  });

  it('returns generic error on non-200 response with non-JSON body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('Internal Server Error', { status: 500 }),
    );

    const result = await authService.handleCallback('code', 'valid-state');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/token exchange failed.*500/i);
  });

  it('returns error on OAuth state mismatch', async () => {
    const result = await authService.handleCallback('code-123', 'wrong-state');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/state mismatch/i);
  });

  it('returns error when fetch throws a network error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const result = await authService.handleCallback('code-123', 'valid-state');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Failed to fetch');
  });
});

// ---------------------------------------------------------------------------
// getValidToken with refresh
// ---------------------------------------------------------------------------

describe('AuthService.getValidToken', () => {
  let authService: AuthService;

  beforeEach(() => {
    authService = new AuthService();
    vi.stubEnv('VITE_RELAY_HTTP_URL', 'https://relay.test');
    vi.stubEnv('VITE_GITHUB_CLIENT_ID', 'fake-client-id');
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    localStorage.clear();
  });

  /**
   * Helper: create a minimal JWT with the given expiry (epoch seconds).
   */
  function makeJwt(exp: number): string {
    const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = btoa(JSON.stringify({ sub: '1', exp }));
    return `${header}.${payload}.fakesig`;
  }

  it('returns the token directly when it is not expired', async () => {
    const futureExp = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
    const token = makeJwt(futureExp);
    authService.setToken(token);

    const result = await authService.getValidToken();

    expect(result).toBe(token);
  });

  it('refreshes and returns new token when current token is expired', async () => {
    const pastExp = Math.floor(Date.now() / 1000) - 60; // already expired
    const expiredToken = makeJwt(pastExp);
    authService.setToken(expiredToken);
    // Simulate a stored refresh token
    localStorage.setItem('ie_relay_refresh_token', 'refresh-tok');

    const newFutureExp = Math.floor(Date.now() / 1000) + 3600;
    const freshToken = makeJwt(newFutureExp);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: freshToken }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );

    const result = await authService.getValidToken();

    expect(result).toBe(freshToken);
  });

  it('returns null and logs out when refresh fails', async () => {
    const pastExp = Math.floor(Date.now() / 1000) - 60;
    authService.setToken(makeJwt(pastExp));
    localStorage.setItem('ie_relay_refresh_token', 'refresh-tok');

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('Unauthorized', { status: 401 }),
    );

    const result = await authService.getValidToken();

    expect(result).toBeNull();
    expect(authService.getToken()).toBeNull();
  });
});
