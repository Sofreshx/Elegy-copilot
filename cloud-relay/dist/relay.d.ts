/**
 * WebSocket Relay Server
 * Handles client connections, JWT authentication, and message routing
 */
import { WebSocketServer } from "ws";
import { ConnectionManager } from "./connectionManager";
export interface RelayConfig {
    jwtSecret: string;
    jwtIssuer: string;
    jwtAudience: string;
    maxMessageSize: number;
    requireAuth: boolean;
}
export declare class WebSocketRelay {
    private wss;
    private connectionManager;
    private config;
    private pendingAuth;
    private readonly AUTH_TIMEOUT;
    constructor(wss: WebSocketServer, connectionManager: ConnectionManager, config: RelayConfig);
    private setupConnectionHandler;
    private verifyToken;
    private completeAuth;
    private handleMessage;
    private handleAuthMessage;
    private handleRelayEnvelope;
    private handleControlMessage;
    private sendResponse;
    private sendError;
    /**
     * Shutdown the relay
     */
    shutdown(): void;
}
//# sourceMappingURL=relay.d.ts.map