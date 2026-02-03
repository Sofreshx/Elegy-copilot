import type { Request, Response } from "express";
import { Router } from "express";
import crypto from "crypto";

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

export function createAuthRouter(): Router {
  const router = Router();

  router.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");

    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }

    next();
  });

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

    const state = typeof req.body?.state === "string" && req.body.state.length > 0
      ? req.body.state
      : crypto.randomUUID();
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

  router.post("/callback", async (req: Request, res: Response) => {
    const clientId = getRequiredEnv(res, "GITHUB_CLIENT_ID");
    const clientSecret = getRequiredEnv(res, "GITHUB_CLIENT_SECRET");
    if (!clientId || !clientSecret) {
      return;
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
      const response = await fetch("https://github.com/login/oauth/access_token", {
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

      if (!response.ok) {
        const details = await response.text();
        res.status(502).json({ error: "GitHub token exchange failed.", details });
        return;
      }

      const data = await response.json() as Record<string, unknown>;
      if (typeof data.error === "string") {
        res.status(400).json({
          error: data.error,
          error_description: typeof data.error_description === "string"
            ? data.error_description
            : undefined,
        });
        return;
      }

      res.json(data);
    } catch (error) {
      res.status(500).json({ error: "Unexpected token exchange error." });
    }
  });

  return router;
}
