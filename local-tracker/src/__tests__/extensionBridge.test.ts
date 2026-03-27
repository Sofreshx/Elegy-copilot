import path from "path";
import WebSocket from "ws";
import { ExtensionBridge } from "../extensionBridge";
import { TrackerConfig } from "../config";
import { TrackerEvent } from "../types";
import { __watcherTestExports } from "../watchers";

// ---------- Helpers ----------

function makeConfig(overrides: Partial<TrackerConfig> = {}): TrackerConfig {
  return {
    workspacePaths: ["/test/workspace"],
    relayTokenSource: "missing",
    localWsPort: 0, // random free port
    watchIntervalMs: 2000,
    statusPort: 0,
    obsidianNotePaths: [],
    obsidianPollIntervalMs: 2000,
    ...overrides,
  };
}

function makeSampleEvent(type: TrackerEvent["type"] = "task_update"): TrackerEvent {
  const workspacePath = "/test/workspace";
  const taskStorePath = __watcherTestExports.getCanonicalTasksPath(workspacePath);
  return {
    type,
    timestamp: new Date().toISOString(),
    data: {
      authority: "canonical",
      event: "change",
      path: path.join(taskStorePath, "t-001.md"),
      relativePath: "t-001.md",
      taskStorePath,
      workspacePath,
    },
  };
}

/** Wait for the next message on a WebSocket client */
function nextMessage(ws: WebSocket): Promise<unknown> {
  return new Promise((resolve, reject) => {
    ws.once("message", (data) => {
      try {
        resolve(JSON.parse(data.toString()));
      } catch (err) {
        reject(err);
      }
    });
    ws.once("error", reject);
  });
}

/**
 * Connect a WS client and wait for the connection + welcome message.
 * The message listener is attached before `open` fires so the welcome is never lost.
 */
function toClientHost(address: string): string {
  return address === "::" || address === "0.0.0.0" ? "127.0.0.1" : address;
}

