/**
 * WebSocket Relay Server
 * Handles client connections, JWT authentication, and message routing
 */

import WebSocket, { WebSocketServer } from "ws";
import { IncomingMessage } from "http";
import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import { ConnectionManager } from "./connectionManager";
import { GroupType } from "./connectionGroups";
import {
  AccessTokenClaims,
  ErrorCodes,
  RelayEnvelope,
  WsErrorResponse,
  WsRequest,
  WsSuccessResponse,
} from "./types";

export interface RelayConfig {
  jwtSecret: string;
  jwtIssuer: string;
  jwtAudience: string;
  maxMessageSize: number;
  requireAuth: boolean;
}

export class WebSocketRelay {
  private wss: WebSocketServer;
  private connectionManager: ConnectionManager;
  private config: RelayConfig;
  
  // Track pending auth for connections (clientId -> timeout)
  private pendingAuth: Map<string, NodeJS.Timeout> = new Map();
  
  // Auth timeout (30 seconds to authenticate after connecting)
  private readonly AUTH_TIMEOUT = 30000;

  constructor(wss: WebSocketServer, connectionManager: ConnectionManager, config: RelayConfig) {
    this.wss = wss;
    this.connectionManager = connectionManager;
    this.config = config;

    this.setupConnectionHandler();
  }

