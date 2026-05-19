import http from "http";
import { StatusServer, TrackerStatus } from "../statusServer";
import { TrackerConfig } from "../config";
import { GitSnapshot, TrackerEvent } from "../types";

function makeConfig(overrides: Partial<TrackerConfig> = {}): TrackerConfig {
  return {
    workspacePaths: ["/tmp/test"],
    relayTokenSource: "missing",
    watchIntervalMs: 5000,
    statusPort: 0, // port 0 = OS picks a free port
    obsidianNotePaths: [],
    obsidianPollIntervalMs: 5000,
    ...overrides,
  };
}

function makeEvent(type: TrackerEvent["type"] = "file_change"): TrackerEvent {
  return {
    type,
    timestamp: new Date().toISOString(),
    data: { path: "/tmp/test/file.ts" },
  };
}

function makeGitSnapshot(repo = "test-repo"): GitSnapshot {
  return {
    repo,
    branch: "main",
    ahead: 1,
    behind: 0,
    modified: 3,
    untracked: 2,
    lastChecked: new Date().toISOString(),
  };
}

async function fetch(
  url: string
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () =>
          resolve({ status: res.statusCode!, headers: res.headers, body })
        );
      })
      .on("error", reject);
  });
}

describe("StatusServer", () => {
  let server: StatusServer;
  let baseUrl: string;

  beforeEach(async () => {
    server = new StatusServer(makeConfig());
    await server.start();
    const port = server.getPort();
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await server.stop();
  });

  describe("GET /api/status", () => {
    it("returns JSON with expected shape", async () => {
      const res = await fetch(`${baseUrl}/api/status`);
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toBe("application/json");

      const data: TrackerStatus = JSON.parse(res.body);
      expect(data).toHaveProperty("uptime");
      expect(data).toHaveProperty("gitSnapshots");
      expect(data).toHaveProperty("recentEvents");
      expect(data).toHaveProperty("startedAt");
      expect(data).toHaveProperty("schemaVersion");
      expect(data).toHaveProperty("contractVersion");
      expect(data).toHaveProperty("relayTokenReadiness");
      expect(typeof data.uptime).toBe("number");
      expect(Array.isArray(data.gitSnapshots)).toBe(true);
      expect(Array.isArray(data.recentEvents)).toBe(true);
      expect(data.schemaVersion).toBe(1);
      expect(data.contractVersion).toBe("tracker_status_v1");
      expect(data.relayTokenReadiness).toEqual({
        contractVersion: 1,
        state: "missing",
        reasonCode: "relay_token_missing",
        deterministic: true,
        source: "missing",
      });
    });

    it("reflects updated git snapshots", async () => {
      server.updateGitSnapshots([makeGitSnapshot("repo-a")]);

      const res = await fetch(`${baseUrl}/api/status`);
      const data: TrackerStatus = JSON.parse(res.body);
      expect(data.gitSnapshots).toHaveLength(1);
      expect(data.gitSnapshots[0].repo).toBe("repo-a");
      expect(data.gitSnapshots[0].branch).toBe("main");
    });

    it("reflects updated relay token readiness", async () => {
      server.updateRelayTokenReadiness({
        contractVersion: 1,
        state: "ready",
        reasonCode: "relay_token_valid",
        deterministic: true,
        source: "env",
      });

      const res = await fetch(`${baseUrl}/api/status`);
      const data: TrackerStatus = JSON.parse(res.body);
      expect(data.relayTokenReadiness).toEqual({
        contractVersion: 1,
        state: "ready",
        reasonCode: "relay_token_valid",
        deterministic: true,
        source: "env",
      });
    });

    it("reflects pushed events", async () => {
      server.pushEvent(makeEvent("file_change"));
      server.pushEvent(makeEvent("git_update"));

      const res = await fetch(`${baseUrl}/api/status`);
      const data: TrackerStatus = JSON.parse(res.body);
      expect(data.recentEvents).toHaveLength(2);
      // Most recent first
      expect(data.recentEvents[0].type).toBe("git_update");
      expect(data.recentEvents[1].type).toBe("file_change");
    });
  });

  describe("GET /", () => {
    it("returns HTML", async () => {
      const res = await fetch(`${baseUrl}/`);
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toBe("text/html");
      expect(res.body).toContain("<!DOCTYPE html>");
      expect(res.body).toContain("Agent Tracker");
    });
  });

  describe("GET /index.html", () => {
    it("also returns the dashboard HTML", async () => {
      const res = await fetch(`${baseUrl}/index.html`);
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toBe("text/html");
      expect(res.body).toContain("Agent Tracker");
    });
  });

  describe("unknown routes", () => {
    it("returns 404", async () => {
      const res = await fetch(`${baseUrl}/nope`);
      expect(res.status).toBe(404);
      expect(res.body).toBe("Not found");
    });
  });

  describe("event buffer cap", () => {
    it("caps at 50 events", () => {
      for (let i = 0; i < 60; i++) {
        server.pushEvent(makeEvent("file_change"));
      }
      // Access via the API to verify
      return fetch(`${baseUrl}/api/status`).then((res) => {
        const data: TrackerStatus = JSON.parse(res.body);
        expect(data.recentEvents).toHaveLength(50);
      });
    });
  });
});
