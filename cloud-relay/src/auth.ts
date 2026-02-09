import type { Request, Response } from "express";
import { Router } from "express";
import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";
import { TokenService } from "./tokenService";
import { DEFAULT_MOBILE_SCOPES, DEFAULT_EXTENSION_SCOPES } from "./types";

const DEFAULT_SCOPES = ["read:user", "repo"];

export function normalizeScopes(scope: unknown): string[] {
  if (Array.isArray(scope)) {
    const normalized = scope.map((item) => String(item)).filter((value) => value.length > 0);
    return normalized.length > 0 ? normalized : DEFAULT_SCOPES;
  }
  if (typeof scope === "string") {
    const parts = scope.split(/\s+/).map((value) => value.trim()).filter(Boolean);
    return parts.length > 0 ? parts : DEFAULT_SCOPES;
  }
  return DEFAULT_SCOPES;
}

export function buildGithubAuthUrl(params: {
  clientId: string;
  redirectUri: string;
  scopes: string[];
  state: string;
}): string {
  const search = new URLSearchParams({
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    scope: params.scopes.join(" "),
    state: params.state,
  });
  return `https://github.com/login/oauth/authorize?${search.toString()}`;
}

function getRequiredEnv(res: Response, key: string): string | null {
  const value = process.env[key];
  if (!value) {
    res.status(500).json({ error: `${key} is not configured on the relay server.` });
    return null;
  }
  return value;
}

function resolveRedirectUri(input?: string): string | null {
  return input || process.env.GITHUB_REDIRECT_URI || null;
}

/**
 * Parse CORS_ORIGINS env var into an allowlist.
 * Default: "https://instruction-engine.pages.dev"
 */
function parseCorsOrigins(): string[] {
  const raw = process.env.CORS_ORIGINS || "https://instruction-engine.pages.dev";
  return raw.split(",").map((o) => o.trim()).filter(Boolean);
}

/**
 * Fetch the authenticated GitHub user profile.
 * Returns null if the token is invalid or the request fails.
 */
async function fetchGitHubUser(
  accessToken: string,
): Promise<{ id: number; login: string; avatar_url: string } | null> {
  try {
    const response = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "User-Agent": "instruction-engine-relay",
      },
    });
    if (!response.ok) {
      return null;
    }
    const data = (await response.json()) as Record<string, unknown>;
    if (typeof data.id !== "number" || typeof data.login !== "string") {
      return null;
    }
    return {
      id: data.id as number,
      login: data.login as string,
      avatar_url: typeof data.avatar_url === "string" ? data.avatar_url : "",
    };
  } catch {
    return null;
  }
}

function resolveClientType(input: unknown): "mobile" | "extension" {
  return input === "extension" ? "extension" : "mobile";
}

function resolveScopesForClientType(clientType: "mobile" | "extension"): string[] {
  return clientType === "extension" ? [...DEFAULT_EXTENSION_SCOPES] : [...DEFAULT_MOBILE_SCOPES];
}

