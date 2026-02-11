import * as vscode from 'vscode';

export interface RelayTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix timestamp in seconds
}

/**
 * Bridges VS Code's built-in GitHub authentication to relay-issued JWTs.
 *
 * Auth flow:
 *   1. Check cached / stored relay tokens — return if still valid
 *   2. Try refresh via POST /auth/refresh
 *   3. Get GitHub token via vscode.authentication, exchange via POST /auth/exchange
 *   4. On failure → show notification, return null (never throw)
 */
export class RelayAuthBridge implements vscode.Disposable {
  private readonly secretStorage: vscode.SecretStorage;
  private readonly output: vscode.OutputChannel;
  private cachedTokens: RelayTokens | null = null;

  private static readonly ACCESS_TOKEN_KEY = 'skillInstaller.relay.accessToken';
  private static readonly REFRESH_TOKEN_KEY = 'skillInstaller.relay.refreshToken';
  private static readonly EXPIRES_AT_KEY = 'skillInstaller.relay.expiresAt';

  /** Buffer in seconds — tokens are considered expired this many seconds early. */
  private static readonly EXPIRY_BUFFER_SECONDS = 60;

  constructor(secretStorage: vscode.SecretStorage, output: vscode.OutputChannel) {
    this.secretStorage = secretStorage;
    this.output = output;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Get valid relay tokens, refreshing or exchanging as needed.
   * Returns null if authentication fails — never throws.
   */
  async getRelayTokens(): Promise<RelayTokens | null> {
    const start = Date.now();
    try {
      // 1. Return cached tokens if still valid
      this.output.appendLine(`[RelayAuth] Step 1: checking cached tokens (${Date.now() - start}ms)`);
      if (this.cachedTokens && !this.isExpired(this.cachedTokens.expiresAt)) {
        this.output.appendLine(`[RelayAuth] Authentication completed via cache in ${Date.now() - start}ms`);
        return this.cachedTokens;
      }

      // 2. Try loading from SecretStorage
      this.output.appendLine(`[RelayAuth] Step 2: loading from SecretStorage (${Date.now() - start}ms)`);
      const stored = await this.loadStoredTokens();
      if (stored && !this.isExpired(stored.expiresAt)) {
        this.cachedTokens = stored;
        this.output.appendLine(`[RelayAuth] Authentication completed via storage in ${Date.now() - start}ms`);
        return stored;
      }

      // 3. Try refresh if we have a refresh token
      this.output.appendLine(`[RelayAuth] Step 3: attempting token refresh (${Date.now() - start}ms)`);
      const refreshToken = stored?.refreshToken
        ?? await this.secretStorage.get(RelayAuthBridge.REFRESH_TOKEN_KEY);
      if (refreshToken) {
        const refreshed = await this.refreshTokens(refreshToken);
        if (refreshed) {
          this.cachedTokens = refreshed;
          await this.storeTokens(refreshed);
          this.output.appendLine(`[RelayAuth] Authentication completed via refresh in ${Date.now() - start}ms`);
          return refreshed;
        }
      }

      // 4. Full exchange: get GitHub token → exchange for relay tokens
      this.output.appendLine(`[RelayAuth] Step 4: full GitHub token exchange (${Date.now() - start}ms)`);
      const githubToken = await this.getGitHubToken();
      if (!githubToken) {
        this.output.appendLine(`[RelayAuth] Authentication completed via failed in ${Date.now() - start}ms`);
        return null;
      }

      const exchanged = await this.exchangeGitHubToken(githubToken);
      if (exchanged) {
        this.cachedTokens = exchanged;
        await this.storeTokens(exchanged);
        this.output.appendLine(`[RelayAuth] Authentication completed via exchange in ${Date.now() - start}ms`);
        return exchanged;
      }

      // All paths exhausted
      this.output.appendLine(`[RelayAuth] Authentication completed via failed in ${Date.now() - start}ms`);
      return null;
    } catch (err) {
      this.output.appendLine(`[RelayAuth] Unexpected error in getRelayTokens (${Date.now() - start}ms): ${err}`);
      return null;
    }
  }

  /**
   * Convenience — returns just the access token string, or null.
   */
  async getAccessToken(): Promise<string | null> {
    const tokens = await this.getRelayTokens();
    return tokens?.accessToken ?? null;
  }

  /**
   * Returns true if the given token string is expired (or un-parseable).
   */
  isTokenExpired(token: string): boolean {
    const exp = this.decodeTokenExpiry(token);
    if (exp === null) { return true; }
    return this.isExpired(exp);
  }

  /**
   * Clear all stored relay tokens (logout / disconnect).
   */
  async clearTokens(): Promise<void> {
    this.cachedTokens = null;
    await Promise.all([
      this.secretStorage.delete(RelayAuthBridge.ACCESS_TOKEN_KEY),
      this.secretStorage.delete(RelayAuthBridge.REFRESH_TOKEN_KEY),
      this.secretStorage.delete(RelayAuthBridge.EXPIRES_AT_KEY),
    ]);
    this.output.appendLine('[RelayAuth] Tokens cleared');
  }

  /**
   * Decode JWT claims without cryptographic verification.
   * Returns the parsed payload object, or null on failure.
   */
  decodeJwtClaims(token: string): Record<string, unknown> | null {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) { return null; }
      return JSON.parse(Buffer.from(parts[1], 'base64url').toString()) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  dispose(): void {
    this.cachedTokens = null;
  }

  // ---------------------------------------------------------------------------
  // Private — relay HTTP helpers
  // ---------------------------------------------------------------------------

  /**
   * Exchange a GitHub token for relay tokens via POST /auth/exchange.
   */
  private async exchangeGitHubToken(githubToken: string): Promise<RelayTokens | null> {
    const httpUrl = this.getRelayHttpUrl();
    const url = `${httpUrl}/auth/exchange`;
    this.output.appendLine(`[RelayAuth] Exchanging GitHub token via ${url}`);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ github_token: githubToken, client_type: 'extension' }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        this.output.appendLine(`[RelayAuth] Exchange failed: ${res.status} ${body}`);
        vscode.window.showWarningMessage('Relay token exchange failed. Check the output panel for details.');
        return null;
      }

