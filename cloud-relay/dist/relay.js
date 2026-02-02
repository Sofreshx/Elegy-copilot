"use strict";
/**
 * WebSocket Relay Server
 * Handles client connections, JWT authentication, and message routing
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebSocketRelay = void 0;
const ws_1 = __importDefault(require("ws"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const uuid_1 = require("uuid");
const types_1 = require("./types");
class WebSocketRelay {
    wss;
    connectionManager;
    config;
    // Track pending auth for connections (clientId -> timeout)
    pendingAuth = new Map();
    // Auth timeout (30 seconds to authenticate after connecting)
    AUTH_TIMEOUT = 30000;
    constructor(wss, connectionManager, config) {
        this.wss = wss;
        this.connectionManager = connectionManager;
        this.config = config;
        this.setupConnectionHandler();
    }
    setupConnectionHandler() {
        this.wss.on("connection", (ws, req) => {
            const url = new URL(req.url || "/", `http://${req.headers.host}`);
            const token = url.searchParams.get("token");
            const tempClientId = `temp-${(0, uuid_1.v4)()}`;
            console.log(`[Relay] New connection from ${req.socket.remoteAddress}`);
            // Try to authenticate via URL token
            if (token) {
                const claims = this.verifyToken(token);
                if (claims) {
                    this.completeAuth(ws, claims);
                    return;
                }
            }
            // If no token or invalid, wait for auth message
            if (this.config.requireAuth) {
                // Set auth timeout
                const timeout = setTimeout(() => {
                    console.log(`[Relay] Auth timeout for ${tempClientId}`);
                    this.sendError(ws, "auth", types_1.ErrorCodes.UNAUTHORIZED, "Authentication timeout");
                    ws.close(4001, "Authentication timeout");
                    this.pendingAuth.delete(tempClientId);
                }, this.AUTH_TIMEOUT);
                this.pendingAuth.set(tempClientId, timeout);
            }
            // Store temp reference for pre-auth messages
            ws.__tempClientId = tempClientId;
            ws.__authenticated = false;
            ws.on("message", (data) => {
                this.handleMessage(ws, data);
            });
            ws.on("close", () => {
                const clientId = ws.__clientId || tempClientId;
                // Clear pending auth timeout
                const timeout = this.pendingAuth.get(tempClientId);
                if (timeout) {
                    clearTimeout(timeout);
                    this.pendingAuth.delete(tempClientId);
                }
                // Remove from connection manager if authenticated
                if (ws.__authenticated) {
                    this.connectionManager.removeClient(clientId);
                }
            });
            ws.on("error", (error) => {
                console.error(`[Relay] WebSocket error:`, error);
            });
        });
    }
    verifyToken(token) {
        try {
            const decoded = jsonwebtoken_1.default.verify(token, this.config.jwtSecret, {
                issuer: this.config.jwtIssuer,
                audience: this.config.jwtAudience,
            });
            return decoded;
        }
        catch (error) {
            console.error(`[Relay] Token verification failed:`, error);
            return null;
        }
    }
    completeAuth(ws, claims) {
        const clientId = claims.client_id;
        // Clear any pending auth timeout
        const tempClientId = ws.__tempClientId;
        if (tempClientId) {
            const timeout = this.pendingAuth.get(tempClientId);
            if (timeout) {
                clearTimeout(timeout);
                this.pendingAuth.delete(tempClientId);
            }
        }
        // Mark as authenticated
        ws.__authenticated = true;
        ws.__clientId = clientId;
        ws.__claims = claims;
        // Register with connection manager
        this.connectionManager.addClient(ws, clientId, claims.client_type, claims.sub, claims.github_login);
        // Send auth success
        this.sendResponse(ws, "auth", {
            authenticated: true,
            clientId,
            userId: claims.sub,
            scopes: claims.scopes,
        });
        console.log(`[Relay] Client ${clientId} authenticated as ${claims.github_login}`);
        // Deliver any queued offline messages
        const queuedResult = this.connectionManager.deliverQueuedMessages(claims.sub, clientId, ws);
        if (queuedResult.delivered > 0) {
            console.log(`[Relay] Delivered ${queuedResult.delivered} queued messages to ${clientId}`);
        }
    }
    handleMessage(ws, data) {
        let parsed;
        try {
            const message = data.toString();
            // Check message size
            if (message.length > this.config.maxMessageSize) {
                this.sendError(ws, null, types_1.ErrorCodes.INVALID_REQUEST, "Message too large");
                return;
            }
            parsed = JSON.parse(message);
        }
        catch (error) {
            this.sendError(ws, null, types_1.ErrorCodes.PARSE_ERROR, "Invalid JSON");
            return;
        }
        // Handle authentication message
        if (parsed.method === "authenticate" && !(ws.__authenticated)) {
            this.handleAuthMessage(ws, parsed);
            return;
        }
        // Handle pong (heartbeat response)
        if (parsed.method === "pong") {
            const clientId = ws.__clientId;
            if (clientId) {
                this.connectionManager.updateLastSeen(clientId);
            }
            return;
        }
        // Handle message acknowledgment
        if (parsed.method === "ack" && parsed.params?.messageId) {
            const messageId = parsed.params.messageId;
            this.connectionManager.acknowledgeMessage(messageId);
            return;
        }
        // Require authentication for all other messages
        if (this.config.requireAuth && !(ws.__authenticated)) {
            this.sendError(ws, parsed.id, types_1.ErrorCodes.UNAUTHORIZED, "Not authenticated");
            return;
        }
        // Handle relay envelope
        if (parsed.version === "1.0" && parsed.payload) {
            this.handleRelayEnvelope(ws, parsed);
            return;
        }
        // Handle direct JSON-RPC (for relay control messages)
        if (parsed.jsonrpc === "2.0") {
            this.handleControlMessage(ws, parsed);
            return;
        }
        this.sendError(ws, parsed.id, types_1.ErrorCodes.INVALID_REQUEST, "Unknown message format");
    }
    handleAuthMessage(ws, request) {
        const token = request.params?.token;
        if (!token) {
            this.sendError(ws, request.id, types_1.ErrorCodes.INVALID_PARAMS, "Token required");
            return;
        }
        const claims = this.verifyToken(token);
        if (!claims) {
            this.sendError(ws, request.id, types_1.ErrorCodes.UNAUTHORIZED, "Invalid token");
            return;
        }
        this.completeAuth(ws, claims);
    }
    handleRelayEnvelope(ws, envelope) {
        const claims = ws.__claims;
        // Validate source matches authenticated client
        if (envelope.source.clientId !== claims.client_id) {
            this.sendError(ws, envelope.payload.id, types_1.ErrorCodes.FORBIDDEN, "Source clientId mismatch");
            return;
        }
        // Check message age (5 minute max)
        const messageAge = Date.now() - new Date(envelope.timestamp).getTime();
        if (messageAge > 5 * 60 * 1000) {
            this.sendError(ws, envelope.payload.id, types_1.ErrorCodes.INVALID_REQUEST, "Message too old");
            return;
        }
        // Extract routing options from meta
        const meta = envelope.meta;
        // Route the message with optional group routing and ACK
        const result = this.connectionManager.routeMessage(envelope, {
            requireAck: meta?.requireAck,
            groupType: meta?.groupType,
            groupId: meta?.groupId,
        });
        if (!result.success && result.offline > 0) {
            // Target client is offline
            this.sendError(ws, envelope.payload.id, types_1.ErrorCodes.CLIENT_OFFLINE, "Target client is offline");
        }
    }
    handleControlMessage(ws, request) {
        const claims = ws.__claims;
        switch (request.method) {
            case "list_clients": {
                const clients = this.connectionManager.getClientsByUserId(claims.sub);
                this.sendResponse(ws, request.id, {
                    clients: clients.map((c) => ({
                        clientId: c.clientId,
                        clientType: c.clientType,
                        connectedAt: c.connectedAt.toISOString(),
                        lastSeen: c.lastSeen.toISOString(),
                    })),
                });
                break;
            }
            case "get_client": {
                const clientId = request.params?.clientId;
                if (!clientId) {
                    this.sendError(ws, request.id, types_1.ErrorCodes.INVALID_PARAMS, "clientId required");
                    return;
                }
                const client = this.connectionManager.getClientInfo(clientId);
                if (!client || client.userId !== claims.sub) {
                    this.sendError(ws, request.id, types_1.ErrorCodes.NOT_FOUND, "Client not found");
                    return;
                }
                this.sendResponse(ws, request.id, {
                    clientId: client.clientId,
                    clientType: client.clientType,
                    connectedAt: client.connectedAt.toISOString(),
                    lastSeen: client.lastSeen.toISOString(),
                });
                break;
            }
            case "initialize": {
                const versions = request.params?.protocolVersions || ["1.0"];
                this.sendResponse(ws, request.id, {
                    protocolVersion: "1.0",
                    serverVersion: process.env.npm_package_version || "1.0.0",
                    capabilities: ["compression", "groups", "acknowledgment"],
                });
                break;
            }
            // ============ Group Management API ============
            case "join_group": {
                const params = request.params;
                if (!params?.groupType || !params?.groupId) {
                    this.sendError(ws, request.id, types_1.ErrorCodes.INVALID_PARAMS, "groupType and groupId required");
                    return;
                }
                const validGroupTypes = ["user", "workspace", "session"];
                if (!validGroupTypes.includes(params.groupType)) {
                    this.sendError(ws, request.id, types_1.ErrorCodes.INVALID_PARAMS, `Invalid groupType. Must be one of: ${validGroupTypes.join(", ")}`);
                    return;
                }
                const result = this.connectionManager.joinGroup(claims.client_id, params.groupType, params.groupId);
                this.sendResponse(ws, request.id, {
                    joined: result.success,
                    groupType: params.groupType,
                    groupId: params.groupId,
                    memberCount: result.memberCount,
                });
                break;
            }
            case "leave_group": {
                const params = request.params;
                if (!params?.groupType || !params?.groupId) {
                    this.sendError(ws, request.id, types_1.ErrorCodes.INVALID_PARAMS, "groupType and groupId required");
                    return;
                }
                const result = this.connectionManager.leaveGroup(claims.client_id, params.groupType, params.groupId);
                this.sendResponse(ws, request.id, {
                    left: result.success,
                    groupType: params.groupType,
                    groupId: params.groupId,
                    memberCount: result.memberCount,
                });
                break;
            }
            case "list_group_members": {
                const params = request.params;
                if (!params?.groupType || !params?.groupId) {
                    this.sendError(ws, request.id, types_1.ErrorCodes.INVALID_PARAMS, "groupType and groupId required");
                    return;
                }
                // Check if client is in the group (only members can list)
                if (!this.connectionManager.isClientInGroup(claims.client_id, params.groupType, params.groupId)) {
                    this.sendError(ws, request.id, types_1.ErrorCodes.FORBIDDEN, "Must be a group member to list members");
                    return;
                }
                const members = this.connectionManager.getGroupMembers(params.groupType, params.groupId);
                // Get client info for each member
                const memberInfos = members.map((clientId) => {
                    const info = this.connectionManager.getClientInfo(clientId);
                    return info
                        ? {
                            clientId: info.clientId,
                            clientType: info.clientType,
                            lastSeen: info.lastSeen.toISOString(),
                        }
                        : { clientId };
                });
                this.sendResponse(ws, request.id, {
                    groupType: params.groupType,
                    groupId: params.groupId,
                    members: memberInfos,
                    count: members.length,
                });
                break;
            }
            case "list_my_groups": {
                const groups = this.connectionManager.getClientGroups(claims.client_id);
                this.sendResponse(ws, request.id, {
                    groups,
                    count: groups.length,
                });
                break;
            }
            case "get_offline_queue_stats": {
                const userStats = this.connectionManager.getOfflineQueueStats(claims.sub);
                this.sendResponse(ws, request.id, {
                    userId: claims.sub,
                    pending: userStats.pending,
                    oldest: userStats.oldest?.toISOString(),
                });
                break;
            }
            default:
                this.sendError(ws, request.id, types_1.ErrorCodes.METHOD_NOT_FOUND, `Unknown method: ${request.method}`);
        }
    }
    sendResponse(ws, id, result) {
        const response = {
            jsonrpc: "2.0",
            id,
            result,
        };
        if (ws.readyState === ws_1.default.OPEN) {
            ws.send(JSON.stringify(response));
        }
    }
    sendError(ws, id, code, message, data) {
        const response = {
            jsonrpc: "2.0",
            id: id || "error",
            error: {
                code,
                message,
                data,
            },
        };
        if (ws.readyState === ws_1.default.OPEN) {
            ws.send(JSON.stringify(response));
        }
    }
    /**
     * Shutdown the relay
     */
    shutdown() {
        // Clear all pending auth timeouts
        for (const timeout of this.pendingAuth.values()) {
            clearTimeout(timeout);
        }
        this.pendingAuth.clear();
    }
}
exports.WebSocketRelay = WebSocketRelay;
//# sourceMappingURL=relay.js.map