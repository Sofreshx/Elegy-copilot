import { Router, Request, Response, NextFunction } from "express";
import { v4 as uuidv4 } from "uuid";
import { RelayDatabase } from "./database";
import { TokenService } from "./tokenService";

/**
 * Session History API Router
 *
 * Provides CRUD endpoints for agent session history, backed by SQLite.
 * All endpoints require Bearer JWT authentication. Users can only
 * access their own sessions.
 */
export function createSessionRouter(db: RelayDatabase, tokenService: TokenService): Router {
  const router = Router();

  // Auth middleware — every route requires a valid access token
  const requireAuth = (req: Request, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Bearer token required" });
      return;
    }
    const token = authHeader.slice(7);
    const claims = tokenService.verifyAccessToken(token);
    if (!claims) {
      res.status(401).json({ error: "Invalid or expired token" });
      return;
    }
    (req as any).claims = claims;
    next();
  };

  router.use(requireAuth);

  // GET /sessions — list sessions for the authenticated user
  router.get("/sessions", (req: Request, res: Response): void => {
    const claims = (req as any).claims;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = parseInt(req.query.offset as string) || 0;
    const status = req.query.status as string | undefined;

    const sqlite = db.getDb();
    let query = "SELECT * FROM sessions WHERE user_id = ?";
    const params: any[] = [claims.sub];

    if (status) {
      query += " AND status = ?";
      params.push(status);
    }

    query += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
    params.push(limit, offset);

    const sessions = sqlite.prepare(query).all(...params);
    const totalRow = sqlite
      .prepare(
        "SELECT COUNT(*) as count FROM sessions WHERE user_id = ?" +
          (status ? " AND status = ?" : ""),
      )
      .get(...(status ? [claims.sub, status] : [claims.sub])) as { count: number };

    res.json({ sessions, total: totalRow.count, limit, offset });
  });

  // GET /sessions/:id — get a specific session
  router.get("/sessions/:id", (req: Request, res: Response): void => {
    const claims = (req as any).claims;
    const session = db
      .getDb()
      .prepare("SELECT * FROM sessions WHERE id = ? AND user_id = ?")
      .get(req.params.id, claims.sub);

    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    res.json(session);
  });

  // POST /sessions — create a new session
  router.post("/sessions", (req: Request, res: Response): void => {
    const claims = (req as any).claims;
    const { agent_name, prompt, metadata } = req.body;

    if (!agent_name) {
      res.status(400).json({ error: "agent_name is required" });
      return;
    }

    const id = uuidv4();
    const now = new Date().toISOString();

    // Ensure user exists in users table (upsert)
    db.getDb()
      .prepare(
        "INSERT INTO users (id, github_login, last_seen_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET last_seen_at = ?",
      )
      .run(claims.sub, claims.github_login, now, now);

    db.getDb()
      .prepare(
        "INSERT INTO sessions (id, user_id, client_id, agent_name, prompt, status, started_at, metadata) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)",
      )
      .run(
        id,
        claims.sub,
        claims.client_id,
        agent_name,
        prompt || null,
        now,
        metadata ? JSON.stringify(metadata) : null,
      );

    const session = db.getDb().prepare("SELECT * FROM sessions WHERE id = ?").get(id);
    res.status(201).json(session);
  });

  // PUT /sessions/:id — update session status
  router.put("/sessions/:id", (req: Request, res: Response): void => {
    const claims = (req as any).claims;
    const { status, error: errorMsg, metadata } = req.body;

    const validStatuses = ["pending", "active", "completed", "failed", "cancelled"];
    if (status && !validStatuses.includes(status)) {
      res
        .status(400)
        .json({ error: `Invalid status. Must be one of: ${validStatuses.join(", ")}` });
      return;
    }

    // Verify session belongs to user
    const existing = db
      .getDb()
      .prepare("SELECT * FROM sessions WHERE id = ? AND user_id = ?")
      .get(req.params.id, claims.sub);

    if (!existing) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    const updates: string[] = [];
    const params: any[] = [];

    if (status) {
      updates.push("status = ?");
      params.push(status);
      if (status === "completed" || status === "failed") {
        updates.push("completed_at = ?");
        params.push(new Date().toISOString());
      }
    }
    if (errorMsg !== undefined) {
      updates.push("error = ?");
      params.push(errorMsg);
    }
    if (metadata !== undefined) {
      updates.push("metadata = ?");
      params.push(JSON.stringify(metadata));
    }

    if (updates.length === 0) {
      res.status(400).json({ error: "No valid fields to update" });
      return;
    }

    params.push(req.params.id, claims.sub);
    db.getDb()
      .prepare(`UPDATE sessions SET ${updates.join(", ")} WHERE id = ? AND user_id = ?`)
      .run(...params);

    const updated = db.getDb().prepare("SELECT * FROM sessions WHERE id = ?").get(req.params.id);
    res.json(updated);
  });

  return router;
}
