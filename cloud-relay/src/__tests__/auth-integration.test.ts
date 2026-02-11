import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { TokenService } from "../tokenService";
import { createAuthRouter } from "../auth";
import { DEFAULT_MOBILE_SCOPES, DEFAULT_EXTENSION_SCOPES } from "../types";
import type { AccessTokenClaims } from "../types";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const TEST_SECRET = "test-secret-for-integration";

const TEST_CONFIG = {
  jwtSecret: TEST_SECRET,
  jwtIssuer: "test-relay",
  jwtAudience: "test-audience",
  accessTokenTtlSeconds: 3600,
  refreshTokenTtlSeconds: 2592000,
};

const MOCK_GH_USER = {
  id: 12345,
  login: "testuser",
  avatar_url: "https://example.com/avatar.png",
};

const ALLOWED_ORIGIN = "https://allowed-origin.example.com";

function createTestApp(tokenService: TokenService): express.Express {
  const app = express();
  app.use(express.json());
  app.use("/auth", createAuthRouter(tokenService));
  return app;
}

/** Helper: mock a successful GitHub token exchange followed by user fetch. */
function mockGitHubTokenAndUser(
  mockFetch: jest.SpyInstance,
  ghToken = "gh_test_token",
  user = MOCK_GH_USER,
) {
  // 1st call — POST /login/oauth/access_token
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ access_token: ghToken }),
  } as Response);

  // 2nd call — GET /user
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => user,
  } as Response);
}

/** Helper: mock only a GitHub user fetch (for /exchange). */
function mockGitHubUser(
  mockFetch: jest.SpyInstance,
  user: typeof MOCK_GH_USER | null = MOCK_GH_USER,
) {
  if (user) {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => user,
    } as Response);
  } else {
    // Simulate invalid token → GitHub returns 401
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ message: "Bad credentials" }),
    } as Response);
  }
}

