import http from "http";
import { TrackerConfig } from "./config";
import { SessionSnapshot, GitSnapshot, TrackerEvent } from "./types";

export interface TrackerStatus {
  uptime: number;
  sessions: SessionSnapshot[];
  gitSnapshots: GitSnapshot[];
  connectedExtensions: number;
  recentEvents: TrackerEvent[];
  startedAt: string;
}

export class StatusServer {
  private server: http.Server | null = null;
  private config: TrackerConfig;
  private status: TrackerStatus;

  constructor(config: TrackerConfig) {
    this.config = config;
    this.status = {
      uptime: 0,
      sessions: [],
      gitSnapshots: [],
      connectedExtensions: 0,
      recentEvents: [],
      startedAt: new Date().toISOString(),
    };
  }

  /** Update status data (called by main to push state) */
  updateSessions(sessions: SessionSnapshot[]): void {
    this.status.sessions = sessions;
  }

  updateGitSnapshots(snapshots: GitSnapshot[]): void {
    this.status.gitSnapshots = snapshots;
  }

  updateExtensionCount(count: number): void {
    this.status.connectedExtensions = count;
  }

  pushEvent(event: TrackerEvent): void {
    this.status.recentEvents.unshift(event);
    if (this.status.recentEvents.length > 50) {
      this.status.recentEvents = this.status.recentEvents.slice(0, 50);
    }
  }

  /** Start the HTTP server */
  start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = http.createServer((req, res) => {
        if (req.url === "/api/status") {
          this.handleStatusApi(res);
        } else if (req.url === "/" || req.url === "/index.html") {
          this.handleDashboard(res);
        } else {
          res.writeHead(404);
          res.end("Not found");
        }
      });

      this.server.listen(this.config.statusPort, () => {
        console.log(
          `[Status] Dashboard at http://localhost:${this.config.statusPort}`
        );
        resolve();
      });
    });
  }

  /** Get the actual port the server is listening on (useful when port 0 is used) */
  getPort(): number | null {
    const addr = this.server?.address();
    if (addr && typeof addr === "object") {
      return addr.port;
    }
    return null;
  }

  private handleStatusApi(res: http.ServerResponse): void {
    this.status.uptime =
      (Date.now() - new Date(this.status.startedAt).getTime()) / 1000;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(this.status, null, 2));
  }

  private handleDashboard(res: http.ServerResponse): void {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Agent Tracker</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: system-ui; background: #1a1a2e; color: #e0e0e0; margin: 0; padding: 20px; }
    h1 { color: #64ffda; margin-bottom: 4px; }
    .subtitle { color: #888; margin-bottom: 20px; }
    .card { background: #16213e; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
    .card h2 { color: #64ffda; margin-top: 0; font-size: 14px; text-transform: uppercase; }
    .stat { display: inline-block; margin-right: 24px; }
    .stat-value { font-size: 24px; font-weight: bold; color: #fff; }
    .stat-label { font-size: 12px; color: #888; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; }
    .badge-active { background: #064e3b; color: #34d399; }
    .badge-done { background: #1e3a5f; color: #60a5fa; }
    .event-list { max-height: 300px; overflow-y: auto; }
    .event { padding: 4px 0; border-bottom: 1px solid #1e3a5f; font-size: 13px; }
    .event-type { color: #64ffda; }
    .event-time { color: #666; font-size: 11px; }
    table { width: 100%; border-collapse: collapse; }
    td, th { text-align: left; padding: 4px 8px; }
    th { color: #888; font-size: 12px; }
  </style>
</head>
<body>
  <h1>Agent Tracker</h1>
  <p class="subtitle">Local status dashboard &mdash; auto-refreshes every 3s</p>
  <div id="content">Loading...</div>
  <script>
    async function refresh() {
      try {
        const r = await fetch('/api/status');
        const d = await r.json();
        let h = '';
        // Overview
        h += '<div class="card"><h2>Overview</h2>';
        h += '<div class="stat"><div class="stat-value">' + Math.round(d.uptime) + 's</div><div class="stat-label">Uptime</div></div>';
        h += '<div class="stat"><div class="stat-value">' + d.connectedExtensions + '</div><div class="stat-label">Extensions</div></div>';
        h += '<div class="stat"><div class="stat-value">' + d.recentEvents.length + '</div><div class="stat-label">Events</div></div>';
        h += '</div>';
        // Sessions
        if (d.sessions.length > 0) {
          h += '<div class="card"><h2>Sessions</h2><table><tr><th>ID</th><th>Status</th><th>Tasks</th></tr>';
          d.sessions.forEach(function(s) {
            var ts = s.taskSummary;
            h += '<tr><td>' + s.id + '</td><td><span class="badge badge-' + s.status + '">' + s.status + '</span></td>';
            h += '<td>' + (ts ? ts.done + '/' + ts.total : '-') + '</td></tr>';
          });
          h += '</table></div>';
        }
        // Git
        if (d.gitSnapshots.length > 0) {
          h += '<div class="card"><h2>Git</h2><table><tr><th>Repo</th><th>Branch</th><th>Mod</th><th>Ahead</th></tr>';
          d.gitSnapshots.forEach(function(g) {
            h += '<tr><td>' + g.repo + '</td><td>' + g.branch + '</td><td>' + g.modified + '</td><td>' + g.ahead + '</td></tr>';
          });
          h += '</table></div>';
        }
        // Events
        h += '<div class="card"><h2>Recent Events</h2><div class="event-list">';
        d.recentEvents.slice(0, 20).forEach(function(e) {
          h += '<div class="event"><span class="event-type">' + e.type + '</span> <span class="event-time">' + new Date(e.timestamp).toLocaleTimeString() + '</span></div>';
        });
        h += '</div></div>';
        document.getElementById('content').innerHTML = h;
      } catch(e) { document.getElementById('content').innerHTML = 'Error: ' + e.message; }
    }
    refresh();
    setInterval(refresh, 3000);
  </script>
</body>
</html>`);
  }

  /** Stop the server */
  async stop(): Promise<void> {
    if (this.server) {
      await new Promise<void>((resolve) =>
        this.server!.close(() => resolve())
      );
      this.server = null;
      console.log("[Status] Server stopped");
    }
  }
}
