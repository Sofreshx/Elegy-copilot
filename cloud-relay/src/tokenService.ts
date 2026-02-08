import jwt from "jsonwebtoken";
import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";
import type { AccessTokenClaims } from "./types";

/**
 * Configuration for TokenService.
 */
export interface TokenServiceConfig {
  jwtSecret: string;
  jwtIssuer: string;
  jwtAudience: string;
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
}

/**
 * Input for minting an access token.
 */
export interface MintAccessTokenInput {
  userId: string;
  githubLogin: string;
  clientType: "mobile" | "extension";
  clientId: string;
  scopes: string[];
}

/**
 * Claims embedded in a refresh token.
 */
export interface RefreshTokenClaims {
  sub: string;
  jti: string;
  github_login: string;
  token_type: "refresh";
  iat: number;
  exp: number;
  iss: string;
  aud: string;
}

/**
 * Centralised JWT minting and verification for the relay.
 *
 * All relay-issued tokens use HS256 signed with a shared secret.
 */
export class TokenService {
  private readonly config: TokenServiceConfig;

  constructor(config: Partial<TokenServiceConfig> & Pick<TokenServiceConfig, "jwtSecret">) {
    this.config = {
      jwtIssuer: config.jwtIssuer ?? "instruction-engine-relay",
      jwtAudience: config.jwtAudience ?? "instruction-engine",
      accessTokenTtlSeconds: config.accessTokenTtlSeconds ?? 3600,
      refreshTokenTtlSeconds: config.refreshTokenTtlSeconds ?? 2592000,
      jwtSecret: config.jwtSecret,
    };
  }

  /**
   * Mint a short-lived access token containing full AccessTokenClaims.
   */
  mintAccessToken(input: MintAccessTokenInput): string {
    const payload: Omit<AccessTokenClaims, "iat" | "exp"> = {
      sub: input.userId,
      jti: uuidv4(),
      client_id: input.clientId,
      client_type: input.clientType,
      scopes: input.scopes,
      github_login: input.githubLogin,
      iss: this.config.jwtIssuer,
      aud: this.config.jwtAudience,
    };

    return jwt.sign(payload, this.config.jwtSecret, {
      algorithm: "HS256",
      expiresIn: this.config.accessTokenTtlSeconds,
    });
  }

  /**
   * Mint a long-lived refresh token with `token_type: "refresh"`.
   */
  mintRefreshToken(userId: string, githubLogin: string): string {
    const payload: Omit<RefreshTokenClaims, "iat" | "exp"> = {
      sub: userId,
      jti: uuidv4(),
      github_login: githubLogin,
      token_type: "refresh",
      iss: this.config.jwtIssuer,
      aud: this.config.jwtAudience,
    };

    return jwt.sign(payload, this.config.jwtSecret, {
      algorithm: "HS256",
      expiresIn: this.config.refreshTokenTtlSeconds,
    });
  }

  /**
   * Verify an access token's signature, issuer, and audience.
   * Returns the decoded claims on success, or `null` on any failure.
   */
  verifyAccessToken(token: string): AccessTokenClaims | null {
    try {
      const decoded = jwt.verify(token, this.config.jwtSecret, {
        issuer: this.config.jwtIssuer,
        audience: this.config.jwtAudience,
      }) as AccessTokenClaims;
      return decoded;
    } catch {
      return null;
    }
  }

  /**
   * Verify a refresh token's signature, issuer, audience, and `token_type`.
   * Returns the decoded claims on success, or `null` on any failure.
   */
  verifyRefreshToken(token: string): RefreshTokenClaims | null {
    try {
      const decoded = jwt.verify(token, this.config.jwtSecret, {
        issuer: this.config.jwtIssuer,
        audience: this.config.jwtAudience,
      }) as RefreshTokenClaims;

      if (decoded.token_type !== "refresh") {
        return null;
      }

      return decoded;
    } catch {
      return null;
    }
  }

  /**
   * Create an HMAC-SHA256 signature of the given data using the JWT secret.
   * Used for CSRF state verification on OAuth callbacks.
   */
  hmacSign(data: string): string {
    return crypto.createHmac("sha256", this.config.jwtSecret).update(data).digest("hex");
  }
}
