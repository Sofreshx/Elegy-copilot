/**
 * Types and handlers for GitHub webhook events received via relay.
 * The actual webhook endpoint is in the relay service (backend).
 * Mobile companion subscribes to status updates via WebSocket.
 */

export type WorkflowAction = 'requested' | 'in_progress' | 'completed';
export type WorkflowConclusion = 'success' | 'failure' | 'cancelled' | 'timed_out' | 'neutral' | 'skipped';

export interface WorkflowRunEvent {
  action: WorkflowAction;
  workflowRun: {
    id: number;
    name: string;
    status: string;
    conclusion: WorkflowConclusion | null;
    htmlUrl: string;
    logsUrl: string;
    createdAt: string;
    updatedAt: string;
  };
  sessionId?: string;
  agentName?: string;
}

export interface WorkflowStatusUpdate {
  type: 'workflow_status';
  sessionId: string;
  workflowRunId: number;
  status: 'queued' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
  conclusion?: WorkflowConclusion;
  logsUrl?: string;
  htmlUrl?: string;
  timestamp: string;
  agentName?: string;
  error?: string;
}

// Notification priorities for different workflow states
export const WORKFLOW_NOTIFICATION_PRIORITY: Record<WorkflowStatusUpdate['status'], 'low' | 'normal' | 'high'> = {
  queued: 'low',
  in_progress: 'low',
  completed: 'normal',
  failed: 'high',
  cancelled: 'normal',
};

/**
 * Map workflow status to user-friendly message
 */
export function getWorkflowStatusMessage(update: WorkflowStatusUpdate): string {
  const agent = update.agentName || 'Agent';
  
  switch (update.status) {
    case 'queued':
      return `${agent} session queued`;
    case 'in_progress':
      return `${agent} is running...`;
    case 'completed':
      return update.conclusion === 'success'
        ? `${agent} completed successfully`
        : `${agent} completed with status: ${update.conclusion}`;
    case 'failed':
      return `${agent} failed: ${update.error || 'Unknown error'}`;
    case 'cancelled':
      return `${agent} session was cancelled`;
    default:
      return `${agent} status: ${update.status}`;
  }
}

/**
 * Get notification icon for workflow status
 */
export function getWorkflowStatusIcon(status: WorkflowStatusUpdate['status']): string {
  switch (status) {
    case 'queued':
      return '⏳';
    case 'in_progress':
      return '🔄';
    case 'completed':
      return '✅';
    case 'failed':
      return '❌';
    case 'cancelled':
      return '⛔';
    default:
      return '❓';
  }
}

/**
 * Check if workflow status is terminal (no more updates expected)
 */
export function isTerminalStatus(status: WorkflowStatusUpdate['status']): boolean {
  return ['completed', 'failed', 'cancelled'].includes(status);
}

/**
 * Class to manage workflow status subscriptions
 */
class WorkflowStatusManager {
  private listeners: Map<string, Set<(update: WorkflowStatusUpdate) => void>> = new Map();
  private globalListeners: Set<(update: WorkflowStatusUpdate) => void> = new Set();
  private recentUpdates: WorkflowStatusUpdate[] = [];
  private maxRecentUpdates = 50;

  /**
   * Subscribe to updates for a specific session
   */
  subscribe(sessionId: string, callback: (update: WorkflowStatusUpdate) => void): () => void {
    if (!this.listeners.has(sessionId)) {
      this.listeners.set(sessionId, new Set());
    }
    this.listeners.get(sessionId)!.add(callback);
    
    return () => {
      this.listeners.get(sessionId)?.delete(callback);
    };
  }

  /**
   * Subscribe to all workflow updates (for notification banner)
   */
  subscribeAll(callback: (update: WorkflowStatusUpdate) => void): () => void {
    this.globalListeners.add(callback);
    return () => {
      this.globalListeners.delete(callback);
    };
  }

  /**
   * Handle incoming workflow status update from relay
   */
  handleUpdate(update: WorkflowStatusUpdate): void {
    // Store in recent updates
    this.recentUpdates.unshift(update);
    if (this.recentUpdates.length > this.maxRecentUpdates) {
      this.recentUpdates.pop();
    }

    // Notify session-specific listeners
    const sessionListeners = this.listeners.get(update.sessionId);
    if (sessionListeners) {
      sessionListeners.forEach((callback) => callback(update));
    }

    // Notify global listeners
    this.globalListeners.forEach((callback) => callback(update));
  }

  /**
   * Get recent updates (for UI display)
   */
  getRecentUpdates(): WorkflowStatusUpdate[] {
    return [...this.recentUpdates];
  }

  /**
   * Get updates for a specific session
   */
  getSessionUpdates(sessionId: string): WorkflowStatusUpdate[] {
    return this.recentUpdates.filter((u) => u.sessionId === sessionId);
  }

  /**
   * Clear all listeners and updates
   */
  clear(): void {
    this.listeners.clear();
    this.globalListeners.clear();
    this.recentUpdates = [];
  }
}

export const workflowStatusManager = new WorkflowStatusManager();

/**
 * Parse raw webhook payload into WorkflowStatusUpdate
 * Used by relay connection to process incoming messages
 */
export function parseWorkflowStatusMessage(data: unknown): WorkflowStatusUpdate | null {
  if (!data || typeof data !== 'object') {
    return null;
  }

  const obj = data as Record<string, unknown>;
  
  if (obj.type !== 'workflow_status') {
    return null;
  }

  return {
    type: 'workflow_status',
    sessionId: String(obj.sessionId || obj.session_id || ''),
    workflowRunId: Number(obj.workflowRunId || obj.workflow_run_id || 0),
    status: obj.status as WorkflowStatusUpdate['status'],
    conclusion: obj.conclusion as WorkflowConclusion | undefined,
    logsUrl: obj.logsUrl || obj.logs_url ? String(obj.logsUrl || obj.logs_url) : undefined,
    htmlUrl: obj.htmlUrl || obj.html_url ? String(obj.htmlUrl || obj.html_url) : undefined,
    timestamp: String(obj.timestamp || new Date().toISOString()),
    agentName: obj.agentName || obj.agent_name ? String(obj.agentName || obj.agent_name) : undefined,
    error: obj.error ? String(obj.error) : undefined,
  };
}