      const data = (await res.json()) as {
        access_token: string;
        refresh_token: string;
        expires_in: number;
      };

      const expiresAt = this.decodeTokenExpiry(data.access_token)
        ?? Math.floor(Date.now() / 1000) + data.expires_in;

      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt,
      };
    } catch (err) {
      this.output.appendLine(`[RelayAuth] Exchange error: ${err}`);
      return null;
    }
  }

  /**
   * Refresh relay tokens via POST /auth/refresh.
   */
  private async refreshTokens(refreshToken: string): Promise<RelayTokens | null> {
    const httpUrl = this.getRelayHttpUrl();
    const url = `${httpUrl}/auth/refresh`;
    this.output.appendLine('[RelayAuth] Attempting token refresh');

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken, client_type: 'extension' }),
      });

      if (!res.ok) {
        this.output.appendLine(`[RelayAuth] Refresh failed: ${res.status}`);
        return null;
      }

      const data = (await res.json()) as {
        access_token: string;
        refresh_token: string;
        expires_in: number;
      };

      const expiresAt = this.decodeTokenExpiry(data.access_token)
        ?? Math.floor(Date.now() / 1000) + data.expires_in;

      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt,
      };
    } catch (err) {
      this.output.appendLine(`[RelayAuth] Refresh error: ${err}`);
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Private — VS Code GitHub auth
  // ---------------------------------------------------------------------------

  /**
   * Get a GitHub access token using VS Code's built-in GitHub auth provider.
   * Shows a notification on failure — never throws.
   */
  private async getGitHubToken(): Promise<string | null> {
    try {
      const session = await vscode.authentication.getSession('github', ['read:user'], { createIfNone: true });
      return session?.accessToken ?? null;
    } catch {
      this.output.appendLine('[RelayAuth] GitHub authentication cancelled or failed');
      vscode.window.showWarningMessage('GitHub authentication required for relay connection');
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Private — token storage
  // ---------------------------------------------------------------------------

  private async storeTokens(tokens: RelayTokens): Promise<void> {
    await Promise.all([
      this.secretStorage.store(RelayAuthBridge.ACCESS_TOKEN_KEY, tokens.accessToken),
      this.secretStorage.store(RelayAuthBridge.REFRESH_TOKEN_KEY, tokens.refreshToken),
      this.secretStorage.store(RelayAuthBridge.EXPIRES_AT_KEY, String(tokens.expiresAt)),
    ]);
  }

  private async loadStoredTokens(): Promise<RelayTokens | null> {
    const [accessToken, refreshToken, expiresAtStr] = await Promise.all([
      this.secretStorage.get(RelayAuthBridge.ACCESS_TOKEN_KEY),
      this.secretStorage.get(RelayAuthBridge.REFRESH_TOKEN_KEY),
      this.secretStorage.get(RelayAuthBridge.EXPIRES_AT_KEY),
    ]);

    if (!accessToken || !refreshToken || !expiresAtStr) {
      return null;
    }

    const expiresAt = Number(expiresAtStr);
    if (Number.isNaN(expiresAt)) { return null; }

    return { accessToken, refreshToken, expiresAt };
  }

  // ---------------------------------------------------------------------------
  // Private — helpers
  // ---------------------------------------------------------------------------

  /**
   * Decode the `exp` claim from a JWT without cryptographic verification.
   * Returns the expiry as a Unix timestamp (seconds), or null on failure.
   */
  private decodeTokenExpiry(token: string): number | null {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) { return null; }
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
      return typeof payload.exp === 'number' ? payload.exp : null;
    } catch {
      return null;
    }
  }

  /**
   * Returns true if `expiresAt` (Unix seconds) is within the expiry buffer.
   */
  private isExpired(expiresAt: number): boolean {
    return Date.now() / 1000 >= expiresAt - RelayAuthBridge.EXPIRY_BUFFER_SECONDS;
  }

  /**
   * Read the relay HTTP URL from VS Code settings.
   */
  private getRelayHttpUrl(): string {
    return vscode.workspace
      .getConfiguration('skillInstaller.relay')
      .get<string>('httpUrl', 'https://relay.sfrsh.xyz');
  }
}
