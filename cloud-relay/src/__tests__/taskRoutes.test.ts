import express from "express";
import request from "supertest";
import { TokenService } from "../tokenService";
import { RelayDatabase } from "../database";
import { createTaskRouter } from "../taskRoutes";
import path from "path";
import fs from "fs";
import os from "os";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const TEST_SECRET = "test-secret-for-tasks";

const TEST_CONFIG = {
  jwtSecret: TEST_SECRET,
  jwtIssuer: "test-relay",
  jwtAudience: "test-audience",
  accessTokenTtlSeconds: 3600,
  refreshTokenTtlSeconds: 2592000,
};

let database: RelayDatabase;
let tokenService: TokenService;
let app: express.Express;
let validToken: string;
let dbDir: string;

const USER_ID = "user-1";
const GITHUB_LOGIN = "testuser";

beforeAll(async () => {
  // Use a temp directory for each test run
  dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "relay-task-test-"));
  const dbPath = path.join(dbDir, "test.db");

  database = new RelayDatabase({ dbPath });
  await database.initialize();

  tokenService = new TokenService(TEST_CONFIG);

  validToken = tokenService.mintAccessToken({
    userId: USER_ID,
    githubLogin: GITHUB_LOGIN,
    clientType: "mobile",
    clientId: "client-1",
    scopes: ["read:status"],
  });

  app = express();
  app.use(express.json());
  app.use("/api", createTaskRouter(database, tokenService));
});

afterAll(async () => {
  await database.close();
  // Clean up temp db files
  try {
    fs.rmSync(dbDir, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
});

// Ensure a user row exists before task operations
beforeEach(() => {
  const now = new Date().toISOString();
  database
    .getDb()
    .prepare(
      "INSERT INTO users (id, github_login, last_seen_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET last_seen_at = ?"
    )
    .run(USER_ID, GITHUB_LOGIN, now, now);
});

afterEach(() => {
  // Clear task_queue between tests
  database.getDb().prepare("DELETE FROM task_queue").run();
});

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

describe("Task routes — auth", () => {
  it("rejects requests without a token", async () => {
    const res = await request(app).get("/api/tasks");
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Bearer token required/);
  });

  it("rejects requests with an invalid token", async () => {
    const res = await request(app)
      .get("/api/tasks")
      .set("Authorization", "Bearer invalid-token");
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Invalid or expired/);
  });
});

// ---------------------------------------------------------------------------
// POST /api/tasks
// ---------------------------------------------------------------------------

describe("POST /api/tasks", () => {
  it("creates a task with title only", async () => {
    const res = await request(app)
      .post("/api/tasks")
      .set("Authorization", `Bearer ${validToken}`)
      .send({ title: "My task" });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      title: "My task",
      status: "pending",
      user_id: USER_ID,
      priority: 1,
    });
    expect(res.body.id).toBeDefined();
  });

  it("creates a task with all fields", async () => {
    const res = await request(app)
      .post("/api/tasks")
      .set("Authorization", `Bearer ${validToken}`)
      .send({ title: "Full task", description: "Details", priority: 3 });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      title: "Full task",
      description: "Details",
      priority: 3,
    });
  });

  it("rejects creation without a title", async () => {
    const res = await request(app)
      .post("/api/tasks")
      .set("Authorization", `Bearer ${validToken}`)
      .send({ description: "No title" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/title is required/);
  });
});

// ---------------------------------------------------------------------------
// GET /api/tasks
// ---------------------------------------------------------------------------