export function createAuthRouter(tokenService: TokenService): Router {
  const router = Router();
  const allowedOrigins = parseCorsOrigins();

  // CORS middleware — restrict to configured origins
  router.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
    }
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");

    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }

    next();
  });

  // POST /auth/login — returns GitHub OAuth URL (unchanged)
  router.post("/login", (req: Request, res: Response) => {
    const clientId = getRequiredEnv(res, "GITHUB_CLIENT_ID");
    if (!clientId) {
      return;
    }

    const redirectUri = resolveRedirectUri(req.body?.redirect_uri);
    if (!redirectUri) {
      res.status(400).json({ error: "redirect_uri is required." });
      return;
    }

    const nonce = typeof req.body?.state === "string" && req.body.state.length > 0
      ? req.body.state
      : crypto.randomUUID();
    const hmac = tokenService.hmacSign(nonce);
    const state = `${nonce}.${hmac}`;
    const scopes = normalizeScopes(req.body?.scope);

    res.json({
      auth_url: buildGithubAuthUrl({
        clientId,
        redirectUri,
        scopes,
        state,
      }),
      state,
    });
  });

  // POST /auth/callback — exchange OAuth code for relay-minted JWTs
  router.post("/callback", async (req: Request, res: Response) => {
    const clientId = getRequiredEnv(res, "GITHUB_CLIENT_ID");
    const clientSecret = getRequiredEnv(res, "GITHUB_CLIENT_SECRET");
    if (!clientId || !clientSecret) {
      return;
    }

    // CSRF state verification (HMAC-signed)
    const stateParam = typeof req.body?.state === "string" ? req.body.state : "";
    if (stateParam) {
      const dotIndex = stateParam.lastIndexOf(".");
      if (dotIndex === -1) {
        res.status(400).json({ error: "Invalid state parameter." });
        return;
      }
      const stateNonce = stateParam.substring(0, dotIndex);
      const stateHmac = stateParam.substring(dotIndex + 1);
      const expectedHmac = tokenService.hmacSign(stateNonce);
      if (
        stateHmac.length !== expectedHmac.length ||
        !crypto.timingSafeEqual(Buffer.from(stateHmac, "hex"), Buffer.from(expectedHmac, "hex"))
      ) {
        res.status(400).json({ error: "Invalid state parameter (CSRF verification failed)." });
        return;
      }
    }

    const code = typeof req.body?.code === "string" ? req.body.code : "";
    if (!code) {
      res.status(400).json({ error: "code is required." });
      return;
    }

    const redirectUri = resolveRedirectUri(req.body?.redirect_uri);
    if (!redirectUri) {
      res.status(400).json({ error: "redirect_uri is required." });
      return;
    }

    try {
      // Exchange OAuth code for GitHub access token
      const ghResponse = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: redirectUri,
        }),
      });

      if (!ghResponse.ok) {
        const details = await ghResponse.text();
        res.status(502).json({ error: "GitHub token exchange failed.", details });
        return;
      }

      const ghData = (await ghResponse.json()) as Record<string, unknown>;
      if (typeof ghData.error === "string") {
        res.status(400).json({
          error: ghData.error,
          error_description: typeof ghData.error_description === "string"
            ? ghData.error_description
            : undefined,
        });
        return;
      }

      const ghAccessToken = ghData.access_token;
      if (typeof ghAccessToken !== "string") {
        res.status(502).json({ error: "GitHub did not return an access_token." });
        return;
      }

      // Fetch GitHub user profile
      const ghUser = await fetchGitHubUser(ghAccessToken);
      if (!ghUser) {
        res.status(502).json({ error: "Failed to fetch GitHub user profile." });
        return;
      }

      // Mint relay tokens
      const clientType = resolveClientType(req.body?.client_type);
      const scopes = resolveScopesForClientType(clientType);
      const relayClientId = uuidv4();
      const userId = `github|${ghUser.id}`;

      const accessToken = tokenService.mintAccessToken({
        userId,
        githubLogin: ghUser.login,
        clientType,
        clientId: relayClientId,
        scopes,
      });
      const refreshToken = tokenService.mintRefreshToken(userId, ghUser.login);

      res.json({
        access_token: accessToken,
        refresh_token: refreshToken,
        token_type: "Bearer",
        expires_in: 3600,
        scopes,
        user: {
          id: userId,
          login: ghUser.login,
          avatar_url: ghUser.avatar_url,
        },
      });
    } catch {
      res.status(500).json({ error: "Unexpected token exchange error." });
    }
  });

  // POST /auth/refresh — rotate tokens
  router.post("/refresh", (req: Request, res: Response) => {
    const refreshTokenStr = typeof req.body?.refresh_token === "string" ? req.body.refresh_token : "";
    if (!refreshTokenStr) {
      res.status(400).json({ error: "refresh_token is required." });
      return;
    }

    const claims = tokenService.verifyRefreshToken(refreshTokenStr);
    if (!claims) {
      res.status(401).json({ error: "Invalid or expired refresh token." });
      return;
    }

    const clientType = resolveClientType(req.body?.client_type);
    const scopes = resolveScopesForClientType(clientType);
    const relayClientId = uuidv4();

    const accessToken = tokenService.mintAccessToken({
      userId: claims.sub,
      githubLogin: claims.github_login,
      clientType,
      clientId: relayClientId,
      scopes,
    });
    const refreshToken = tokenService.mintRefreshToken(claims.sub, claims.github_login);

    res.json({
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: "Bearer",
      expires_in: 3600,
      scopes,
    });
  });

  // POST /auth/exchange — exchange a GitHub token for relay JWTs (VS Code extension flow)
  router.post("/exchange", async (req: Request, res: Response) => {
    const githubToken = typeof req.body?.github_token === "string" ? req.body.github_token : "";
    if (!githubToken) {
      res.status(400).json({ error: "github_token is required." });
      return;
    }

    const ghUser = await fetchGitHubUser(githubToken);
    if (!ghUser) {
      res.status(401).json({ error: "Invalid GitHub token." });
      return;
    }

    const clientType = resolveClientType(req.body?.client_type);
    const scopes = resolveScopesForClientType(clientType);
    const relayClientId = uuidv4();
    const userId = `github|${ghUser.id}`;

    const accessToken = tokenService.mintAccessToken({
      userId,
      githubLogin: ghUser.login,
      clientType,
      clientId: relayClientId,
      scopes,
    });
    const refreshToken = tokenService.mintRefreshToken(userId, ghUser.login);

    res.json({
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: "Bearer",
      expires_in: 3600,
      scopes,
      user: {
        id: userId,
        login: ghUser.login,
        avatar_url: ghUser.avatar_url,
      },
    });
  });

  // POST /auth/revoke — client-side cleanup only (stateless tokens cannot be truly revoked)
  router.post("/revoke", (_req: Request, res: Response) => {
    res.json({ revoked: true });
  });

  return router;
}
