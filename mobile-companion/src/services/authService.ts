// GitHub OAuth configuration
const FALLBACK_CLIENT_ID = 'Ov23liF3zWLNuXjUqCRG';
const DEFAULT_RELAY_HTTP_URL = 'https://relay.example.com';
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
    getEnvValue('VITE_RELAY_URL') ||
    DEFAULT_RELAY_HTTP_URL;
  return normalizeHttpUrl(rawUrl);
}

export function resolveClientId(): string {
  return getEnvValue('VITE_GITHUB_CLIENT_ID') || FALLBACK_CLIENT_ID;
}

export function getAuthConfigError(clientIdOverride?: string): string | null {
  const clientId = clientIdOverride ?? resolveClientId();
  if (!clientId || clientId === FALLBACK_CLIENT_ID) {
    return 'GitHub OAuth client ID is not configured. Set VITE_GITHUB_CLIENT_ID in mobile-companion/.env.';
  }
  return null;
}

// Storage keys
const TOKEN_KEY = 'ie_mobile_auth_token';
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
 * Authentication service for GitHub OAuth.
 * Handles the OAuth flow, token storage, and user info retrieval.
 */
export class AuthService {
  private accessToken: string | null = null;
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
      // Exchange code for token via the relay server
      // (GitHub doesn't allow direct token exchange from browser due to CORS)
      const relayUrl = resolveRelayHttpUrl();
      const response = await fetch(`${relayUrl}/auth/callback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, redirect_uri: resolveRedirectUri() }),
      });

      if (!response.ok) {
        throw new Error('Token exchange failed');
      }

      const { access_token } = await response.json();
      this.accessToken = access_token;

      // Fetch user info
      await this.fetchUser();

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
    this.user = null;
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }

  /**
   * Fetch current user info from GitHub
   */
  async fetchUser(): Promise<GitHubUser | null> {
    if (!this.accessToken) {
      return null;
    }

    try {
      const response = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          Accept: 'application/vnd.github+json',
        },
      });

      if (!response.ok) {
        if (response.status === 401) {
          // Token invalid, clear auth
          this.logout();
        }
        return null;
      }

      const data = await response.json();
      this.user = {
        id: data.id,
        login: data.login,
        name: data.name,
        email: data.email,
        avatarUrl: data.avatar_url,
      };

      this.saveToStorage();
      return this.user;
    } catch (error) {
      console.error('Failed to fetch user:', error);
      return null;
    }
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
      const userJson = localStorage.getItem(USER_KEY);

      if (token) {
        this.accessToken = token;
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
