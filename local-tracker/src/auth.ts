export interface TrackerCredentials {
  relayToken: string;
  source: "env" | "keychain" | "manual";
}

export class TrackerAuth {
  private credentials: TrackerCredentials | null = null;

  /**
   * Resolve credentials from available sources in priority order:
   * 1. Environment variable (TRACKER_RELAY_TOKEN)
   * 2. OS keychain (future — gracefully skipped if not available)
   * 3. Manual prompt (future)
   */
  async resolve(): Promise<TrackerCredentials | null> {
    // Try environment variable first
    const envToken = process.env.TRACKER_RELAY_TOKEN;
    if (envToken) {
      this.credentials = { relayToken: envToken, source: "env" };
      return this.credentials;
    }

    // Try OS keychain (optional, graceful fallback)
    const keychainToken = await this.tryKeychain();
    if (keychainToken) {
      this.credentials = { relayToken: keychainToken, source: "keychain" };
      return this.credentials;
    }

    console.warn(
      "[Auth] No relay credentials found. Set TRACKER_RELAY_TOKEN environment variable."
    );
    return null;
  }

  /** Get current credentials (after resolve()) */
  getCredentials(): TrackerCredentials | null {
    return this.credentials;
  }

  /**
   * Validate that the token is well-formed (basic JWT structure check).
   * This does NOT verify the signature — that is the relay's responsibility.
   */
  validateToken(token: string): boolean {
    const parts = token.split(".");
    if (parts.length !== 3) return false;

    try {
      const header = JSON.parse(
        Buffer.from(parts[0], "base64url").toString()
      );
      const payload = JSON.parse(
        Buffer.from(parts[1], "base64url").toString()
      );

      // Check for required JWT header fields
      if (!header.alg || !header.typ) return false;

      // Require at least one identifier claim
      if (!payload.sub && !payload.client_id) return false;

      // Check expiration if present
      if (payload.exp && payload.exp < Date.now() / 1000) {
        console.warn("[Auth] Token has expired");
        return false;
      }

      return true;
    } catch {
      return false;
    }
  }

  /** Attempt to read token from OS keychain — returns null if unavailable */
  private async tryKeychain(): Promise<string | null> {
    try {
      // Placeholder for future OS keychain integration.
      // keytar was deprecated; we skip until a replacement is chosen.
      return null;
    } catch {
      return null;
    }
  }
}
