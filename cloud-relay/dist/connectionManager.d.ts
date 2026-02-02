/**
 * Connection Manager
 * Tracks all connected WebSocket clients by userId and clientId
 * Enhanced with connection groups for routing and offline queue
 */
import WebSocket from "ws";
import { ConnectedClient, RelayEnvelope } from "./types";
import { GroupType } from "./connectionGroups";
import { OfflineQueueStats, UserQueueStats } from "./offlineQueue";
export interface RoutingMetrics {
    messagesRouted: number;
    messagesDelivered: number;
    messagesFailed: number;
    groupMessages: number;
}
export declare class ConnectionManager {
    private clients;
    private clientInfo;
    private userClients;
    private groupManager;
    private ackManager;
    private deadLetterQueue;
    private offlineQueue;
    private metrics;
    private readonly HEARTBEAT_INTERVAL;
    private readonly CONNECTION_TIMEOUT;
    private heartbeatTimer?;
    constructor();
    /**
     * Initialize async resources (load persisted offline queue)
     */
    initialize(): Promise<void>;
    /**
     * Register a new client connection
     */
    addClient(ws: WebSocket, clientId: string, clientType: "mobile" | "extension", userId: string, githubLogin: string): void;
    /**
     * Remove a client connection
     */
    removeClient(clientId: string): void;
    /**
     * Get WebSocket by clientId
     */
    getClient(clientId: string): WebSocket | undefined;
    /**
     * Get client metadata by clientId
     */
    getClientInfo(clientId: string): ConnectedClient | undefined;
    /**
     * Get all clients for a userId
     */
    getClientsByUserId(userId: string): ConnectedClient[];
    /**
     * Get all clients of a specific type for a user
     */
    getClientsByUserIdAndType(userId: string, clientType: "mobile" | "extension"): ConnectedClient[];
    /**
     * Update client's last seen timestamp
     */
    updateLastSeen(clientId: string): void;
    /**
     * Handle message acknowledgment
     */
    acknowledgeMessage(messageId: string): boolean;
    /**
     * Route a message to target client(s)
     * Supports: direct (clientId), user broadcast, and group-based routing
     */
    routeMessage(envelope: RelayEnvelope, options?: {
        requireAck?: boolean;
        groupType?: GroupType;
        groupId?: string;
        skipOfflineQueue?: boolean;
    }): {
        success: boolean;
        delivered: number;
        offline: number;
    };
    /**
     * Deliver queued offline messages to a reconnecting client
     */
    deliverQueuedMessages(userId: string, clientId: string, ws: WebSocket): {
        delivered: number;
        failed: number;
    };
    /**
     * Get offline queue stats for a specific user
     */
    getOfflineQueueStats(userId: string): UserQueueStats;
    /**
     * Get overall offline queue stats
     */
    getOfflineQueueOverallStats(): OfflineQueueStats;
    /**
     * Join a connection group
     */
    joinGroup(clientId: string, groupType: GroupType, groupId: string): {
        success: boolean;
        memberCount: number;
    };
    /**
     * Leave a connection group
     */
    leaveGroup(clientId: string, groupType: GroupType, groupId: string): {
        success: boolean;
        memberCount: number;
    };
    /**
     * Get all members of a group
     */
    getGroupMembers(groupType: GroupType, groupId: string): string[];
    /**
     * Get all groups a client belongs to
     */
    getClientGroups(clientId: string): Array<{
        groupType: GroupType;
        groupId: string;
    }>;
    /**
     * Check if client is in a group
     */
    isClientInGroup(clientId: string, groupType: GroupType, groupId: string): boolean;
    /**
     * List all connected clients (for admin/debugging)
     */
    listAllClients(): ConnectedClient[];
    /**
     * Get connection statistics
     */
    getStats(): {
        totalClients: number;
        mobileClients: number;
        extensionClients: number;
        uniqueUsers: number;
    };
    /**
     * Get extended stats including groups, routing, DLQ, and offline queue
     */
    getExtendedStats(): {
        connections: {
            totalClients: number;
            mobileClients: number;
            extensionClients: number;
            uniqueUsers: number;
        };
        groups: {
            totalGroups: number;
            userGroups: number;
            workspaceGroups: number;
            sessionGroups: number;
            totalMemberships: number;
        };
        routing: RoutingMetrics;
        acknowledgment: {
            pending: number;
            acknowledged: number;
            retried: number;
            failed: number;
        };
        deadLetterQueue: {
            size: number;
            totalReceived: number;
        };
        offlineQueue: {
            totalPending: number;
            usersWithPending: number;
            oldestMessageAge?: number;
            processedIdsCount: number;
            metrics: {
                enqueued: number;
                dequeued: number;
                expired: number;
                evicted: number;
                duplicatesPrevented: number;
            };
        };
    };
    /**
     * Get dead letter queue entries (for debugging)
     */
    getDeadLetters(options?: {
        limit?: number;
        targetClientId?: string;
    }): unknown[];
    /**
     * Start heartbeat ping cycle
     */
    private startHeartbeat;
    /**
     * Stop heartbeat and cleanup
     */
    shutdown(): Promise<void>;
}
//# sourceMappingURL=connectionManager.d.ts.map