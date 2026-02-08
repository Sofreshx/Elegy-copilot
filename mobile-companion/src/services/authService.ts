// GitHub OAuth configuration
const GITHUB_SCOPES = ['read:user', 'repo'];

function getEnvValue(key: string): string | undefined {
  const value = import.meta.env?.[key as keyof ImportMetaEnv];
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeHttpUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    if (url.protocol === 'ws:') {
      url.protocol = 'http:';
    } else if (url.protocol === 'wss:') {
      url.protocol = 'https:';
    }
    url.hash = '';
    url.search = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return rawUrl.replace(/\/$/, '');
  }
}

export function resolveRedirectUri(): string {
  return getEnvValue('VITE_GITHUB_REDIRECT_URI') || `${window.location.origin}/auth/callback`;
}

export function resolveRelayHttpUrl(input?: string): string {
  const rawUrl =
    input ||
    getEnvValue('VITE_RELAY_HTTP_URL') ||
    getEnvValue('VITE_RELAY_URL');
  if (!rawUrl) {
    throw new Error('Relay HTTP URL is not configured. Set VITE_RELAY_HTTP_URL in mobile-companion/.env.');
  }
  return normalizeHttpUrl(rawUrl);
}

export function resolveClientId(): string {
  const clientId = getEnvValue('VITE_GITHUB_CLIENT_ID');
  if (!clientId) {
    throw new Error('GitHub OAuth client ID is not configured. Set VITE_GITHUB_CLIENT_ID in mobile-companion/.env.');
  }
  return clientId;
}

export function getAuthConfigError(clientIdOverride?: string): string | null {
  const clientId = clientIdOverride ?? getEnvValue('VITE_GITHUB_CLIENT_ID');
  if (!clientId) {
    return 'GitHub OAuth client ID is not configured. Set VITE_GITHUB_CLIENT_ID in mobile-companion/.env.';
  }
  const relayUrl = getEnvValue('VITE_RELAY_HTTP_URL') || getEnvValue('VITE_RELAY_URL');
  if (!relayUrl) {
    return 'Relay HTTP URL is not configured. Set VITE_RELAY_HTTP_URL in mobile-companion/.env.';
  }
  return null;
}

// Storage keys
const TOKEN_KEY = 'ie_relay_access_token';
const REFRESH_TOKEN_KEY = 'ie_relay_refresh_token';
const USER_KEY = 'ie_mobile_user';

export interface GitHubUser {
  id: number;
  login: string;
  name: string | null;
  email: string | null;
  avatarUrl: string;
}

export interface AuthState {
  accessToken: string | null;
  user: GitHubUser | null;
  isAuthenticated: boolean;
}

/**
 * Maps a relay-provided user object to the GitHubUser interface used by the app.
 */
function mapRelayUser(relayUser: { id: string | number; login: string; avatar_url: string }): GitHubUser {
  const rawId = typeof relayUser.id === 'string'
    ? relayUser.id.replace('github|', '')
    : String(relayUser.id);
  return {
    id: parseInt(rawId, 10) || 0,
    login: relayUser.login,
    name: null,
    email: null,
    avatarUrl: relayUser.avatar_url,
  };
}

/**
 * Authentication service for GitHub OAuth via relay-minted JWTs.
 * Handles the OAuth flow, token storage, refresh, and user info.
 */
export class AuthService {
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private user: GitHubUser | null = null;
  private stateKey = 'ie_mobile_oauth_state';

  constructor() {
    this.loadFromStorage();
  }

  /**
   * Get the current authentication state
   */
  getState(): AuthState {
    return {
      accessToken: this.accessToken,
      user: this.user,
      isAuthenticated: !!this.accessToken && !!this.user,
    };
  }

  /**
   * Validate required configuration for OAuth.
   */
  getConfigError(): string | null {
    return getAuthConfigError();
  }

  /**
   * Initiate GitHub OAuth login flow
   */
  login(): void {
    const configError = getAuthConfigError();
    if (configError) {
      console.error(configError);
      return;
    }

    // Generate and store state for CSRF protection
    const state = crypto.randomUUID();
    sessionStorage.setItem(this.stateKey, state);

    // Build OAuth URL
    const params = new URLSearchParams({
      client_id: resolveClientId(),
      redirect_uri: resolveRedirectUri(),
      scope: GITHUB_SCOPES.join(' '),
      state,
    });

    // Redirect to GitHub
    window.location.href = `https://github.com/login/oauth/authorize?${params}`;
  }