  private setupConnectionHandler(): void {
    this.wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
      const url = new URL(req.url || "/", `http://${req.headers.host}`);
      const token = url.searchParams.get("token");
      const tempClientId = `temp-${uuidv4()}`;

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
          this.sendError(ws, "auth", ErrorCodes.UNAUTHORIZED, "Authentication timeout");
          ws.close(4001, "Authentication timeout");
          this.pendingAuth.delete(tempClientId);
        }, this.AUTH_TIMEOUT);

        this.pendingAuth.set(tempClientId, timeout);
      }

      // Store temp reference for pre-auth messages
      (ws as any).__tempClientId = tempClientId;
      (ws as any).__authenticated = false;

      ws.on("message", (data: WebSocket.RawData) => {
        this.handleMessage(ws, data);
      });

      ws.on("close", () => {
        const clientId = (ws as any).__clientId || tempClientId;
        
        // Clear pending auth timeout
        const timeout = this.pendingAuth.get(tempClientId);
        if (timeout) {
          clearTimeout(timeout);
          this.pendingAuth.delete(tempClientId);
        }
        
        // Remove from connection manager if authenticated
        if ((ws as any).__authenticated) {
          this.connectionManager.removeClient(clientId);
        }
      });

      ws.on("error", (error) => {
        console.error(`[Relay] WebSocket error:`, error);
      });
    });
  }

  private verifyToken(token: string): AccessTokenClaims | null {
    try {
      const decoded = jwt.verify(token, this.config.jwtSecret, {
        issuer: this.config.jwtIssuer,
        audience: this.config.jwtAudience,
      }) as AccessTokenClaims;
      return decoded;
    } catch (error) {
      console.error(`[Relay] Token verification failed:`, error);
      return null;
    }
  }

  private completeAuth(ws: WebSocket, claims: AccessTokenClaims): void {
    const clientId = claims.client_id;
    
    // Clear any pending auth timeout
    const tempClientId = (ws as any).__tempClientId;
    if (tempClientId) {
      const timeout = this.pendingAuth.get(tempClientId);
      if (timeout) {
        clearTimeout(timeout);
        this.pendingAuth.delete(tempClientId);
      }
    }

    // Mark as authenticated
    (ws as any).__authenticated = true;
    (ws as any).__clientId = clientId;
    (ws as any).__claims = claims;

    // Register with connection manager
    this.connectionManager.addClient(
      ws,
      clientId,
      claims.client_type,
      claims.sub,
      claims.github_login
    );

    // Send auth success
    this.sendResponse(ws, "auth", {
      authenticated: true,
      clientId,
      userId: claims.sub,
      scopes: claims.scopes,
    });

    console.log(`[Relay] Client ${clientId} authenticated as ${claims.github_login}`);

    // Deliver any queued offline messages
    const queuedResult = this.connectionManager.deliverQueuedMessages(
      claims.sub,
      clientId,
      ws
    );
    if (queuedResult.delivered > 0) {
      console.log(
        `[Relay] Delivered ${queuedResult.delivered} queued messages to ${clientId}`
      );
    }
  }

  private handleMessage(ws: WebSocket, data: WebSocket.RawData): void {
    let parsed: any;

    try {
      const message = data.toString();
      
      // Check message size
      if (message.length > this.config.maxMessageSize) {
        this.sendError(ws, null, ErrorCodes.INVALID_REQUEST, "Message too large");
        return;
      }

      parsed = JSON.parse(message);
    } catch (error) {
      this.sendError(ws, null, ErrorCodes.PARSE_ERROR, "Invalid JSON");
      return;
    }

    // Handle authentication message
    if (parsed.method === "authenticate" && !((ws as any).__authenticated)) {
      this.handleAuthMessage(ws, parsed);
      return;
    }

    // Handle pong (heartbeat response)
    if (parsed.method === "pong") {
      const clientId = (ws as any).__clientId;
      if (clientId) {
        this.connectionManager.updateLastSeen(clientId);
      }
      return;
    }

    // Handle message acknowledgment
    if (parsed.method === "ack" && (parsed.params as any)?.messageId) {
      const messageId = (parsed.params as any).messageId;
      this.connectionManager.acknowledgeMessage(messageId);
      return;
    }

    // Require authentication for all other messages
    if (this.config.requireAuth && !((ws as any).__authenticated)) {
      this.sendError(ws, parsed.id, ErrorCodes.UNAUTHORIZED, "Not authenticated");
      return;
    }

    // Handle relay envelope
    if (parsed.version === "1.0" && parsed.payload) {
      this.handleRelayEnvelope(ws, parsed as RelayEnvelope);
      return;
    }

    // Handle direct JSON-RPC (for relay control messages)
    if (parsed.jsonrpc === "2.0") {
      this.handleControlMessage(ws, parsed as WsRequest);
      return;
    }

    this.sendError(ws, parsed.id, ErrorCodes.INVALID_REQUEST, "Unknown message format");
  }

  private handleAuthMessage(ws: WebSocket, request: WsRequest): void {
    const token = (request.params as any)?.token;
    
    if (!token) {
      this.sendError(ws, request.id, ErrorCodes.INVALID_PARAMS, "Token required");
      return;
    }

    const claims = this.verifyToken(token);
    if (!claims) {
      this.sendError(ws, request.id, ErrorCodes.UNAUTHORIZED, "Invalid token");
      return;
    }

    this.completeAuth(ws, claims);
  }

  private handleRelayEnvelope(ws: WebSocket, envelope: RelayEnvelope): void {
    const claims = (ws as any).__claims as AccessTokenClaims;
    
    // Validate source matches authenticated client
    if (envelope.source.clientId !== claims.client_id) {
      this.sendError(
        ws,
        (envelope.payload as any).id,
        ErrorCodes.FORBIDDEN,
        "Source clientId mismatch"
      );
      return;
    }

    // Check message age (5 minute max)
    const messageAge = Date.now() - new Date(envelope.timestamp).getTime();
    if (messageAge > 5 * 60 * 1000) {
      this.sendError(
        ws,
        (envelope.payload as any).id,
        ErrorCodes.INVALID_REQUEST,
        "Message too old"
      );
      return;
    }

    // Extract routing options from meta
    const meta = envelope.meta as {
      requireAck?: boolean;
      groupType?: GroupType;
      groupId?: string;
    } | undefined;

    // Route the message with optional group routing and ACK
    const result = this.connectionManager.routeMessage(envelope, {
      requireAck: meta?.requireAck,
      groupType: meta?.groupType,
      groupId: meta?.groupId,
    });

    if (!result.success && result.offline > 0) {
      // Target client is offline
      this.sendError(
        ws,
        (envelope.payload as any).id,
        ErrorCodes.CLIENT_OFFLINE,
        "Target client is offline"
      );
    }
  }

  private handleControlMessage(ws: WebSocket, request: WsRequest): void {
    const claims = (ws as any).__claims as AccessTokenClaims;

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
        const clientId = (request.params as any)?.clientId;
        if (!clientId) {
          this.sendError(ws, request.id, ErrorCodes.INVALID_PARAMS, "clientId required");
          return;
        }

        const client = this.connectionManager.getClientInfo(clientId);
        if (!client || client.userId !== claims.sub) {
          this.sendError(ws, request.id, ErrorCodes.NOT_FOUND, "Client not found");
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
        const versions = (request.params as any)?.protocolVersions || ["1.0"];
        this.sendResponse(ws, request.id, {
          protocolVersion: "1.0",
          serverVersion: process.env.npm_package_version || "1.0.0",
          capabilities: ["compression", "groups", "acknowledgment"],
        });
        break;
      }

      // ============ Group Management API ============

      case "join_group": {
        const params = request.params as { groupType?: string; groupId?: string } | undefined;
        if (!params?.groupType || !params?.groupId) {
          this.sendError(ws, request.id, ErrorCodes.INVALID_PARAMS, "groupType and groupId required");
          return;
        }

        const validGroupTypes: GroupType[] = ["user", "workspace", "session"];
        if (!validGroupTypes.includes(params.groupType as GroupType)) {
          this.sendError(
            ws,
            request.id,
            ErrorCodes.INVALID_PARAMS,
            `Invalid groupType. Must be one of: ${validGroupTypes.join(", ")}`
          );
          return;
        }

        const result = this.connectionManager.joinGroup(
          claims.client_id,
          params.groupType as GroupType,
          params.groupId
        );

        this.sendResponse(ws, request.id, {
          joined: result.success,
          groupType: params.groupType,
          groupId: params.groupId,
          memberCount: result.memberCount,
        });
        break;
      }

      case "leave_group": {
        const params = request.params as { groupType?: string; groupId?: string } | undefined;
        if (!params?.groupType || !params?.groupId) {
          this.sendError(ws, request.id, ErrorCodes.INVALID_PARAMS, "groupType and groupId required");
          return;
        }

        const result = this.connectionManager.leaveGroup(
          claims.client_id,
          params.groupType as GroupType,
          params.groupId
        );

        this.sendResponse(ws, request.id, {
          left: result.success,
          groupType: params.groupType,
          groupId: params.groupId,
          memberCount: result.memberCount,
        });
        break;
      }

      case "list_group_members": {
        const params = request.params as { groupType?: string; groupId?: string } | undefined;
        if (!params?.groupType || !params?.groupId) {
          this.sendError(ws, request.id, ErrorCodes.INVALID_PARAMS, "groupType and groupId required");
          return;
        }

        // Check if client is in the group (only members can list)
        if (!this.connectionManager.isClientInGroup(claims.client_id, params.groupType as GroupType, params.groupId)) {
          this.sendError(ws, request.id, ErrorCodes.FORBIDDEN, "Must be a group member to list members");
          return;
        }

        const members = this.connectionManager.getGroupMembers(
          params.groupType as GroupType,
          params.groupId
        );

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
        this.sendError(ws, request.id, ErrorCodes.METHOD_NOT_FOUND, `Unknown method: ${request.method}`);
    }
  }

  private sendResponse(ws: WebSocket, id: string, result: unknown): void {
    const response: WsSuccessResponse = {
      jsonrpc: "2.0",
      id,
      result,
    };

    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(response));
    }
  }

  private sendError(
    ws: WebSocket,
    id: string | null,
    code: number,
    message: string,
    data?: unknown
  ): void {
    const response: WsErrorResponse = {
      jsonrpc: "2.0",
      id: id || "error",
      error: {
        code,
        message,
        data,
      },
    };

    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(response));
    }
  }

  /**
   * Shutdown the relay
   */
  shutdown(): void {
    // Clear all pending auth timeouts
    for (const timeout of this.pendingAuth.values()) {
      clearTimeout(timeout);
    }
    this.pendingAuth.clear();
  }
}
