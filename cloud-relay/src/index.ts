/**
 * Cloud Relay Service Entry Point
 * 
 * WebSocket relay for cross-network communication between
 * mobile app and VS Code extension instances.
 */

import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import dotenv from "dotenv";
import { ConnectionManager } from "./connectionManager";
import { WebSocketRelay, RelayConfig } from "./relay";
import { createHealthRouter } from "./health";
import { createAuthRouter } from "./auth";

// Load environment variables
dotenv.config();

const PORT = parseInt(process.env.PORT || "3000", 10);
const HOST = process.env.HOST || "0.0.0.0";
const JWT_SECRET = process.env.JWT_SECRET || "development-secret-change-in-production";
const JWT_ISSUER = process.env.JWT_ISSUER || "instruction-engine-relay";
const JWT_AUDIENCE = process.env.JWT_AUDIENCE || "instruction-engine";
const MAX_MESSAGE_SIZE = parseInt(process.env.MAX_MESSAGE_SIZE || "1048576", 10); // 1MB default
const REQUIRE_AUTH = process.env.REQUIRE_AUTH !== "false";

const startTime = new Date();

async function main() {
  console.log("=".repeat(60));
  console.log("Instruction Engine Cloud Relay Service");
  console.log("=".repeat(60));
  console.log(`Starting at ${startTime.toISOString()}`);
  console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
  console.log(`Auth required: ${REQUIRE_AUTH}`);
  console.log("");

  // Create Express app
  const app = express();
  app.use(express.json());

  // Create connection manager
  const connectionManager = new ConnectionManager();

  // Initialize async resources (load persisted offline queue)
  await connectionManager.initialize();

  // Add health routes
  app.use(createHealthRouter(connectionManager, startTime));

  // OAuth routes
  app.use("/auth", createAuthRouter());

  // Create HTTP server
  const server = createServer(app);

  // Create WebSocket server (attached to HTTP server)
  const wss = new WebSocketServer({
    server,
    path: "/v1/ws",
    maxPayload: MAX_MESSAGE_SIZE,
  });

  // Configure relay
  const relayConfig: RelayConfig = {
    jwtSecret: JWT_SECRET,
    jwtIssuer: JWT_ISSUER,
    jwtAudience: JWT_AUDIENCE,
    maxMessageSize: MAX_MESSAGE_SIZE,
    requireAuth: REQUIRE_AUTH,
  };

  // Create WebSocket relay
  const relay = new WebSocketRelay(wss, connectionManager, relayConfig);

  // Start listening
  server.listen(PORT, HOST, () => {
    console.log(`HTTP server listening on http://${HOST}:${PORT}`);
    console.log(`WebSocket endpoint: ws://${HOST}:${PORT}/v1/ws`);
    console.log(`Health check: http://${HOST}:${PORT}/health`);
    console.log("");
    console.log("Ready to accept connections!");
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\nReceived ${signal}, shutting down gracefully...`);

    // Stop accepting new connections
    server.close(() => {
      console.log("HTTP server closed");
    });

    // Shutdown relay and connection manager
    relay.shutdown();
    await connectionManager.shutdown();

    console.log("Shutdown complete");
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
