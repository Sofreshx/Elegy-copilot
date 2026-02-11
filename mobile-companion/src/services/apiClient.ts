import { getAuthService, resolveRelayHttpUrl } from './authService';

/**
 * Custom error class for API responses.
 * Includes HTTP status and optional JSON-RPC error code.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code?: number;
  readonly data?: unknown;

  constructor(message: string, status: number, code?: number, data?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

/**
 * Typed REST API client for the relay backend.
 *
 * - Automatically injects Bearer auth token on every request.
 * - Auto-refreshes token on 401 and retries once.
 * - Provides typed response handling via generics.
 */
export class ApiClient {
  private readonly baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl ?? resolveRelayHttpUrl();
  }

  /**
   * Generic request method. Handles auth injection, 401 retry, and response parsing.
   */
  async request<T>(path: string, options?: RequestInit): Promise<T> {
    const authService = getAuthService();

    // Get a valid token (auto-refreshes if expired)
    let token = await authService.getValidToken();
    if (!token) {
      throw new ApiError('Authentication required — please log in again.', 401);
    }

    // First attempt
    let response = await this.doFetch(path, token, options);

    // On 401: attempt one token refresh + retry
    if (response.status === 401) {
      token = await authService.getValidToken();
      if (!token) {
        authService.logout();
        throw new ApiError('Session expired — please log in again.', 401);
      }
      response = await this.doFetch(path, token, options);
    }

    // If still failing, parse the error
    if (!response.ok) {
      await this.throwApiError(response);
    }

    // 204 No Content — return undefined cast to T
    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }

  /** GET helper */
  async get<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'GET' });
  }

  /** POST helper */
  async post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  /** PUT helper */
  async put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  /** DELETE helper */
  async delete<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, {
      method: 'DELETE',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async doFetch(path: string, token: string, options?: RequestInit): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const headers = new Headers(options?.headers);
    headers.set('Authorization', `Bearer ${token}`);

    return fetch(url, { ...options, headers });
  }

  /**
   * Parse a non-OK response into an ApiError.
   * Tries to extract a JSON body with `error`/`message`/`code`/`data` fields.
   */
  private async throwApiError(response: Response): Promise<never> {
    let message = `Request failed (HTTP ${response.status})`;
    let code: number | undefined;
    let data: unknown;

    try {
      const body = await response.json();
      if (typeof body.error === 'string') {
        message = body.error;
      } else if (typeof body.error?.message === 'string') {
        message = body.error.message;
        code = body.error.code;
        data = body.error.data;
      } else if (typeof body.message === 'string') {
        message = body.message;
      }
    } catch {
      // Response body wasn't JSON — use the default message
    }

    throw new ApiError(message, response.status, code, data);
  }
}

// Singleton
let instance: ApiClient | null = null;

/**
 * Get the singleton ApiClient instance.
 */
export function getApiClient(): ApiClient {
  if (!instance) {
    instance = new ApiClient();
  }
  return instance;
}
