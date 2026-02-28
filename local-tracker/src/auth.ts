import {
  TRACKER_TOKEN_READINESS_CONTRACT_VERSION,
  TrackerRelayTokenSource,
  TrackerTokenReadinessV1,
} from "./config";

export interface TrackerCredentials {
  relayToken: string;
  source: "env" | "keychain" | "manual";
}

interface TrackerTokenAssessmentResult {
  state: "ready" | "invalid" | "expired";
  reasonCode: "relay_token_valid" | "relay_token_invalid" | "relay_token_expired";
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

  evaluateTokenReadiness(
    token: string | null | undefined,
    source: TrackerRelayTokenSource = "unknown"
  ): TrackerTokenReadinessV1 {
    const tokenValue = typeof token === "string" ? token.trim() : "";
    if (!tokenValue) {
      return {
        contractVersion: TRACKER_TOKEN_READINESS_CONTRACT_VERSION,
        state: "missing",
        reasonCode: "relay_token_missing",
        deterministic: true,
        source: source === "unknown" ? "missing" : source,
      };
    }

    const assessment = this.assessToken(tokenValue);
    return {
      contractVersion: TRACKER_TOKEN_READINESS_CONTRACT_VERSION,
      state: assessment.state,
      reasonCode: assessment.reasonCode,
      deterministic: true,
      source,
    };
  }

  /**
   * Validate that the token is well-formed (basic JWT structure check).
   * This does NOT verify the signature — that is the relay's responsibility.
   */
  validateToken(token: string): boolean {
    return this.evaluateTokenReadiness(token, "unknown").state === "ready";
  }

  private assessToken(token: string): TrackerTokenAssessmentResult {
    const parts = token.split(".");
    if (parts.length !== 3) {
      return {
        state: "invalid",
        reasonCode: "relay_token_invalid",
      };
    }

    try {
      const header = JSON.parse(
        Buffer.from(parts[0], "base64url").toString()
      );
      const payload = JSON.parse(
        Buffer.from(parts[1], "base64url").toString()
      );

      // Check for required JWT header fields
      if (!header.alg || !header.typ) {
        return {
          state: "invalid",
          reasonCode: "relay_token_invalid",
        };
      }

      // Require at least one identifier claim
      if (!payload.sub && !payload.client_id) {
        return {
          state: "invalid",
          reasonCode: "relay_token_invalid",
        };
      }

      // Check expiration if present
      if (payload.exp && payload.exp < Date.now() / 1000) {
        console.warn("[Auth] Token has expired");
        return {
          state: "expired",
          reasonCode: "relay_token_expired",
        };
      }

      return {
        state: "ready",
        reasonCode: "relay_token_valid",
      };
    } catch {
      return {
        state: "invalid",
        reasonCode: "relay_token_invalid",
      };
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