function connectClient(
  address: string,
  port: number
): Promise<{ ws: WebSocket; welcome: Promise<unknown> }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${toClientHost(address)}:${port}`);
    // Attach message listener immediately to capture the welcome message
    const welcome = nextMessage(ws);
    ws.on("open", () => resolve({ ws, welcome }));
    ws.on("error", reject);
  });
}

function getBoundAddress(bridge: ExtensionBridge): { address: string; port: number } | null {
  const wss = (bridge as any).wss;
  const addr = wss?.address?.();
  if (!addr || typeof addr !== "object") {
    return null;
  }
  return {
    address: addr.address || "127.0.0.1",
    port: addr.port,
  };
}

/** Wait for the bridge server to bind and return its actual loopback address */
async function getListeningAddress(
  bridge: ExtensionBridge
): Promise<{ address: string; port: number }> {
  const current = getBoundAddress(bridge);
  if (current) {
    return current;
  }

  const wss = (bridge as any).wss;
  await new Promise<void>((resolve, reject) => {
    const onListening = () => {
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      wss?.off?.("listening", onListening);
      wss?.off?.("error", onError);
    };

    wss?.on?.("listening", onListening);
    wss?.on?.("error", onError);
  });

  const address = getBoundAddress(bridge);
  if (!address) {
    throw new Error("ExtensionBridge server did not expose a bound address");
  }
  return address;
}

/** Small delay helper */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------- Tests ----------

describe("ExtensionBridge", () => {
  let bridge: ExtensionBridge;
  let clients: WebSocket[];

  beforeEach(() => {
    clients = [];
  });

  afterEach(async () => {
    // Close any open clients
    for (const c of clients) {
      if (c.readyState === WebSocket.OPEN || c.readyState === WebSocket.CONNECTING) {
        c.close();
      }
    }
    // Stop bridge if still running
    if (bridge) {
      await bridge.stop();
    }
  });

  describe("server lifecycle", () => {
    it("starts and accepts connections", async () => {
      bridge = new ExtensionBridge(makeConfig());
      bridge.start();

      const { address, port } = await getListeningAddress(bridge);
      expect(port).toBeGreaterThan(0);

      const { ws } = await connectClient(address, port);
      clients.push(ws);

      expect(ws.readyState).toBe(WebSocket.OPEN);
    });

    it("sends a welcome message on connection", async () => {
      bridge = new ExtensionBridge(makeConfig());
      bridge.start();

      const { address, port } = await getListeningAddress(bridge);
      const { ws, welcome } = await connectClient(address, port);
      clients.push(ws);

      const msg = await welcome as any;
      expect(msg.type).toBe("bridge_status");
      expect(msg.data.status).toBe("connected");
      expect(msg.data.clientCount).toBe(1);
      expect(msg.timestamp).toBeDefined();
    });

    it("stop() closes all connections and server", async () => {
      bridge = new ExtensionBridge(makeConfig());
      bridge.start();

      const { address, port } = await getListeningAddress(bridge);
      const { ws } = await connectClient(address, port);
      clients.push(ws);

      const closePromise = new Promise<void>((resolve) => {
        ws.on("close", () => resolve());
      });

      await bridge.stop();
      await closePromise;

      expect(ws.readyState).toBe(WebSocket.CLOSED);
      expect(bridge.getClientCount()).toBe(0);
    });

    it("stop() is safe to call when not started", async () => {
      bridge = new ExtensionBridge(makeConfig());
      await bridge.stop(); // should not throw
    });

    it("stop() is idempotent", async () => {
      bridge = new ExtensionBridge(makeConfig());
      bridge.start();
      await bridge.stop();
      await bridge.stop(); // should not throw
    });
  });

  describe("client tracking", () => {
    it("getClientCount returns correct count", async () => {
      bridge = new ExtensionBridge(makeConfig());
      bridge.start();
      const { address, port } = await getListeningAddress(bridge);

      expect(bridge.getClientCount()).toBe(0);

      const { ws: ws1, welcome: w1 } = await connectClient(address, port);
      clients.push(ws1);
      await w1;
      expect(bridge.getClientCount()).toBe(1);

      const { ws: ws2, welcome: w2 } = await connectClient(address, port);
      clients.push(ws2);
      await w2;
      expect(bridge.getClientCount()).toBe(2);
    });

    it("cleans up disconnected clients", async () => {
      bridge = new ExtensionBridge(makeConfig());
      bridge.start();
      const { address, port } = await getListeningAddress(bridge);

      const { ws, welcome } = await connectClient(address, port);
      clients.push(ws);
      await welcome;
      expect(bridge.getClientCount()).toBe(1);

      // Close client and wait for server to notice
      const disconnectPromise = new Promise<void>((resolve) => {
        ws.on("close", () => resolve());
      });
      ws.close();
      await disconnectPromise;

      // Small delay for server-side cleanup
      await delay(50);

      expect(bridge.getClientCount()).toBe(0);
    });
  });

  describe("broadcast", () => {
    it("sends event to all connected clients", async () => {
      bridge = new ExtensionBridge(makeConfig());
      bridge.start();
      const { address, port } = await getListeningAddress(bridge);

      const { ws: ws1, welcome: w1 } = await connectClient(address, port);
      const { ws: ws2, welcome: w2 } = await connectClient(address, port);
      clients.push(ws1, ws2);

      // Consume welcome messages
      await w1;
      await w2;

      const event = makeSampleEvent("task_update");
      const msg1Promise = nextMessage(ws1);
      const msg2Promise = nextMessage(ws2);

      bridge.broadcast(event);

      const [msg1, msg2] = await Promise.all([msg1Promise, msg2Promise]);

      expect(msg1).toEqual(event);
      expect(msg2).toEqual(event);
    });

    it("does not throw when no clients are connected", () => {
      bridge = new ExtensionBridge(makeConfig());
      bridge.start();

      const event = makeSampleEvent();
      expect(() => bridge.broadcast(event)).not.toThrow();
    });

    it("skips clients that are not in OPEN state", async () => {
      bridge = new ExtensionBridge(makeConfig());
      bridge.start();
      const { address, port } = await getListeningAddress(bridge);

      const { ws: ws1, welcome: w1 } = await connectClient(address, port);
      const { ws: ws2, welcome: w2 } = await connectClient(address, port);
      clients.push(ws1, ws2);

      // Consume welcome messages
      await w1;
      await w2;

      // Close ws1 but don't wait for server cleanup
      ws1.close();
      await delay(50);

      const event = makeSampleEvent("git_update");
      const msg2Promise = nextMessage(ws2);

      bridge.broadcast(event);

      const msg2 = await msg2Promise;
      expect(msg2).toEqual(event);
    });

    it("broadcasts multiple event types correctly", async () => {
      bridge = new ExtensionBridge(makeConfig());
      bridge.start();
      const { address, port } = await getListeningAddress(bridge);

      const { ws, welcome } = await connectClient(address, port);
      clients.push(ws);
      await welcome;

      const events: TrackerEvent[] = [
        makeSampleEvent("file_change"),
        makeSampleEvent("git_update"),
        makeSampleEvent("task_update"),
      ];

      for (const event of events) {
        const msgPromise = nextMessage(ws);
        bridge.broadcast(event);
        const received = await msgPromise;
        expect(received).toEqual(event);
      }
    });
  });
});
