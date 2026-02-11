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
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { ConnectionManager } from "./connectionManager";
import { WebSocketRelay, RelayConfig } from "./relay";
import { RateLimiter } from "./rateLimit";
import { TokenService } from "./tokenService";
import { createHealthRouter } from "./health";
import { createAuthRouter } from "./auth";
import { RelayDatabase } from "./database";

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

  // Security headers
  app.use(helmet());

  app.use(express.json());

  // Initialize database
  const database = new RelayDatabase({
    dbPath: process.env.DB_PATH,
    verbose: process.env.NODE_ENV === "development",
  });
  await database.initialize();

  // Create connection manager
  const connectionManager = new ConnectionManager();

  // Initialize async resources (load persisted offline queue)
  await connectionManager.initialize();

  // Instantiate TokenService
  const tokenService = new TokenService({
    jwtSecret: JWT_SECRET,
    jwtIssuer: JWT_ISSUER,
    jwtAudience: JWT_AUDIENCE,
    accessTokenTtlSeconds: parseInt(process.env.ACCESS_TOKEN_TTL || "3600", 10),
    refreshTokenTtlSeconds: parseInt(process.env.REFRESH_TOKEN_TTL || "2592000", 10),
  });

  // Add health routes
  app.use(createHealthRouter(connectionManager, startTime));

  // HTTP rate limiting for auth endpoints (10 requests/minute per IP)
  const authLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: { code: -32003, message: "Too many requests, please try again later" } },
  });

  // OAuth routes
  app.use("/auth", authLimiter, createAuthRouter(tokenService));

  // Create HTTP server
  const server = createServer(app);

  // Parse allowed origins for WS upgrade validation
  const allowedWsOrigins = (process.env.CORS_ORIGINS || "https://instruction-engine.pages.dev")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  // Create WebSocket server (attached to HTTP server)
  const wss = new WebSocketServer({
    server,
    path: "/v1/ws",
    maxPayload: MAX_MESSAGE_SIZE,
    verifyClient: (info, callback) => {
      const origin = info.origin;
      // Allow connections without an Origin header (server-side clients like the VS Code extension)
      if (!origin) {
        callback(true);
        return;
      }
      if (allowedWsOrigins.includes(origin)) {
        callback(true);
      } else {
        console.log(`[Relay] Rejected WS upgrade from disallowed origin: ${origin}`);
        callback(false, 403, "Origin not allowed");
      }
    },
  });

  // Create per-client WS rate limiter (100 messages/minute)
  const wsRateLimiter = new RateLimiter();

  // Configure relay
  const relayConfig: RelayConfig = {
    maxMessageSize: MAX_MESSAGE_SIZE,
    requireAuth: REQUIRE_AUTH,
  };

  // Create WebSocket relay
  const relay = new WebSocketRelay(wss, connectionManager, relayConfig, wsRateLimiter, tokenService);

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

    // Shutdown relay, rate limiter, and connection manager
    relay.shutdown();
    wsRateLimiter.shutdown();
    await connectionManager.shutdown();

    // Close database
    await database.close();

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
