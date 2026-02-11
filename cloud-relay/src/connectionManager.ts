/**
 * Connection Manager
 * Tracks all connected WebSocket clients by userId and clientId
 * Enhanced with connection groups for routing and offline queue
 */

import WebSocket from "ws";
import { ConnectedClient, RelayEnvelope } from "./types";
import { GroupManager, GroupType } from "./connectionGroups";
import { AcknowledgmentManager } from "./acknowledgment";
import { DeadLetterQueue } from "./deadLetterQueue";
import { IOfflineQueue, OfflineQueue, OfflineQueueStats, UserQueueStats } from "./offlineQueue";

export interface RoutingMetrics {
  messagesRouted: number;
  messagesDelivered: number;
  messagesFailed: number;
  groupMessages: number;
}

export class ConnectionManager {
  // Map of clientId -> WebSocket
  private clients: Map<string, WebSocket> = new Map();

  // Map of clientId -> ConnectedClient metadata
  private clientInfo: Map<string, ConnectedClient> = new Map();

  // Map of userId -> Set<clientId> for quick user lookup
  private userClients: Map<string, Set<string>> = new Map();

  // Group manager for connection groups
  private groupManager: GroupManager;

  // Acknowledgment manager for reliable delivery
  private ackManager: AcknowledgmentManager;

  // Dead letter queue
  private deadLetterQueue: DeadLetterQueue;

  // Offline message queue
  private offlineQueue: IOfflineQueue;

  // Routing metrics
  private metrics: RoutingMetrics = {
    messagesRouted: 0,
    messagesDelivered: 0,
    messagesFailed: 0,
    groupMessages: 0,
  };

  // Heartbeat interval (30 seconds)
  private readonly HEARTBEAT_INTERVAL = 30000;

  // Connection timeout (60 seconds without pong)
  private readonly CONNECTION_TIMEOUT = 60000;

  private heartbeatTimer?: NodeJS.Timeout;

  constructor(offlineQueue?: IOfflineQueue) {
    this.deadLetterQueue = new DeadLetterQueue();
    this.offlineQueue = offlineQueue ?? new OfflineQueue();
    this.groupManager = new GroupManager();
    this.ackManager = new AcknowledgmentManager(this.deadLetterQueue);
    this.startHeartbeat();
  }

  /**
   * Initialize async resources (load persisted offline queue)
   */
  async initialize(): Promise<void> {
    await this.offlineQueue.load();
  }

  /**
   * Register a new client connection
   */
  addClient(
    ws: WebSocket,
    clientId: string,
    clientType: "mobile" | "extension",
    userId: string,
    githubLogin: string
  ): void {
    // Store WebSocket
    this.clients.set(clientId, ws);

    // Store client metadata
    const client: ConnectedClient = {
      clientId,
      clientType,
      userId,
      githubLogin,
      connectedAt: new Date(),
      lastSeen: new Date(),
      subscriptions: new Set(),
    };
    this.clientInfo.set(clientId, client);

    // Track by userId
    if (!this.userClients.has(userId)) {
      this.userClients.set(userId, new Set());
    }
    this.userClients.get(userId)!.add(clientId);

    console.log(
      `[ConnectionManager] Client connected: ${clientId} (${clientType}) for user ${githubLogin}`
    );
  }

  /**
   * Remove a client connection
   */
  removeClient(clientId: string): void {
    const info = this.clientInfo.get(clientId);
    if (info) {
      // Remove from user tracking
      const userSet = this.userClients.get(info.userId);
      if (userSet) {
        userSet.delete(clientId);
        if (userSet.size === 0) {
          this.userClients.delete(info.userId);
        }
      }

      console.log(
        `[ConnectionManager] Client disconnected: ${clientId} (${info.clientType})`
      );
    }

    // Remove from all groups
    this.groupManager.removeClientFromAllGroups(clientId);

    // Cancel pending ACKs for this client
    this.ackManager.cancelForClient(clientId);

    this.clients.delete(clientId);
    this.clientInfo.delete(clientId);
  }

  /**
   * Get WebSocket by clientId
   */
  getClient(clientId: string): WebSocket | undefined {
    return this.clients.get(clientId);
  }

  /**
   * Get client metadata by clientId
   */
  getClientInfo(clientId: string): ConnectedClient | undefined {
    return this.clientInfo.get(clientId);
  }

  /**
   * Get all clients for a userId
   */
  getClientsByUserId(userId: string): ConnectedClient[] {
    const clientIds = this.userClients.get(userId);
    if (!clientIds) return [];

    return Array.from(clientIds)
      .map((id) => this.clientInfo.get(id))
      .filter((c): c is ConnectedClient => c !== undefined);
  }

