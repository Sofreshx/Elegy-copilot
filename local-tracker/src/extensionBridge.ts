import { WebSocketServer, WebSocket } from "ws";
import { TrackerConfig } from "./config";
import { TrackerEvent } from "./types";

export class ExtensionBridge {
  private wss: WebSocketServer | null = null;
  private clients: Set<WebSocket> = new Set();
  private config: TrackerConfig;

  constructor(config: TrackerConfig) {
    this.config = config;
  }

  /** Start the local WebSocket server */
  start(): void {
    this.wss = new WebSocketServer({ port: this.config.localWsPort });

    this.wss.on("connection", (ws, req) => {
      console.log(`[Bridge] Extension connected from ${req.socket.remoteAddress}`);
      this.clients.add(ws);

      ws.on("close", () => {
        this.clients.delete(ws);
        console.log("[Bridge] Extension disconnected");
      });

      ws.on("error", (err) => {
        console.error("[Bridge] Client error:", err.message);
        this.clients.delete(ws);
      });

      // Send a welcome/status message
      ws.send(JSON.stringify({
        type: "bridge_status",
        timestamp: new Date().toISOString(),
        data: { status: "connected", clientCount: this.clients.size },
      }));
    });

    this.wss.on("error", (err) => {
      console.error("[Bridge] Server error:", err.message);
    });

    console.log(`[Bridge] WebSocket server listening on port ${this.config.localWsPort}`);
  }

  /** Broadcast a TrackerEvent to all connected clients */
  broadcast(event: TrackerEvent): void {
    const message = JSON.stringify(event);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }

  /** Get current connected client count */
  getClientCount(): number {
    return this.clients.size;
  }

  /** Stop the WebSocket server */
  async stop(): Promise<void> {
    // Close all clients
    for (const client of this.clients) {
      client.close(1001, "Server shutting down");
    }
    this.clients.clear();

    // Close server
    if (this.wss) {
      await new Promise<void>((resolve) => {
        this.wss!.close(() => resolve());
      });
      this.wss = null;
    }
    console.log("[Bridge] Server stopped");
  }
}
