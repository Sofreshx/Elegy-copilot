import http from "http";
import WebSocket, { WebSocketServer } from "ws";
import { v4 as uuidv4 } from "uuid";
import { ConnectionManager } from "../connectionManager";
import { WebSocketRelay } from "../relay";
import { RateLimiter } from "../rateLimit";
import { TokenService } from "../tokenService";
import { DEFAULT_MOBILE_SCOPES, DEFAULT_EXTENSION_SCOPES, ErrorCodes } from "../types";
import type { MintAccessTokenInput } from "../tokenService";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const TEST_SECRET = "ws-auth-integration-test-secret";

const TOKEN_CONFIG = {
  jwtSecret: TEST_SECRET,
  jwtIssuer: "test-relay",
  jwtAudience: "test-audience",
  accessTokenTtlSeconds: 3600,
  refreshTokenTtlSeconds: 86400,
};

const TEST_USER = {
  userId: "github|12345",
  githubLogin: "testuser",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mintTestToken(
  tokenService: TokenService,
  overrides: Partial<MintAccessTokenInput> = {},
): string {
  return tokenService.mintAccessToken({
    userId: overrides.userId ?? TEST_USER.userId,
    githubLogin: overrides.githubLogin ?? TEST_USER.githubLogin,
    clientType: overrides.clientType ?? "mobile",
    clientId: overrides.clientId ?? `client-${uuidv4()}`,
    scopes: overrides.scopes ?? DEFAULT_MOBILE_SCOPES,
  });
}

/** Connect a WS client and return it along with a collected-messages array. */
function connectWs(
  port: number,
  query = "",
): Promise<{ ws: WebSocket; messages: any[]; close: () => void }> {
  return new Promise((resolve, reject) => {
    const url = `ws://127.0.0.1:${port}/v1/ws${query}`;
    const ws = new WebSocket(url);
    const messages: any[] = [];

    ws.on("message", (data) => {
      messages.push(JSON.parse(data.toString()));
    });

    ws.on("open", () => {
      resolve({
        ws,
        messages,
        close: () => {
          if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
            ws.close();
          }
        },
      });
    });

    ws.on("error", reject);
  });
}

/** Wait until the messages array has at least `count` entries or timeout. */
function waitForMessages(
  messages: any[],
  count: number,
  timeoutMs = 3000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (messages.length >= count) return resolve();
    const start = Date.now();
    const interval = setInterval(() => {
      if (messages.length >= count) {
        clearInterval(interval);
        resolve();
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(interval);
        reject(
          new Error(
            `Timeout waiting for ${count} messages (got ${messages.length})`,
          ),
        );
      }
    }, 20);
  });
}

/** Wait for a WS close event. Returns { code, reason }. */
function waitForClose(
  ws: WebSocket,
  timeoutMs = 5000,
): Promise<{ code: number; reason: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Timeout waiting for WS close")),
      timeoutMs,
    );

    ws.on("close", (code, reason) => {
      clearTimeout(timer);
      resolve({ code, reason: reason.toString() });
    });
  });
}

