import http from "http";
import {
  TRACKER_TOKEN_READINESS_CONTRACT_VERSION,
  TrackerConfig,
  TrackerRelayTokenSource,
  TrackerTokenReadinessV1,
} from "./config";
import { GitSnapshot, TrackerEvent } from "./types";

const TRACKER_STATUS_CONTRACT_VERSION = "tracker_status_v1";
const LOOPBACK_HOST = "127.0.0.1";

function createMissingTokenReadiness(source: TrackerRelayTokenSource): TrackerTokenReadinessV1 {
  return {
    contractVersion: TRACKER_TOKEN_READINESS_CONTRACT_VERSION,
    state: "missing",
    reasonCode: "relay_token_missing",
    deterministic: true,
    source,
  };
}

export interface TrackerStatus {
  schemaVersion: 1;
  contractVersion: typeof TRACKER_STATUS_CONTRACT_VERSION;
  uptime: number;
  gitSnapshots: GitSnapshot[];
  connectedExtensions: number;
  recentEvents: TrackerEvent[];
  startedAt: string;
  relayTokenReadiness: TrackerTokenReadinessV1;
}

export class StatusServer {
  private server: http.Server | null = null;
  private config: TrackerConfig;
  private status: TrackerStatus;

  constructor(config: TrackerConfig, options: { relayTokenReadiness?: TrackerTokenReadinessV1 } = {}) {
    this.config = config;
    this.status = {
      schemaVersion: 1,
      contractVersion: TRACKER_STATUS_CONTRACT_VERSION,
      uptime: 0,
      gitSnapshots: [],
      connectedExtensions: 0,
      recentEvents: [],
      startedAt: new Date().toISOString(),
      relayTokenReadiness: options.relayTokenReadiness ?? createMissingTokenReadiness(config.relayTokenSource),
    };
  }

  updateRelayTokenReadiness(readiness: TrackerTokenReadinessV1): void {
    this.status.relayTokenReadiness = {
      ...readiness,
      contractVersion: TRACKER_TOKEN_READINESS_CONTRACT_VERSION,
      deterministic: true,
    };
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

      this.server.listen(this.config.statusPort, LOOPBACK_HOST, () => {
        console.log(
          `[Status] Dashboard at http://${LOOPBACK_HOST}:${this.config.statusPort}`
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
    const content = document.getElementById('content');

    function createCard(title) {
      const card = document.createElement('div');
      card.className = 'card';
      const heading = document.createElement('h2');
      heading.textContent = title;
      card.appendChild(heading);
      return card;
    }

    function createStat(value, label) {
      const stat = document.createElement('div');
      stat.className = 'stat';
      const statValue = document.createElement('div');
      statValue.className = 'stat-value';
      statValue.textContent = value;
      const statLabel = document.createElement('div');
      statLabel.className = 'stat-label';
      statLabel.textContent = label;
      stat.appendChild(statValue);
      stat.appendChild(statLabel);
      return stat;
    }

    async function refresh() {
      try {
        const r = await fetch('/api/status');
        const d = await r.json();
        const fragment = document.createDocumentFragment();

        const overviewCard = createCard('Overview');
        overviewCard.appendChild(createStat(Math.round(d.uptime) + 's', 'Uptime'));
        overviewCard.appendChild(createStat(String(d.connectedExtensions), 'Extensions'));
        overviewCard.appendChild(createStat(String(d.recentEvents.length), 'Events'));
        fragment.appendChild(overviewCard);

        if (d.gitSnapshots.length > 0) {
          const gitCard = createCard('Git');
          const table = document.createElement('table');
          const headerRow = document.createElement('tr');
          ['Repo', 'Branch', 'Mod', 'Ahead'].forEach(function(label) {
            const th = document.createElement('th');
            th.textContent = label;
            headerRow.appendChild(th);
          });
          table.appendChild(headerRow);
          d.gitSnapshots.forEach(function(g) {
            const row = document.createElement('tr');
            [g.repo, g.branch, String(g.modified), String(g.ahead)].forEach(function(value) {
              const td = document.createElement('td');
              td.textContent = value;
              row.appendChild(td);
            });
            table.appendChild(row);
          });
          gitCard.appendChild(table);
          fragment.appendChild(gitCard);
        }

        const eventsCard = createCard('Recent Events');
        const eventList = document.createElement('div');
        eventList.className = 'event-list';
        d.recentEvents.slice(0, 20).forEach(function(e) {
          const eventRow = document.createElement('div');
          eventRow.className = 'event';

          const eventType = document.createElement('span');
          eventType.className = 'event-type';
          eventType.textContent = e.type;

          const spacer = document.createTextNode(' ');

          const eventTime = document.createElement('span');
          eventTime.className = 'event-time';
          eventTime.textContent = new Date(e.timestamp).toLocaleTimeString();

          eventRow.appendChild(eventType);
          eventRow.appendChild(spacer);
          eventRow.appendChild(eventTime);
          eventList.appendChild(eventRow);
        });
        eventsCard.appendChild(eventList);
        fragment.appendChild(eventsCard);

        content.replaceChildren(fragment);
      } catch (e) {
        const message = e && typeof e.message === 'string' ? e.message : String(e);
        content.textContent = 'Error: ' + message;
      }
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
