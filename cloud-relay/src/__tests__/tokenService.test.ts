import jwt from "jsonwebtoken";
import { TokenService } from "../tokenService";
import type { AccessTokenClaims } from "../types";

const TEST_CONFIG = {
  jwtSecret: "test-secret-key-for-unit-tests",
  jwtIssuer: "test-issuer",
  jwtAudience: "test-audience",
  accessTokenTtlSeconds: 3600,
  refreshTokenTtlSeconds: 2592000,
};

const MINT_INPUT = {
  userId: "user-123",
  githubLogin: "testuser",
  clientType: "mobile" as const,
  clientId: "client-abc",
  scopes: ["read:status", "read:sessions"],
};

describe("TokenService", () => {
  let svc: TokenService;

  beforeEach(() => {
    svc = new TokenService(TEST_CONFIG);
  });

  // --- Happy path ---

  it("mints and verifies an access token (happy path)", () => {
    const token = svc.mintAccessToken(MINT_INPUT);
    const claims = svc.verifyAccessToken(token);

    expect(claims).not.toBeNull();
    expect(claims!.sub).toBe(MINT_INPUT.userId);
    expect(claims!.github_login).toBe(MINT_INPUT.githubLogin);
    expect(claims!.client_type).toBe(MINT_INPUT.clientType);
    expect(claims!.client_id).toBe(MINT_INPUT.clientId);
    expect(claims!.scopes).toEqual(MINT_INPUT.scopes);
    expect(claims!.iss).toBe(TEST_CONFIG.jwtIssuer);
    expect(claims!.aud).toBe(TEST_CONFIG.jwtAudience);
  });

  it("mints and verifies a refresh token (happy path)", () => {
    const token = svc.mintRefreshToken("user-123", "testuser");
    const claims = svc.verifyRefreshToken(token);

    expect(claims).not.toBeNull();
    expect(claims!.sub).toBe("user-123");
    expect(claims!.github_login).toBe("testuser");
    expect(claims!.token_type).toBe("refresh");
    expect(claims!.iss).toBe(TEST_CONFIG.jwtIssuer);
    expect(claims!.aud).toBe(TEST_CONFIG.jwtAudience);
  });

  // --- Expiration ---

  it("rejects an expired access token", () => {
    const expiredSvc = new TokenService({
      ...TEST_CONFIG,
      accessTokenTtlSeconds: 0, // expires immediately
    });
    const token = expiredSvc.mintAccessToken(MINT_INPUT);

    // jwt.sign with expiresIn:0 sets exp = iat, so it's already expired
    const claims = expiredSvc.verifyAccessToken(token);
    expect(claims).toBeNull();
  });

  it("rejects an expired refresh token", () => {
    const expiredSvc = new TokenService({
      ...TEST_CONFIG,
      refreshTokenTtlSeconds: 0,
    });
    const token = expiredSvc.mintRefreshToken("user-123", "testuser");

    const claims = expiredSvc.verifyRefreshToken(token);
    expect(claims).toBeNull();
  });

  // --- Wrong issuer / audience ---

  it("rejects a token with wrong issuer", () => {
    const token = svc.mintAccessToken(MINT_INPUT);

    const otherSvc = new TokenService({
      ...TEST_CONFIG,
      jwtIssuer: "wrong-issuer",
    });
    const claims = otherSvc.verifyAccessToken(token);
    expect(claims).toBeNull();
  });

  it("rejects a token with wrong audience", () => {
    const token = svc.mintAccessToken(MINT_INPUT);

    const otherSvc = new TokenService({
      ...TEST_CONFIG,
      jwtAudience: "wrong-audience",
    });
    const claims = otherSvc.verifyAccessToken(token);
    expect(claims).toBeNull();
  });

  // --- Token type mismatch ---

  it("rejects an access token when verifying as refresh (wrong token_type)", () => {
    const token = svc.mintAccessToken(MINT_INPUT);

    // Access tokens don't have token_type === "refresh"
    const claims = svc.verifyRefreshToken(token);
    expect(claims).toBeNull();
  });

  // --- Malformed tokens ---

  it("rejects malformed / invalid tokens", () => {
    expect(svc.verifyAccessToken("not-a-jwt")).toBeNull();
    expect(svc.verifyRefreshToken("not-a-jwt")).toBeNull();
    expect(svc.verifyAccessToken("")).toBeNull();
    expect(svc.verifyRefreshToken("")).toBeNull();

    // Token signed with different secret
    const wrongSecretToken = jwt.sign({ sub: "x" }, "wrong-secret", {
      algorithm: "HS256",
    });
    expect(svc.verifyAccessToken(wrongSecretToken)).toBeNull();
    expect(svc.verifyRefreshToken(wrongSecretToken)).toBeNull();
  });

  // --- Full claims verification ---

  it("includes all AccessTokenClaims fields in a minted token", () => {
    const token = svc.mintAccessToken(MINT_INPUT);
    const decoded = jwt.decode(token) as AccessTokenClaims;

    // Required fields from AccessTokenClaims interface
    expect(decoded.sub).toBe(MINT_INPUT.userId);
    expect(typeof decoded.iat).toBe("number");
    expect(typeof decoded.exp).toBe("number");
    expect(typeof decoded.jti).toBe("string");
    expect(decoded.jti.length).toBeGreaterThan(0);
    expect(decoded.client_id).toBe(MINT_INPUT.clientId);
    expect(decoded.client_type).toBe(MINT_INPUT.clientType);
    expect(decoded.scopes).toEqual(MINT_INPUT.scopes);
    expect(decoded.github_login).toBe(MINT_INPUT.githubLogin);
    expect(decoded.iss).toBe(TEST_CONFIG.jwtIssuer);
    expect(decoded.aud).toBe(TEST_CONFIG.jwtAudience);

    // exp should be iat + TTL
    expect(decoded.exp - decoded.iat).toBe(TEST_CONFIG.accessTokenTtlSeconds);
  });
});