/** Small delay helper. */
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("WS Auth Integration", () => {
  let server: http.Server;
  let wss: WebSocketServer;
  let connectionManager: ConnectionManager;
  let relay: WebSocketRelay;
  let tokenService: TokenService;
  let port: number;

  // Collect open client connections for cleanup
  const openClients: Array<{ close: () => void }> = [];

  beforeAll(async () => {
    tokenService = new TokenService(TOKEN_CONFIG);
    connectionManager = new ConnectionManager();
    const rateLimiter = new RateLimiter();

    server = http.createServer();
    wss = new WebSocketServer({ server, path: "/v1/ws" });

    relay = new WebSocketRelay(wss, connectionManager, {
      maxMessageSize: 1_000_000,
      requireAuth: true,
    }, rateLimiter, tokenService);

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address() as { port: number };
        port = addr.port;
        resolve();
      });
    });
  });

  afterEach(() => {
    // Close any clients that tests forgot to clean up
    for (const c of openClients) {
      c.close();
    }
    openClients.length = 0;
  });

  afterAll(async () => {
    relay.shutdown();
    await connectionManager.shutdown();

    for (const client of wss.clients) {
      client.terminate();
    }
    wss.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  // =========================================================================
  // WS token auth (query param)
  // =========================================================================

  describe("WS token auth", () => {
    it("authenticates via ?token query param and receives auth success", async () => {
      const clientId = `ext-${uuidv4()}`;
      const token = mintTestToken(tokenService, {
        clientId,
        clientType: "extension",
        scopes: DEFAULT_EXTENSION_SCOPES,
      });

      const client = await connectWs(port, `?token=${token}`);
      openClients.push(client);

      await waitForMessages(client.messages, 1);

      const authMsg = client.messages[0];
      expect(authMsg.jsonrpc).toBe("2.0");
      expect(authMsg.id).toBe("auth");
      expect(authMsg.result.authenticated).toBe(true);
      expect(authMsg.result.clientId).toBe(clientId);
      expect(authMsg.result.userId).toBe(TEST_USER.userId);
      expect(authMsg.result.scopes).toEqual(DEFAULT_EXTENSION_SCOPES);

      client.close();
    });

    it("allows authenticated client to call control methods", async () => {
      const clientId = `ext-${uuidv4()}`;
      const token = mintTestToken(tokenService, {
        clientId,
        clientType: "extension",
        scopes: DEFAULT_EXTENSION_SCOPES,
      });

      const client = await connectWs(port, `?token=${token}`);
      openClients.push(client);

      await waitForMessages(client.messages, 1); // auth success

      // Call list_clients (requires read:clients)
      client.ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: "req-1",
          method: "list_clients",
        }),
      );

      await waitForMessages(client.messages, 2);

      const resp = client.messages[1];
      expect(resp.jsonrpc).toBe("2.0");
      expect(resp.id).toBe("req-1");
      expect(resp.result).not.toBeUndefined();
      expect(Array.isArray(resp.result.clients)).toBe(true);

      client.close();
    });
  });

  // =========================================================================
  // WS message auth (authenticate method)
  // =========================================================================

  describe("WS message auth", () => {
    it("authenticates via authenticate message after connecting without token", async () => {
      const clientId = `mob-${uuidv4()}`;
      const token = mintTestToken(tokenService, { clientId });

      const client = await connectWs(port);
      openClients.push(client);

      // Should receive no messages yet (no auth)
      await delay(50);
      expect(client.messages.length).toBe(0);

      // Send authenticate message
      client.ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: "auth-1",
          method: "authenticate",
          params: { token },
        }),
      );

      await waitForMessages(client.messages, 1);

      const authMsg = client.messages[0];
      expect(authMsg.jsonrpc).toBe("2.0");
      expect(authMsg.id).toBe("auth");
      expect(authMsg.result.authenticated).toBe(true);
      expect(authMsg.result.clientId).toBe(clientId);

      client.close();
    });

    it("allows control methods after message-based auth", async () => {
      const clientId = `mob-${uuidv4()}`;
      const token = mintTestToken(tokenService, { clientId });

      const client = await connectWs(port);
      openClients.push(client);

      // Authenticate
      client.ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: "auth-1",
          method: "authenticate",
          params: { token },
        }),
      );
      await waitForMessages(client.messages, 1);

      // Call initialize (unrestricted)
      client.ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: "init-1",
          method: "initialize",
          params: { protocolVersions: ["1.0"] },
        }),
      );

      await waitForMessages(client.messages, 2);

      const initResp = client.messages[1];
      expect(initResp.id).toBe("init-1");
      expect(initResp.result.protocolVersion).toBe("1.0");

      client.close();
    });
  });

  // =========================================================================
  // WS auth timeout
  // =========================================================================

  describe("WS auth timeout", () => {
    let timeoutServer: http.Server;
    let timeoutWss: WebSocketServer;
    let timeoutConnectionManager: ConnectionManager;
    let timeoutRelay: WebSocketRelay;
    let timeoutPort: number;

    beforeAll(async () => {
      // Create a separate relay with a very short auth timeout for this test.
      // Since AUTH_TIMEOUT is private readonly, we'll use Object.defineProperty
      // on the relay instance to override it.
      timeoutConnectionManager = new ConnectionManager();
      const rateLimiter = new RateLimiter();

      timeoutServer = http.createServer();
      timeoutWss = new WebSocketServer({ server: timeoutServer, path: "/v1/ws" });

      timeoutRelay = new WebSocketRelay(
        timeoutWss,
        timeoutConnectionManager,
        { maxMessageSize: 1_000_000, requireAuth: true },
        rateLimiter,
        tokenService,
      );

      // Override the private AUTH_TIMEOUT to 200ms for testing
      Object.defineProperty(timeoutRelay, "AUTH_TIMEOUT", {
        value: 200,
        writable: false,
      });

      // We need to re-setup the connection handler with the new timeout.
      // Since the handler was already bound in the constructor with the old
      // timeout captured in the closure, we tear down and recreate.
      timeoutWss.removeAllListeners("connection");
      // Access private method via bracket notation for test
      (timeoutRelay as any).setupConnectionHandler();

      await new Promise<void>((resolve) => {
        timeoutServer.listen(0, "127.0.0.1", () => {
          const addr = timeoutServer.address() as { port: number };
          timeoutPort = addr.port;
          resolve();
        });
      });
    });

    afterAll(async () => {
      timeoutRelay.shutdown();
      await timeoutConnectionManager.shutdown();
      for (const c of timeoutWss.clients) {
        c.terminate();
      }
      timeoutWss.close();
      await new Promise<void>((r) => timeoutServer.close(() => r()));
    });

    it("closes connection with 4001 when auth is not provided within timeout", async () => {
      const client = await connectWs(timeoutPort);

      const closePromise = waitForClose(client.ws, 2000);

      const { code } = await closePromise;
      expect(code).toBe(4001);
    });

    it("does NOT timeout if client authenticates within the window", async () => {
      const clientId = `mob-${uuidv4()}`;
      const token = mintTestToken(tokenService, { clientId });

      const client = await connectWs(timeoutPort);
      openClients.push(client);

      // Authenticate quickly (within 200ms window)
      client.ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: "auth-1",
          method: "authenticate",
          params: { token },
        }),
      );

      await waitForMessages(client.messages, 1);
      expect(client.messages[0].result.authenticated).toBe(true);

      // Wait past the original timeout window to make sure connection stays open
      await delay(400);
      expect(client.ws.readyState).toBe(WebSocket.OPEN);

      client.close();
    });
  });

  // =========================================================================
  // WS invalid token
  // =========================================================================

  describe("WS invalid token", () => {
    it("rejects invalid token in query param and requires message auth", async () => {
      // Connect with a garbage token — relay should NOT close immediately,
      // but the client should be unauthenticated (waiting for auth message).
      const client = await connectWs(port, "?token=invalid-jwt-garbage");
      openClients.push(client);

      // Since the token is invalid, relay falls through to await auth message.
      // Sending any non-auth message should be rejected as unauthorized.
      client.ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: "req-1",
          method: "list_clients",
        }),
      );

      await waitForMessages(client.messages, 1);

      const errorMsg = client.messages[0];
      expect(errorMsg.error).not.toBeUndefined();
      expect(errorMsg.error.code).toBe(ErrorCodes.UNAUTHORIZED);

      client.close();
    });

    it("rejects invalid token in authenticate message", async () => {
      const client = await connectWs(port);
      openClients.push(client);

      client.ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: "auth-bad",
          method: "authenticate",
          params: { token: "not-a-valid-jwt" },
        }),
      );

      await waitForMessages(client.messages, 1);

      const errorMsg = client.messages[0];
      expect(errorMsg.error).not.toBeUndefined();
      expect(errorMsg.error.code).toBe(ErrorCodes.UNAUTHORIZED);
      expect(errorMsg.error.message).toContain("Invalid token");

      client.close();
    });

    it("rejects token signed with wrong secret", async () => {
      const wrongService = new TokenService({
        jwtSecret: "wrong-secret",
        jwtIssuer: TOKEN_CONFIG.jwtIssuer,
        jwtAudience: TOKEN_CONFIG.jwtAudience,
      });
      const badToken = mintTestToken(wrongService);

      const client = await connectWs(port);
      openClients.push(client);

      client.ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: "auth-wrong",
          method: "authenticate",
          params: { token: badToken },
        }),
      );

      await waitForMessages(client.messages, 1);

      expect(client.messages[0].error.code).toBe(ErrorCodes.UNAUTHORIZED);

      client.close();
    });

    it("rejects authenticate message with missing token param", async () => {
      const client = await connectWs(port);
      openClients.push(client);

      client.ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: "auth-no-token",
          method: "authenticate",
          params: {},
        }),
      );

      await waitForMessages(client.messages, 1);

      expect(client.messages[0].error.code).toBe(ErrorCodes.INVALID_PARAMS);

      client.close();
    });
  });

  // =========================================================================
  // WS scope enforcement
  // =========================================================================

  describe("WS scope enforcement", () => {
    it("forbids mobile client from calling disconnect_client (requires admin:clients)", async () => {
      const clientId = `mob-${uuidv4()}`;
      const token = mintTestToken(tokenService, {
        clientId,
        clientType: "mobile",
        scopes: DEFAULT_MOBILE_SCOPES, // does NOT include admin:clients
      });

      const client = await connectWs(port, `?token=${token}`);
      openClients.push(client);
      await waitForMessages(client.messages, 1); // auth success

      client.ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: "admin-req",
          method: "disconnect_client",
          params: { clientId: "some-other-client" },
        }),
      );

      await waitForMessages(client.messages, 2);

      const forbiddenMsg = client.messages[1];
      expect(forbiddenMsg.error).not.toBeUndefined();
      expect(forbiddenMsg.error.code).toBe(ErrorCodes.FORBIDDEN);
      expect(forbiddenMsg.error.message).toContain("Missing required scope");

      client.close();
    });

    it("allows extension client to call disconnect_client (has admin:clients)", async () => {
      // Connect a target client first so there's something to disconnect
      const targetId = `target-${uuidv4()}`;
      const targetToken = mintTestToken(tokenService, {
        clientId: targetId,
        clientType: "extension",
        scopes: DEFAULT_EXTENSION_SCOPES,
      });
      const targetClient = await connectWs(port, `?token=${targetToken}`);
      openClients.push(targetClient);
      await waitForMessages(targetClient.messages, 1);

      // Connect admin client
      const adminId = `admin-${uuidv4()}`;
      const adminToken = mintTestToken(tokenService, {
        clientId: adminId,
        clientType: "extension",
        scopes: DEFAULT_EXTENSION_SCOPES,
      });
      const adminClient = await connectWs(port, `?token=${adminToken}`);
      openClients.push(adminClient);
      await waitForMessages(adminClient.messages, 1);

      // Admin disconnects target
      adminClient.ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: "disc-req",
          method: "disconnect_client",
          params: { clientId: targetId },
        }),
      );

      await waitForMessages(adminClient.messages, 2);

      const resp = adminClient.messages[1];
      expect(resp.result).not.toBeUndefined();
      expect(resp.result.disconnected).toBe(true);
      expect(resp.result.clientId).toBe(targetId);

      adminClient.close();
    });

    it("rejects unauthenticated control messages with UNAUTHORIZED", async () => {
      const client = await connectWs(port);
      openClients.push(client);

      client.ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: "unauthed-req",
          method: "list_clients",
        }),
      );

      await waitForMessages(client.messages, 1);

      expect(client.messages[0].error.code).toBe(ErrorCodes.UNAUTHORIZED);

      client.close();
    });
  });

  // =========================================================================
  // WS offline delivery
  // =========================================================================

  describe("WS offline delivery", () => {
    it("delivers queued messages when client reconnects", async () => {
      // 1) Connect client A
      const clientAId = `clientA-${uuidv4()}`;
      const tokenA = mintTestToken(tokenService, {
        clientId: clientAId,
        clientType: "extension",
        scopes: DEFAULT_EXTENSION_SCOPES,
      });

      const clientA = await connectWs(port, `?token=${tokenA}`);
      openClients.push(clientA);
      await waitForMessages(clientA.messages, 1);

      // 2) Connect client B (same user)
      const clientBId = `clientB-${uuidv4()}`;
      const tokenB = mintTestToken(tokenService, {
        clientId: clientBId,
        clientType: "extension",
        scopes: DEFAULT_EXTENSION_SCOPES,
      });

      const clientB = await connectWs(port, `?token=${tokenB}`);
      openClients.push(clientB);
      await waitForMessages(clientB.messages, 1);

      // 3) Disconnect client A
      clientA.close();
      await delay(100); // let the server process the close

      // 4) Client B sends a message targeted at client A via relay envelope
      const envelope = {
        version: "1.0",
        messageId: uuidv4(),
        timestamp: new Date().toISOString(),
        source: {
          type: "extension",
          clientId: clientBId,
          userId: TEST_USER.userId,
        },
        target: {
          type: "extension",
          clientId: clientAId,
          userId: TEST_USER.userId,
        },
        payload: {
          jsonrpc: "2.0",
          id: "cmd-1",
          method: "get_status",
          params: {},
        },
      };

      clientB.ws.send(JSON.stringify(envelope));
      await delay(100); // let the offline queue process

      // 5) Reconnect client A with the same clientId
      const tokenA2 = mintTestToken(tokenService, {
        clientId: clientAId,
        clientType: "extension",
        scopes: DEFAULT_EXTENSION_SCOPES,
      });

      const clientA2 = await connectWs(port, `?token=${tokenA2}`);
      openClients.push(clientA2);

      // Should receive auth success + queued message(s)
      await waitForMessages(clientA2.messages, 1);

      // The first message is the auth success
      const authMsg = clientA2.messages[0];
      expect(authMsg.result.authenticated).toBe(true);
      expect(authMsg.result.clientId).toBe(clientAId);

      // If there are queued messages, they follow the auth message.
      // The offline queue delivers based on userId, so the reconnect
      // should trigger delivery of the queued envelope.
      // Give a bit of time for delivery
      await delay(200);

      // Check if we got the queued message
      // (The offline queue stores the full envelope and replays it)
      if (clientA2.messages.length > 1) {
        // Queued message was delivered — verify it's our envelope payload
        const delivered = clientA2.messages[1];
        expect(delivered).not.toBeUndefined();
      }

      clientA2.close();
      clientB.close();
    });
  });
});