/** Helper: create a valid HMAC state for callback CSRF verification. */
function validState(tokenService: TokenService, nonce = "test-nonce"): string {
  const hmac = tokenService.hmacSign(nonce);
  return `${nonce}.${hmac}`;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Auth Integration (supertest)", () => {
  let tokenService: TokenService;
  let app: express.Express;
  let mockFetch: jest.SpyInstance;

  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    // Preserve any existing env values
    for (const key of [
      "GITHUB_CLIENT_ID",
      "GITHUB_CLIENT_SECRET",
      "GITHUB_REDIRECT_URI",
      "CORS_ORIGINS",
    ]) {
      savedEnv[key] = process.env[key];
    }

    process.env.GITHUB_CLIENT_ID = "test-client-id";
    process.env.GITHUB_CLIENT_SECRET = "test-client-secret";
    process.env.GITHUB_REDIRECT_URI = "http://localhost:5173/auth/callback";
    process.env.CORS_ORIGINS = ALLOWED_ORIGIN;

    tokenService = new TokenService(TEST_CONFIG);
    app = createTestApp(tokenService);
    mockFetch = jest.spyOn(global, "fetch");
  });

  afterEach(() => {
    mockFetch.mockRestore();
    // Restore original env
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  // =========================================================================
  // POST /auth/login
  // =========================================================================

  describe("POST /auth/login", () => {
    it("returns auth_url and state when given redirect_uri", async () => {
      const res = await request(app)
        .post("/auth/login")
        .send({ redirect_uri: "http://localhost:5173/auth/callback" });

      expect(res.status).toBe(200);
      expect(res.body.auth_url).toContain("https://github.com/login/oauth/authorize");
      expect(res.body.auth_url).toContain("client_id=test-client-id");
      expect(typeof res.body.state).toBe("string");
      expect(res.body.state.length).toBeGreaterThan(0);
    });

    it("uses GITHUB_REDIRECT_URI from env when redirect_uri not in body", async () => {
      const res = await request(app).post("/auth/login").send({});

      expect(res.status).toBe(200);
      expect(res.body.auth_url).toContain(
        encodeURIComponent("http://localhost:5173/auth/callback"),
      );
    });

    it("returns 500 when GITHUB_CLIENT_ID is not set", async () => {
      delete process.env.GITHUB_CLIENT_ID;

      const res = await request(app)
        .post("/auth/login")
        .send({ redirect_uri: "http://localhost:5173/auth/callback" });

      expect(res.status).toBe(500);
      expect(res.body.error).toContain("GITHUB_CLIENT_ID");
    });

    it("returns 400 when redirect_uri is missing and not in env", async () => {
      delete process.env.GITHUB_REDIRECT_URI;

      const res = await request(app).post("/auth/login").send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("redirect_uri");
    });

    it("includes HMAC-signed state", async () => {
      const res = await request(app)
        .post("/auth/login")
        .send({ redirect_uri: "http://localhost:5173/auth/callback" });

      const state: string = res.body.state;
      const dotIndex = state.lastIndexOf(".");
      expect(dotIndex).toBeGreaterThan(0);

      const nonce = state.substring(0, dotIndex);
      const hmac = state.substring(dotIndex + 1);
      const expectedHmac = tokenService.hmacSign(nonce);
      expect(hmac).toBe(expectedHmac);
    });
  });

  // =========================================================================
  // POST /auth/callback
  // =========================================================================

  describe("POST /auth/callback", () => {
    it("exchanges OAuth code for relay JWTs (happy path)", async () => {
      mockGitHubTokenAndUser(mockFetch);
      const state = validState(tokenService);

      const res = await request(app).post("/auth/callback").send({
        code: "gh-oauth-code",
        state,
        redirect_uri: "http://localhost:5173/auth/callback",
      });

      expect(res.status).toBe(200);
      expect(typeof res.body.access_token).toBe("string");
      expect(typeof res.body.refresh_token).toBe("string");
      expect(res.body.token_type).toBe("Bearer");
      expect(res.body.expires_in).toBe(3600);
      expect(res.body.user).toEqual({
        id: `github|${MOCK_GH_USER.id}`,
        login: MOCK_GH_USER.login,
        avatar_url: MOCK_GH_USER.avatar_url,
      });
    });

    it("JWT claims match AccessTokenClaims structure", async () => {
      mockGitHubTokenAndUser(mockFetch);
      const state = validState(tokenService);

      const res = await request(app).post("/auth/callback").send({
        code: "gh-oauth-code",
        state,
        redirect_uri: "http://localhost:5173/auth/callback",
      });

      const decoded = jwt.decode(res.body.access_token) as AccessTokenClaims;
      expect(decoded.sub).toBe(`github|${MOCK_GH_USER.id}`);
      expect(typeof decoded.jti).toBe("string");
      expect(decoded.client_type).toBe("mobile"); // default
      expect(decoded.github_login).toBe(MOCK_GH_USER.login);
      expect(decoded.iss).toBe(TEST_CONFIG.jwtIssuer);
      expect(decoded.aud).toBe(TEST_CONFIG.jwtAudience);
      expect(typeof decoded.iat).toBe("number");
      expect(typeof decoded.exp).toBe("number");
      expect(decoded.scopes).toEqual(DEFAULT_MOBILE_SCOPES);
    });

    it("assigns mobile scopes by default", async () => {
      mockGitHubTokenAndUser(mockFetch);

      const res = await request(app).post("/auth/callback").send({
        code: "gh-oauth-code",
        state: validState(tokenService),
        redirect_uri: "http://localhost:5173/auth/callback",
      });

      expect(res.body.scopes).toEqual(DEFAULT_MOBILE_SCOPES);
    });

    it("assigns extension scopes when client_type is extension", async () => {
      mockGitHubTokenAndUser(mockFetch);

      const res = await request(app).post("/auth/callback").send({
        code: "gh-oauth-code",
        state: validState(tokenService),
        redirect_uri: "http://localhost:5173/auth/callback",
        client_type: "extension",
      });

      expect(res.body.scopes).toEqual(DEFAULT_EXTENSION_SCOPES);
      const decoded = jwt.decode(res.body.access_token) as AccessTokenClaims;
      expect(decoded.client_type).toBe("extension");
      expect(decoded.scopes).toEqual(DEFAULT_EXTENSION_SCOPES);
    });

    it("returns 400 when code is missing", async () => {
      const res = await request(app).post("/auth/callback").send({
        state: validState(tokenService),
        redirect_uri: "http://localhost:5173/auth/callback",
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("code");
    });

    it("returns 400 on invalid HMAC state", async () => {
      const res = await request(app).post("/auth/callback").send({
        code: "gh-oauth-code",
        state: "nonce.invalidhmac",
        redirect_uri: "http://localhost:5173/auth/callback",
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("state");
    });

    it("returns 502 when GitHub token exchange HTTP fails", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        text: async () => "Service Unavailable",
      } as Response);

      const res = await request(app).post("/auth/callback").send({
        code: "gh-oauth-code",
        state: validState(tokenService),
        redirect_uri: "http://localhost:5173/auth/callback",
      });

      expect(res.status).toBe(502);
      expect(res.body.error).toContain("GitHub token exchange failed");
    });

    it("returns 400 when GitHub responds with error in body", async () => {
      // GitHub returns 200 OK but body contains an error field
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          error: "bad_verification_code",
          error_description: "The code passed is incorrect or expired.",
        }),
      } as Response);

      const res = await request(app).post("/auth/callback").send({
        code: "bad-code",
        state: validState(tokenService),
        redirect_uri: "http://localhost:5173/auth/callback",
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("bad_verification_code");
      expect(res.body.error_description).toContain("incorrect or expired");
    });

    it("returns 502 when fetchGitHubUser fails", async () => {
      // Token exchange succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "gh_test_token" }),
      } as Response);

      // User fetch fails
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ message: "Bad credentials" }),
      } as Response);

      const res = await request(app).post("/auth/callback").send({
        code: "gh-oauth-code",
        state: validState(tokenService),
        redirect_uri: "http://localhost:5173/auth/callback",
      });

      expect(res.status).toBe(502);
      expect(res.body.error).toContain("GitHub user profile");
    });

    it("returns 400 when redirect_uri is missing and env is unset", async () => {
      delete process.env.GITHUB_REDIRECT_URI;

      const res = await request(app).post("/auth/callback").send({
        code: "gh-oauth-code",
        state: validState(tokenService),
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("redirect_uri");
    });

    it("returns 500 when GITHUB_CLIENT_SECRET is not set", async () => {
      delete process.env.GITHUB_CLIENT_SECRET;

      const res = await request(app).post("/auth/callback").send({
        code: "gh-oauth-code",
        state: validState(tokenService),
        redirect_uri: "http://localhost:5173/auth/callback",
      });

      expect(res.status).toBe(500);
      expect(res.body.error).toContain("GITHUB_CLIENT_SECRET");
    });
  });

  // =========================================================================
  // POST /auth/exchange
  // =========================================================================

  describe("POST /auth/exchange", () => {
    it("exchanges GitHub token for relay JWTs (happy path)", async () => {
      mockGitHubUser(mockFetch);

      const res = await request(app).post("/auth/exchange").send({
        github_token: "gh_valid_token",
      });

      expect(res.status).toBe(200);
      expect(typeof res.body.access_token).toBe("string");
      expect(typeof res.body.refresh_token).toBe("string");
      expect(res.body.token_type).toBe("Bearer");
      expect(res.body.expires_in).toBe(3600);
      expect(res.body.user).toEqual({
        id: `github|${MOCK_GH_USER.id}`,
        login: MOCK_GH_USER.login,
        avatar_url: MOCK_GH_USER.avatar_url,
      });
    });

    it("assigns extension scopes for client_type=extension", async () => {
      mockGitHubUser(mockFetch);

      const res = await request(app).post("/auth/exchange").send({
        github_token: "gh_valid_token",
        client_type: "extension",
      });

      expect(res.status).toBe(200);
      expect(res.body.scopes).toEqual(DEFAULT_EXTENSION_SCOPES);

      const decoded = jwt.decode(res.body.access_token) as AccessTokenClaims;
      expect(decoded.client_type).toBe("extension");
      expect(decoded.scopes).toEqual(DEFAULT_EXTENSION_SCOPES);
    });

    it("assigns mobile scopes by default", async () => {
      mockGitHubUser(mockFetch);

      const res = await request(app).post("/auth/exchange").send({
        github_token: "gh_valid_token",
      });

      expect(res.body.scopes).toEqual(DEFAULT_MOBILE_SCOPES);
    });

    it("returns 400 when github_token is missing", async () => {
      const res = await request(app).post("/auth/exchange").send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("github_token");
    });

    it("returns 401 when GitHub token is invalid", async () => {
      mockGitHubUser(mockFetch, null);

      const res = await request(app).post("/auth/exchange").send({
        github_token: "gh_invalid_token",
      });

      expect(res.status).toBe(401);
      expect(res.body.error).toContain("Invalid GitHub token");
    });
  });

  // =========================================================================
  // POST /auth/refresh
  // =========================================================================

  describe("POST /auth/refresh", () => {
    it("rotates tokens (happy path)", async () => {
      const originalRefresh = tokenService.mintRefreshToken(
        `github|${MOCK_GH_USER.id}`,
        MOCK_GH_USER.login,
      );

      const res = await request(app).post("/auth/refresh").send({
        refresh_token: originalRefresh,
      });

      expect(res.status).toBe(200);
      expect(typeof res.body.access_token).toBe("string");
      expect(typeof res.body.refresh_token).toBe("string");
      expect(res.body.token_type).toBe("Bearer");
      expect(res.body.expires_in).toBe(3600);
      // New refresh token should be different from the original
      expect(res.body.refresh_token).not.toBe(originalRefresh);
    });

    it("preserves sub and github_login in rotated tokens", async () => {
      const userId = `github|${MOCK_GH_USER.id}`;
      const originalRefresh = tokenService.mintRefreshToken(userId, MOCK_GH_USER.login);

      const res = await request(app).post("/auth/refresh").send({
        refresh_token: originalRefresh,
      });

      const decoded = jwt.decode(res.body.access_token) as AccessTokenClaims;
      expect(decoded.sub).toBe(userId);
      expect(decoded.github_login).toBe(MOCK_GH_USER.login);
    });

    it("returns 400 when refresh_token is missing", async () => {
      const res = await request(app).post("/auth/refresh").send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("refresh_token");
    });

    it("returns 401 on invalid refresh token", async () => {
      const res = await request(app).post("/auth/refresh").send({
        refresh_token: "not-a-valid-jwt",
      });

      expect(res.status).toBe(401);
      expect(res.body.error).toContain("Invalid or expired");
    });

    it("returns 401 when refresh token signed with wrong secret", async () => {
      const wrongSvc = new TokenService({ jwtSecret: "wrong-secret" });
      const badToken = wrongSvc.mintRefreshToken("user-1", "login");

      const res = await request(app).post("/auth/refresh").send({
        refresh_token: badToken,
      });

      expect(res.status).toBe(401);
    });
  });

  // =========================================================================
  // POST /auth/revoke
  // =========================================================================

  describe("POST /auth/revoke", () => {
    it("returns { revoked: true }", async () => {
      const res = await request(app).post("/auth/revoke").send({});

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ revoked: true });
    });
  });

  // =========================================================================
  // CORS middleware
  // =========================================================================

  describe("CORS", () => {
    it("sets Access-Control-Allow-Origin for allowed origin", async () => {
      const res = await request(app)
        .post("/auth/revoke")
        .set("Origin", ALLOWED_ORIGIN)
        .send({});

      expect(res.headers["access-control-allow-origin"]).toBe(ALLOWED_ORIGIN);
    });

    it("does NOT set Access-Control-Allow-Origin for disallowed origin", async () => {
      const res = await request(app)
        .post("/auth/revoke")
        .set("Origin", "https://evil.example.com")
        .send({});

      expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    });

    it("responds 204 to OPTIONS preflight for allowed origin", async () => {
      const res = await request(app)
        .options("/auth/revoke")
        .set("Origin", ALLOWED_ORIGIN);

      expect(res.status).toBe(204);
      expect(res.headers["access-control-allow-origin"]).toBe(ALLOWED_ORIGIN);
      expect(res.headers["access-control-allow-methods"]).toContain("POST");
    });
  });
});