  /**
   * Handle OAuth callback and exchange code for token
   * This should be called from the callback page
   */
  async handleCallback(code: string, state: string): Promise<boolean> {
    // Verify state
    const storedState = sessionStorage.getItem(this.stateKey);
    sessionStorage.removeItem(this.stateKey);

    if (!storedState || storedState !== state) {
      console.error('OAuth state mismatch');
      return false;
    }

    try {
      // Exchange code for relay-minted JWT via the relay server
      const relayUrl = resolveRelayHttpUrl();
      const response = await fetch(`${relayUrl}/auth/callback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          redirect_uri: resolveRedirectUri(),
          client_type: 'mobile',
        }),
      });

      if (!response.ok) {
        throw new Error('Token exchange failed');
      }

      const data = await response.json();
      this.accessToken = data.access_token;
      this.refreshToken = data.refresh_token ?? null;

      // Extract user from relay response (no separate GitHub API call needed)
      if (data.user) {
        this.user = mapRelayUser(data.user);
      }

      // Persist to storage
      this.saveToStorage();

      return true;
    } catch (error) {
      console.error('OAuth callback error:', error);
      return false;
    }
  }

  /**
   * For development/testing: set token directly
   */
  setToken(token: string): void {
    this.accessToken = token;
    this.saveToStorage();
  }

  /**
   * Logout and clear stored credentials
   */
  logout(): void {
    this.accessToken = null;
    this.refreshToken = null;
    this.user = null;
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }

  /**
   * Returns the stored user. User info is provided by the relay auth
   * response, so no separate GitHub API call is needed.
   */
  async fetchUser(): Promise<GitHubUser | null> {
    return this.user;
  }

  /**
   * Check whether a JWT token is expired (with 60s buffer).
   */
  isTokenExpired(token?: string): boolean {
    const t = token ?? this.accessToken;
    if (!t) { return true; }
    try {
      const payload = JSON.parse(atob(t.split('.')[1]));
      return Date.now() / 1000 >= payload.exp - 60;
    } catch { return true; }
  }

  /**
   * Refresh the access token using the stored refresh token.
   */
  async refreshAccessToken(): Promise<boolean> {
    const refreshToken = this.refreshToken ?? localStorage.getItem(REFRESH_TOKEN_KEY);
    if (!refreshToken) { return false; }

    try {
      const relayUrl = resolveRelayHttpUrl();
      const res = await fetch(`${relayUrl}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken, client_type: 'mobile' }),
      });

      if (!res.ok) { return false; }

      const data = await res.json();
      this.accessToken = data.access_token;
      this.refreshToken = data.refresh_token ?? this.refreshToken;
      localStorage.setItem(TOKEN_KEY, data.access_token);
      if (data.refresh_token) {
        localStorage.setItem(REFRESH_TOKEN_KEY, data.refresh_token);
      }

      if (data.user) {
        this.user = mapRelayUser(data.user);
        localStorage.setItem(USER_KEY, JSON.stringify(this.user));
      }

      return true;
    } catch (error) {
      console.error('Token refresh failed:', error);
      return false;
    }
  }

  /**
   * Get a valid (non-expired) access token, refreshing if needed.
   * Returns null if refresh fails — caller should trigger re-login.
   */
  async getValidToken(): Promise<string | null> {
    if (this.accessToken && !this.isTokenExpired()) {
      return this.accessToken;
    }
    const refreshed = await this.refreshAccessToken();
    if (refreshed && this.accessToken) {
      return this.accessToken;
    }
    // Refresh failed — user needs to re-login
    this.logout();
    return null;
  }

  /**
   * Get the current access token
   */
  getToken(): string | null {
    return this.accessToken;
  }

  /**
   * Get the current user
   */
  getUser(): GitHubUser | null {
    return this.user;
  }

  private loadFromStorage(): void {
    try {
      const token = localStorage.getItem(TOKEN_KEY);
      const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
      const userJson = localStorage.getItem(USER_KEY);

      if (token) {
        this.accessToken = token;
      }

      if (refreshToken) {
        this.refreshToken = refreshToken;
      }

      if (userJson) {
        this.user = JSON.parse(userJson) as GitHubUser;
      }
    } catch (error) {
      console.error('Failed to load auth from storage:', error);
      this.logout();
    }
  }

  private saveToStorage(): void {
    try {
      if (this.accessToken) {
        localStorage.setItem(TOKEN_KEY, this.accessToken);
      }
      if (this.refreshToken) {
        localStorage.setItem(REFRESH_TOKEN_KEY, this.refreshToken);
      }
      if (this.user) {
        localStorage.setItem(USER_KEY, JSON.stringify(this.user));
      }
    } catch (error) {
      console.error('Failed to save auth to storage:', error);
    }
  }
}

// Singleton instance
let authInstance: AuthService | null = null;

export function getAuthService(): AuthService {
  if (!authInstance) {
    authInstance = new AuthService();
  }
  return authInstance;
}
