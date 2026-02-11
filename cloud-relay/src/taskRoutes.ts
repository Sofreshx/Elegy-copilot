/**
 * Task Queue REST API
 *
 * CRUD endpoints for the task_queue table, used by the mobile companion
 * to manage coding tasks dispatched to VS Code extension clients.
 */

import { Router, Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { RelayDatabase } from "./database";
import { TokenService } from "./tokenService";

export function createTaskRouter(
  db: RelayDatabase,
  tokenService: TokenService
): Router {
  const router = Router();

  // ---------------------------------------------------------------------------
  // Auth middleware — reject requests without a valid Bearer JWT
  // ---------------------------------------------------------------------------

  const requireAuth = (req: Request, res: Response, next: Function) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Bearer token required" });
    }
    const token = authHeader.slice(7);
    const claims = tokenService.verifyAccessToken(token);
    if (!claims) {
      return res.status(401).json({ error: "Invalid or expired token" });
    }
    (req as any).claims = claims;
    next();
  };

  router.use(requireAuth);

  // ---------------------------------------------------------------------------
  // GET /tasks — list tasks for the authenticated user
  // ---------------------------------------------------------------------------

  router.get("/tasks", (req: Request, res: Response) => {
    const claims = (req as any).claims;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = parseInt(req.query.offset as string) || 0;
    const status = req.query.status as string | undefined;
    const priority = req.query.priority as string | undefined;

    let query = "SELECT * FROM task_queue WHERE user_id = ?";
    const params: any[] = [claims.sub];

    if (status) {
      query += " AND status = ?";
      params.push(status);
    }
    if (priority) {
      query += " AND priority = ?";
      params.push(parseInt(priority));
    }

    query += " ORDER BY priority DESC, created_at DESC LIMIT ? OFFSET ?";
    params.push(limit, offset);

    const tasks = db.getDb().prepare(query).all(...params);

    // Total count (same filters, no LIMIT/OFFSET)
    let countQuery = "SELECT COUNT(*) as count FROM task_queue WHERE user_id = ?";
    const countParams: any[] = [claims.sub];
    if (status) {
      countQuery += " AND status = ?";
      countParams.push(status);
    }
    if (priority) {
      countQuery += " AND priority = ?";
      countParams.push(parseInt(priority));
    }
    const totalRow = db
      .getDb()
      .prepare(countQuery)
      .get(...countParams) as { count: number };

    res.json({ tasks, total: totalRow.count, limit, offset });
  });

  // ---------------------------------------------------------------------------
  // GET /tasks/:id — single task detail
  // ---------------------------------------------------------------------------

  router.get("/tasks/:id", (req: Request, res: Response) => {
    const claims = (req as any).claims;
    const task = db
      .getDb()
      .prepare("SELECT * FROM task_queue WHERE id = ? AND user_id = ?")
      .get(req.params.id, claims.sub);
    if (!task) return res.status(404).json({ error: "Task not found" });
    res.json(task);
  });

  // ---------------------------------------------------------------------------
  // POST /tasks — create a new task
  // ---------------------------------------------------------------------------

  router.post("/tasks", (req: Request, res: Response) => {
    const claims = (req as any).claims;
    const { title, description, priority } = req.body;
    if (!title) return res.status(400).json({ error: "title is required" });

    const id = uuidv4();
    const now = new Date().toISOString();

    // Ensure the user row exists (upsert)
    db.getDb()
      .prepare(
        "INSERT INTO users (id, github_login, last_seen_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET last_seen_at = ?"
      )
      .run(claims.sub, claims.github_login, now, now);

    db.getDb()
      .prepare(
        "INSERT INTO task_queue (id, user_id, title, description, priority, status, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)"
      )
      .run(id, claims.sub, title, description || null, priority ?? 1, now);

    const task = db
      .getDb()
      .prepare("SELECT * FROM task_queue WHERE id = ?")
      .get(id);
    res.status(201).json(task);
  });

  // ---------------------------------------------------------------------------
  // PUT /tasks/:id — update an existing task
  // ---------------------------------------------------------------------------

  router.put("/tasks/:id", (req: Request, res: Response) => {
    const claims = (req as any).claims;
    const {
      title,
      description,
      priority,
      status,
      assigned_client_id,
      result,
    } = req.body;

    const existing = db
      .getDb()
      .prepare("SELECT * FROM task_queue WHERE id = ? AND user_id = ?")
      .get(req.params.id, claims.sub);
    if (!existing) return res.status(404).json({ error: "Task not found" });

    const validStatuses = [
      "pending",
      "in-progress",
      "completed",
      "failed",
      "cancelled",
    ];
    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({
        error: `Invalid status. Must be one of: ${validStatuses.join(", ")}`,
      });
    }

    const updates: string[] = [];
    const params: any[] = [];

    if (title !== undefined) {
      updates.push("title = ?");
      params.push(title);
    }
    if (description !== undefined) {
      updates.push("description = ?");
      params.push(description);
    }
    if (priority !== undefined) {
      updates.push("priority = ?");
      params.push(priority);
    }
    if (status !== undefined) {
      updates.push("status = ?");
      params.push(status);
      if (status === "completed" || status === "failed") {
        updates.push("completed_at = ?");
        params.push(new Date().toISOString());
      }
    }
    if (assigned_client_id !== undefined) {
      updates.push("assigned_client_id = ?");
      params.push(assigned_client_id);
    }
    if (result !== undefined) {
      updates.push("result = ?");
      params.push(typeof result === "string" ? result : JSON.stringify(result));
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: "No valid fields to update" });
    }

    updates.push("updated_at = ?");
    params.push(new Date().toISOString());
    params.push(req.params.id, claims.sub);

    db.getDb()
      .prepare(
        `UPDATE task_queue SET ${updates.join(", ")} WHERE id = ? AND user_id = ?`
      )
      .run(...params);

    const updated = db
      .getDb()
      .prepare("SELECT * FROM task_queue WHERE id = ?")
      .get(req.params.id);
    res.json(updated);
  });

  // ---------------------------------------------------------------------------
  // DELETE /tasks/:id — delete / cancel a task
  // ---------------------------------------------------------------------------

  router.delete("/tasks/:id", (req: Request, res: Response) => {
    const claims = (req as any).claims;
    const existing = db
      .getDb()
      .prepare("SELECT * FROM task_queue WHERE id = ? AND user_id = ?")
      .get(req.params.id, claims.sub);
    if (!existing) return res.status(404).json({ error: "Task not found" });

    db.getDb()
      .prepare("DELETE FROM task_queue WHERE id = ? AND user_id = ?")
      .run(req.params.id, claims.sub);

    res.json({ deleted: true, id: req.params.id });
  });

  return router;
}
