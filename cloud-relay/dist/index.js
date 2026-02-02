"use strict";
/**
 * Cloud Relay Service Entry Point
 *
 * WebSocket relay for cross-network communication between
 * mobile app and VS Code extension instances.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const http_1 = require("http");
const ws_1 = require("ws");
const dotenv_1 = __importDefault(require("dotenv"));
const connectionManager_1 = require("./connectionManager");
const relay_1 = require("./relay");
const health_1 = require("./health");
// Load environment variables
dotenv_1.default.config();
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
    const app = (0, express_1.default)();
    app.use(express_1.default.json());
    // Create connection manager
    const connectionManager = new connectionManager_1.ConnectionManager();
    // Initialize async resources (load persisted offline queue)
    await connectionManager.initialize();
    // Add health routes
    app.use((0, health_1.createHealthRouter)(connectionManager, startTime));
    // Create HTTP server
    const server = (0, http_1.createServer)(app);
    // Create WebSocket server (attached to HTTP server)
    const wss = new ws_1.WebSocketServer({
        server,
        path: "/v1/ws",
        maxPayload: MAX_MESSAGE_SIZE,
    });
    // Configure relay
    const relayConfig = {
        jwtSecret: JWT_SECRET,
        jwtIssuer: JWT_ISSUER,
        jwtAudience: JWT_AUDIENCE,
        maxMessageSize: MAX_MESSAGE_SIZE,
        requireAuth: REQUIRE_AUTH,
    };
    // Create WebSocket relay
    const relay = new relay_1.WebSocketRelay(wss, connectionManager, relayConfig);
    // Start listening
    server.listen(PORT, HOST, () => {
        console.log(`HTTP server listening on http://${HOST}:${PORT}`);
        console.log(`WebSocket endpoint: ws://${HOST}:${PORT}/v1/ws`);
        console.log(`Health check: http://${HOST}:${PORT}/health`);
        console.log("");
        console.log("Ready to accept connections!");
    });
    // Graceful shutdown
    const shutdown = async (signal) => {
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
//# sourceMappingURL=index.js.map