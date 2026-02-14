/**
 * Health endpoint for monitoring
 */

import { Router, Request, Response } from "express";
import { ConnectionManager } from "./connectionManager";

function getMissingEnv(keys: string[]): string[] {
  const missing: string[] = [];
  for (const key of keys) {
    const value = process.env[key];
    if (!value || value.trim().length === 0) {
      missing.push(key);
    }
  }
  return missing;
}

function getReadinessStatus(): { ready: boolean; missing: string[] } {
  const requireAuth = process.env.REQUIRE_AUTH !== "false";
  if (!requireAuth) {
    return { ready: true, missing: [] };
  }

  // When auth is required, the mobile OAuth callback flow needs these.
  const missing = getMissingEnv(["GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET"]);
  return { ready: missing.length === 0, missing };
}

export function createHealthRouter(
  connectionManager: ConnectionManager,
  startTime: Date
): Router {
  const router = Router();

  /**
   * GET /health
   * Returns service health status and metrics
   */
  router.get("/health", (_req: Request, res: Response) => {
    const extendedStats = connectionManager.getExtendedStats();
    const uptimeMs = Date.now() - startTime.getTime();
    const readiness = getReadinessStatus();

    res.json({
      status: "healthy",
      readiness: {
        ready: readiness.ready,
        missing: readiness.missing,
      },
      version: process.env.npm_package_version || "1.0.0",
      uptime: {
        ms: uptimeMs,
        seconds: Math.floor(uptimeMs / 1000),
        human: formatUptime(uptimeMs),
      },
      connections: {
        total: extendedStats.connections.totalClients,
        mobile: extendedStats.connections.mobileClients,
        extension: extendedStats.connections.extensionClients,
        uniqueUsers: extendedStats.connections.uniqueUsers,
      },
      groups: {
        total: extendedStats.groups.totalGroups,
        user: extendedStats.groups.userGroups,
        workspace: extendedStats.groups.workspaceGroups,
        session: extendedStats.groups.sessionGroups,
        memberships: extendedStats.groups.totalMemberships,
      },
      routing: {
        messagesRouted: extendedStats.routing.messagesRouted,
        messagesDelivered: extendedStats.routing.messagesDelivered,
        messagesFailed: extendedStats.routing.messagesFailed,
        groupMessages: extendedStats.routing.groupMessages,
        successRate:
          extendedStats.routing.messagesRouted > 0
            ? (
                (extendedStats.routing.messagesDelivered /
                  extendedStats.routing.messagesRouted) *
                100
              ).toFixed(2) + "%"
            : "N/A",
      },
      acknowledgment: {
        pending: extendedStats.acknowledgment.pending,
        acknowledged: extendedStats.acknowledgment.acknowledged,
        retried: extendedStats.acknowledgment.retried,
        failed: extendedStats.acknowledgment.failed,
      },
      deadLetterQueue: {
        size: extendedStats.deadLetterQueue.size,
        totalReceived: extendedStats.deadLetterQueue.totalReceived,
      },
      offlineQueue: {
        pending: extendedStats.offlineQueue.totalPending,
        usersWithPending: extendedStats.offlineQueue.usersWithPending,
        oldestMessageAge: extendedStats.offlineQueue.oldestMessageAge
          ? `${Math.floor(extendedStats.offlineQueue.oldestMessageAge / 1000)}s`
          : null,
        processedIdsTracked: extendedStats.offlineQueue.processedIdsCount,
        metrics: {
          enqueued: extendedStats.offlineQueue.metrics.enqueued,
          dequeued: extendedStats.offlineQueue.metrics.dequeued,
          expired: extendedStats.offlineQueue.metrics.expired,
          evicted: extendedStats.offlineQueue.metrics.evicted,
          duplicatesPrevented: extendedStats.offlineQueue.metrics.duplicatesPrevented,
        },
      },
      timestamp: new Date().toISOString(),
    });
  });

  /**
   * GET /health/ready
   * Kubernetes readiness probe
   */
  router.get("/health/ready", (_req: Request, res: Response) => {
    const readiness = getReadinessStatus();
    if (!readiness.ready) {
      res.status(503).json({ ready: false, missing: readiness.missing });
      return;
    }
    res.status(200).json({ ready: true });
  });

  /**
   * GET /health/live
   * Kubernetes liveness probe
   */
  router.get("/health/live", (_req: Request, res: Response) => {
    res.status(200).json({ live: true });
  });

  /**
   * GET /health/dlq
   * Dead letter queue entries (for debugging)
   */
  router.get("/health/dlq", (req: Request, res: Response) => {
    const limit = parseInt(req.query.limit as string) || 50;
    const targetClientId = req.query.clientId as string | undefined;

    const entries = connectionManager.getDeadLetters({
      limit,
      targetClientId,
    });

    res.json({
      count: entries.length,
      entries,
    });
  });

  /**
   * GET /health/metrics
   * Prometheus-style metrics
   */
  router.get("/health/metrics", (_req: Request, res: Response) => {
    const stats = connectionManager.getExtendedStats();
    const uptimeMs = Date.now() - startTime.getTime();

    const lines = [
      "# HELP relay_uptime_seconds Time since relay started",
      "# TYPE relay_uptime_seconds gauge",
      `relay_uptime_seconds ${Math.floor(uptimeMs / 1000)}`,
      "",
      "# HELP relay_connections_total Total connected clients",
      "# TYPE relay_connections_total gauge",
      `relay_connections_total{type="mobile"} ${stats.connections.mobileClients}`,
      `relay_connections_total{type="extension"} ${stats.connections.extensionClients}`,
      "",
      "# HELP relay_users_total Unique connected users",
      "# TYPE relay_users_total gauge",
      `relay_users_total ${stats.connections.uniqueUsers}`,
      "",
      "# HELP relay_groups_total Active connection groups",
      "# TYPE relay_groups_total gauge",
      `relay_groups_total{type="user"} ${stats.groups.userGroups}`,
      `relay_groups_total{type="workspace"} ${stats.groups.workspaceGroups}`,
      `relay_groups_total{type="session"} ${stats.groups.sessionGroups}`,
      "",
      "# HELP relay_messages_total Messages processed",
      "# TYPE relay_messages_total counter",
      `relay_messages_total{status="routed"} ${stats.routing.messagesRouted}`,
      `relay_messages_total{status="delivered"} ${stats.routing.messagesDelivered}`,
      `relay_messages_total{status="failed"} ${stats.routing.messagesFailed}`,
      `relay_messages_total{status="group"} ${stats.routing.groupMessages}`,
      "",
      "# HELP relay_ack_total Acknowledgment status",
      "# TYPE relay_ack_total gauge",
      `relay_ack_total{status="pending"} ${stats.acknowledgment.pending}`,
      `relay_ack_total{status="acknowledged"} ${stats.acknowledgment.acknowledged}`,
      `relay_ack_total{status="retried"} ${stats.acknowledgment.retried}`,
      `relay_ack_total{status="failed"} ${stats.acknowledgment.failed}`,
      "",
      "# HELP relay_dlq_size Dead letter queue size",
      "# TYPE relay_dlq_size gauge",
      `relay_dlq_size ${stats.deadLetterQueue.size}`,
      "",
      "# HELP relay_offline_queue_pending Pending offline messages",
      "# TYPE relay_offline_queue_pending gauge",
      `relay_offline_queue_pending ${stats.offlineQueue.totalPending}`,
      "",
      "# HELP relay_offline_queue_users_with_pending Users with pending offline messages",
      "# TYPE relay_offline_queue_users_with_pending gauge",
      `relay_offline_queue_users_with_pending ${stats.offlineQueue.usersWithPending}`,
      "",
      "# HELP relay_offline_queue_total Operations on offline queue",
      "# TYPE relay_offline_queue_total counter",
      `relay_offline_queue_total{operation="enqueued"} ${stats.offlineQueue.metrics.enqueued}`,
      `relay_offline_queue_total{operation="dequeued"} ${stats.offlineQueue.metrics.dequeued}`,
      `relay_offline_queue_total{operation="expired"} ${stats.offlineQueue.metrics.expired}`,
      `relay_offline_queue_total{operation="evicted"} ${stats.offlineQueue.metrics.evicted}`,
      `relay_offline_queue_total{operation="duplicates_prevented"} ${stats.offlineQueue.metrics.duplicatesPrevented}`,
    ];

    res.type("text/plain").send(lines.join("\n"));
  });

  return router;
}

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h ${minutes % 60}m`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}