  /**
   * Get all clients of a specific type for a user
   */
  getClientsByUserIdAndType(
    userId: string,
    clientType: "mobile" | "extension"
  ): ConnectedClient[] {
    return this.getClientsByUserId(userId).filter(
      (c) => c.clientType === clientType
    );
  }

  /**
   * Update client's last seen timestamp
   */
  updateLastSeen(clientId: string): void {
    const info = this.clientInfo.get(clientId);
    if (info) {
      info.lastSeen = new Date();
    }
  }

  /**
   * Handle message acknowledgment
   */
  acknowledgeMessage(messageId: string): boolean {
    return this.ackManager.acknowledgeMessage(messageId);
  }

  /**
   * Route a message to target client(s)
   * Supports: direct (clientId), user broadcast, and group-based routing
   */
  routeMessage(
    envelope: RelayEnvelope,
    options?: {
      requireAck?: boolean;
      groupType?: GroupType;
      groupId?: string;
      skipOfflineQueue?: boolean;
    }
  ): { success: boolean; delivered: number; offline: number } {
    const { target } = envelope;
    let delivered = 0;
    let offline = 0;
    const requireAck = options?.requireAck ?? false;

    this.metrics.messagesRouted++;

    // Group-based routing
    if (options?.groupType && options?.groupId) {
      this.metrics.groupMessages++;
      const members = this.groupManager.getGroupMembers(
        options.groupType,
        options.groupId
      );

      for (const clientId of members) {
        // Don't send back to source
        if (clientId === envelope.source.clientId) continue;

        const ws = this.clients.get(clientId);
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(envelope));
          if (requireAck) {
            this.ackManager.trackMessage(envelope, clientId, ws);
          }
          delivered++;
        } else {
          offline++;
        }
      }
    } else if (target.type === "broadcast" && target.userId) {
      // Broadcast to all clients of a user
      const clients = this.getClientsByUserId(target.userId);
      for (const client of clients) {
        // Don't send back to source
        if (client.clientId === envelope.source.clientId) continue;

        const ws = this.clients.get(client.clientId);
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(envelope));
          if (requireAck) {
            this.ackManager.trackMessage(envelope, client.clientId, ws);
          }
          delivered++;
        } else {
          offline++;
        }
      }
    } else if (target.clientId) {
      // Direct message to specific client
      const ws = this.clients.get(target.clientId);
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(envelope));
        if (requireAck) {
          this.ackManager.trackMessage(envelope, target.clientId, ws);
        }
        delivered++;
      } else {
        offline++;
      }
    } else if (target.userId) {
      // Send to first available client of target type for user
      const clients = this.getClientsByUserIdAndType(
        target.userId,
        target.type as "mobile" | "extension"
      );
      
      for (const client of clients) {
        const ws = this.clients.get(client.clientId);
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(envelope));
          if (requireAck) {
            this.ackManager.trackMessage(envelope, client.clientId, ws);
          }
          delivered++;
          break; // Only send to first available
        }
      }
      
      if (delivered === 0) {
        offline = clients.length || 1;
      }
    }

    // Update metrics
    if (delivered > 0) {
      this.metrics.messagesDelivered += delivered;
    } else {
      this.metrics.messagesFailed++;
      
      // Try to enqueue for offline delivery if target has a userId
      if (target.userId && !options?.skipOfflineQueue) {
        const enqueueResult = this.offlineQueue.enqueue(envelope);
        if (enqueueResult.success) {
          console.log(`[ConnectionManager] Message ${envelope.messageId} queued for offline user ${target.userId}`);
        } else {
          // Only add to dead letter queue if we couldn't enqueue
          this.deadLetterQueue.add(
            envelope,
            `No available recipients: ${enqueueResult.reason || "unknown"}`,
            target.clientId
          );
        }
      } else {
        // No userId to queue for, add to dead letter queue
        this.deadLetterQueue.add(
          envelope,
          "No available recipients",
          target.clientId
        );
      }
    }

    return {
      success: delivered > 0,
      delivered,
      offline,
    };
  }

  /**
   * Deliver queued offline messages to a reconnecting client
   */
  deliverQueuedMessages(
    userId: string,
    clientId: string,
    ws: WebSocket
  ): { delivered: number; failed: number } {
    const messages = this.offlineQueue.dequeueForClient(userId, clientId);

    if (messages.length === 0) {
      return { delivered: 0, failed: 0 };
    }

    let delivered = 0;
    let failed = 0;

    for (const message of messages) {
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(message.payload));
          delivered++;
        } else {
          // Re-queue if connection dropped
          this.offlineQueue.enqueue(message.payload, message.messageType);
          failed++;
        }
      } catch (error) {
        console.error(`[ConnectionManager] Failed to deliver queued message:`, error);
        failed++;
      }
    }

    console.log(
      `[ConnectionManager] Delivered ${delivered} queued messages to user ${userId} (client: ${clientId})`
    );

    return { delivered, failed };
  }

  // ============ Offline Queue Stats ============

  /**
   * Get offline queue stats for a specific user
   */
  getOfflineQueueStats(userId: string): UserQueueStats {
    return this.offlineQueue.getQueueStats(userId);
  }

  /**
   * Get overall offline queue stats
   */
  getOfflineQueueOverallStats(): OfflineQueueStats {
    return this.offlineQueue.getStats();
  }

  // ============ Group Management ============

  /**
   * Join a connection group
   */
  joinGroup(
    clientId: string,
    groupType: GroupType,
    groupId: string
  ): { success: boolean; memberCount: number } {
    return this.groupManager.joinGroup(clientId, groupType, groupId);
  }

  /**
   * Leave a connection group
   */
  leaveGroup(
    clientId: string,
    groupType: GroupType,
    groupId: string
  ): { success: boolean; memberCount: number } {
    return this.groupManager.leaveGroup(clientId, groupType, groupId);
  }

  /**
   * Get all members of a group
   */
  getGroupMembers(groupType: GroupType, groupId: string): string[] {
    return this.groupManager.getGroupMembers(groupType, groupId);
  }

  /**
   * Get all groups a client belongs to
   */
  getClientGroups(clientId: string): Array<{ groupType: GroupType; groupId: string }> {
    return this.groupManager.getClientGroups(clientId);
  }

  /**
   * Check if client is in a group
   */
  isClientInGroup(clientId: string, groupType: GroupType, groupId: string): boolean {
    return this.groupManager.isClientInGroup(clientId, groupType, groupId);
  }

  /**
   * List all connected clients (for admin/debugging)
   */
  listAllClients(): ConnectedClient[] {
    return Array.from(this.clientInfo.values());
  }

  /**
   * Get connection statistics
   */
  getStats(): {
    totalClients: number;
    mobileClients: number;
    extensionClients: number;
    uniqueUsers: number;
  } {
    const clients = this.listAllClients();
    return {
      totalClients: clients.length,
      mobileClients: clients.filter((c) => c.clientType === "mobile").length,
      extensionClients: clients.filter((c) => c.clientType === "extension").length,
      uniqueUsers: this.userClients.size,
    };
  }

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
  } {
    const offlineQueueStats = this.offlineQueue.getStats();
    const offlineQueueMetrics = this.offlineQueue.getMetrics();

    return {
      connections: this.getStats(),
      groups: this.groupManager.getStats(),
      routing: { ...this.metrics },
      acknowledgment: this.ackManager.getStats(),
      deadLetterQueue: this.deadLetterQueue.getStats(),
      offlineQueue: {
        ...offlineQueueStats,
        metrics: offlineQueueMetrics,
      },
    };
  }

  /**
   * Get dead letter queue entries (for debugging)
   */
  getDeadLetters(options?: { limit?: number; targetClientId?: string }): unknown[] {
    return this.deadLetterQueue.list(options);
  }

  /**
   * Start heartbeat ping cycle
   */
  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      const now = Date.now();
      const pingMessage = JSON.stringify({
        jsonrpc: "2.0",
        method: "ping",
        params: { timestamp: now },
      });

      for (const [clientId, ws] of this.clients) {
        const info = this.clientInfo.get(clientId);

        // Check for stale connections
        if (info && now - info.lastSeen.getTime() > this.CONNECTION_TIMEOUT) {
          console.log(
            `[ConnectionManager] Client ${clientId} timed out, closing connection`
          );
          ws.terminate();
          this.removeClient(clientId);
          continue;
        }

        // Send ping
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(pingMessage);
        }
      }
    }, this.HEARTBEAT_INTERVAL);
  }

  /**
   * Stop heartbeat and cleanup
   */
  async shutdown(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }

    // Clear acknowledgment manager
    this.ackManager.clear();

    // Shutdown offline queue (saves state if persistence enabled)
    await this.offlineQueue.shutdown();

    // Clear dead letter queue and stop cleanup timer
    this.deadLetterQueue.shutdown();

    // Clear group manager
    this.groupManager.clear();

    // Close all connections
    for (const [clientId, ws] of this.clients) {
      ws.close(1001, "Server shutting down");
      this.removeClient(clientId);
    }
  }
}