describe("GET /api/tasks", () => {
  beforeEach(async () => {
    // Seed some tasks
    for (let i = 0; i < 3; i++) {
      await request(app)
        .post("/api/tasks")
        .set("Authorization", `Bearer ${validToken}`)
        .send({ title: `Task ${i}`, priority: i + 1 });
    }
  });

  it("lists tasks for the user", async () => {
    const res = await request(app)
      .get("/api/tasks")
      .set("Authorization", `Bearer ${validToken}`);

    expect(res.status).toBe(200);
    expect(res.body.tasks).toHaveLength(3);
    expect(res.body.total).toBe(3);
    // Highest priority first
    expect(res.body.tasks[0].priority).toBe(3);
  });

  it("filters by status", async () => {
    const res = await request(app)
      .get("/api/tasks?status=pending")
      .set("Authorization", `Bearer ${validToken}`);

    expect(res.status).toBe(200);
    expect(res.body.tasks).toHaveLength(3);
  });

  it("filters by priority", async () => {
    const res = await request(app)
      .get("/api/tasks?priority=2")
      .set("Authorization", `Bearer ${validToken}`);

    expect(res.status).toBe(200);
    expect(res.body.tasks).toHaveLength(1);
    expect(res.body.tasks[0].priority).toBe(2);
  });

  it("respects limit and offset", async () => {
    const res = await request(app)
      .get("/api/tasks?limit=2&offset=1")
      .set("Authorization", `Bearer ${validToken}`);

    expect(res.status).toBe(200);
    expect(res.body.tasks).toHaveLength(2);
    expect(res.body.total).toBe(3);
    expect(res.body.limit).toBe(2);
    expect(res.body.offset).toBe(1);
  });

  it("does not leak tasks from other users", async () => {
    const otherToken = tokenService.mintAccessToken({
      userId: "other-user",
      githubLogin: "otheruser",
      clientType: "mobile",
      clientId: "client-2",
      scopes: ["read:status"],
    });

    const res = await request(app)
      .get("/api/tasks")
      .set("Authorization", `Bearer ${otherToken}`);

    expect(res.status).toBe(200);
    expect(res.body.tasks).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// GET /api/tasks/:id
// ---------------------------------------------------------------------------

describe("GET /api/tasks/:id", () => {
  it("returns a single task by id", async () => {
    const createRes = await request(app)
      .post("/api/tasks")
      .set("Authorization", `Bearer ${validToken}`)
      .send({ title: "Detail task" });

    const id = createRes.body.id;

    const res = await request(app)
      .get(`/api/tasks/${id}`)
      .set("Authorization", `Bearer ${validToken}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(id);
    expect(res.body.title).toBe("Detail task");
  });

  it("returns 404 for unknown id", async () => {
    const res = await request(app)
      .get("/api/tasks/nonexistent")
      .set("Authorization", `Bearer ${validToken}`);

    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// PUT /api/tasks/:id
// ---------------------------------------------------------------------------

describe("PUT /api/tasks/:id", () => {
  let taskId: string;

  beforeEach(async () => {
    const createRes = await request(app)
      .post("/api/tasks")
      .set("Authorization", `Bearer ${validToken}`)
      .send({ title: "Original" });
    taskId = createRes.body.id;
  });

  it("updates the title", async () => {
    const res = await request(app)
      .put(`/api/tasks/${taskId}`)
      .set("Authorization", `Bearer ${validToken}`)
      .send({ title: "Updated" });

    expect(res.status).toBe(200);
    expect(res.body.title).toBe("Updated");
    expect(res.body.updated_at).toBeDefined();
  });

  it("sets completed_at when status is completed", async () => {
    const res = await request(app)
      .put(`/api/tasks/${taskId}`)
      .set("Authorization", `Bearer ${validToken}`)
      .send({ status: "completed" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("completed");
    expect(res.body.completed_at).toBeDefined();
  });

  it("sets completed_at when status is failed", async () => {
    const res = await request(app)
      .put(`/api/tasks/${taskId}`)
      .set("Authorization", `Bearer ${validToken}`)
      .send({ status: "failed", result: "Something went wrong" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("failed");
    expect(res.body.completed_at).toBeDefined();
    expect(res.body.result).toBe("Something went wrong");
  });

  it("rejects invalid status values", async () => {
    const res = await request(app)
      .put(`/api/tasks/${taskId}`)
      .set("Authorization", `Bearer ${validToken}`)
      .send({ status: "bogus" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid status/);
  });

  it("rejects empty update body", async () => {
    const res = await request(app)
      .put(`/api/tasks/${taskId}`)
      .set("Authorization", `Bearer ${validToken}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/No valid fields/);
  });

  it("returns 404 for another user's task", async () => {
    const otherToken = tokenService.mintAccessToken({
      userId: "other-user",
      githubLogin: "otheruser",
      clientType: "mobile",
      clientId: "client-2",
      scopes: ["read:status"],
    });

    const res = await request(app)
      .put(`/api/tasks/${taskId}`)
      .set("Authorization", `Bearer ${otherToken}`)
      .send({ title: "Hacked" });

    expect(res.status).toBe(404);
  });

  it("serialises object result as JSON string", async () => {
    const res = await request(app)
      .put(`/api/tasks/${taskId}`)
      .set("Authorization", `Bearer ${validToken}`)
      .send({ result: { foo: "bar" } });

    expect(res.status).toBe(200);
    expect(res.body.result).toBe('{"foo":"bar"}');
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/tasks/:id
// ---------------------------------------------------------------------------

describe("DELETE /api/tasks/:id", () => {
  it("deletes an existing task", async () => {
    const createRes = await request(app)
      .post("/api/tasks")
      .set("Authorization", `Bearer ${validToken}`)
      .send({ title: "To delete" });

    const id = createRes.body.id;

    const delRes = await request(app)
      .delete(`/api/tasks/${id}`)
      .set("Authorization", `Bearer ${validToken}`);

    expect(delRes.status).toBe(200);
    expect(delRes.body).toEqual({ deleted: true, id });

    // Verify it's gone
    const getRes = await request(app)
      .get(`/api/tasks/${id}`)
      .set("Authorization", `Bearer ${validToken}`);

    expect(getRes.status).toBe(404);
  });

  it("returns 404 for unknown id", async () => {
    const res = await request(app)
      .delete("/api/tasks/nonexistent")
      .set("Authorization", `Bearer ${validToken}`);

    expect(res.status).toBe(404);
  });
});
