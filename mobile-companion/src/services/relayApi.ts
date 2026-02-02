import { getRelayConnection, type RelayMessage } from './relayConnection';

/**
 * Client information as returned by the relay API
 */
export interface Client {
  clientId: string;
  clientType: 'mobile' | 'extension';
  userId: string;
  githubLogin: string;
  connectedAt: string;
  lastSeen: string;
  workspaceName?: string;
  workspacePath?: string;
  vscodeVersion?: string;
  extensionVersion?: string;
  platform?: string;
  isOnline: boolean;
}

/**
 * Session status types
 */
export type SessionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

/**
 * Tool call information
 */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: unknown;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt: string;
  completedAt?: string;
}

/**
 * Session message types
 */
export interface SessionMessage {
  id: string;
  type: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: string;
  toolCall?: ToolCall;
}

/**
 * Session information
 */
export interface Session {
  sessionId: string;
  clientId: string;
  agentName: string;
  prompt: string;
  status: SessionStatus;
  messages: SessionMessage[];
  toolCalls: ToolCall[];
  startedAt: string;
  completedAt?: string;
  error?: string;
}

/**
 * Agent information
 */
export interface Agent {
  name: string;
  displayName: string;
  description: string;
  icon?: string;
}

/**
 * Generate a unique request ID
 */
function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Send a JSON-RPC request via WebSocket and wait for response
 */
async function sendRequest<T>(method: string, params?: Record<string, unknown>): Promise<T> {
  const relay = getRelayConnection();
  const requestId = generateRequestId();

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error('Request timeout'));
    }, 30000); // 30 second timeout

    const unsubscribe = relay.onMessage((message: RelayMessage) => {
      // Check if this is a response to our request
      const payload = message.payload as { id?: string; result?: T; error?: { message: string } };
      if (payload?.id === requestId) {
        clearTimeout(timeout);
        unsubscribe();

        if (payload.error) {
          reject(new Error(payload.error.message));
        } else {
          resolve(payload.result as T);
        }
      }
    });

    const success = relay.send({
      type: 'request',
      payload: {
        jsonrpc: '2.0',
        id: requestId,
        method,
        params,
      },
    });

    if (!success) {
      clearTimeout(timeout);
      unsubscribe();
      reject(new Error('Failed to send request - not connected'));
    }
  });
}

/**
 * Fetch all connected clients for the current user
 */
export async function getClients(): Promise<Client[]> {
  try {
    const result = await sendRequest<{ clients: Client[] }>('list_clients');
    return result.clients || [];
  } catch (error) {
    console.error('Failed to fetch clients:', error);
    throw error;
  }
}

/**
 * Get details for a specific client
 */
export async function getClient(clientId: string): Promise<Client> {
  try {
    const result = await sendRequest<{ client: Client }>('get_client', { clientId });
    return result.client;
  } catch (error) {
    console.error('Failed to fetch client:', error);
    throw error;
  }
}

/**
 * Disconnect a specific client
 */
export async function disconnectClient(clientId: string): Promise<void> {
  try {
    await sendRequest<{ success: boolean }>('disconnect_client', { clientId });
  } catch (error) {
    console.error('Failed to disconnect client:', error);
    throw error;
  }
}

/**
 * Subscribe to client connection events
 * Returns unsubscribe function
 */
export function subscribeToClientEvents(
  onClientConnected: (client: Client) => void,
  onClientDisconnected: (clientId: string) => void,
  onClientUpdated: (client: Client) => void
): () => void {
  const relay = getRelayConnection();

  return relay.onMessage((message: RelayMessage) => {
    switch (message.type) {
      case 'client:connected':
      case 'connection_update': {
        const payload = message.payload as { client?: Client; status?: string };
        if (payload?.client && payload?.status === 'connected') {
          onClientConnected(payload.client);
        } else if (payload?.client && payload?.status === 'disconnected') {
          onClientDisconnected(payload.client.clientId);
        }
        break;
      }
      case 'client:disconnected': {
        const payload = message.payload as { clientId?: string };
        if (payload?.clientId) {
          onClientDisconnected(payload.clientId);
        }
        break;
      }
      case 'client:updated': {
        const payload = message.payload as { client?: Client };
        if (payload?.client) {
          onClientUpdated(payload.client);
        }
        break;
      }
    }
  });
}

// ============================================================================
// Session API Functions
// ============================================================================

/**
 * Fetch all sessions
 */
export async function getSessions(): Promise<Session[]> {
  try {
    const result = await sendRequest<{ sessions: Session[] }>('list_sessions');
    return result.sessions || [];
  } catch (error) {
    console.error('Failed to fetch sessions:', error);
    throw error;
  }
}

/**
 * Get details for a specific session
 */
export async function getSessionDetails(sessionId: string): Promise<Session> {
  try {
    const result = await sendRequest<{ session: Session }>('get_session', { sessionId });
    return result.session;
  } catch (error) {
    console.error('Failed to fetch session details:', error);
    throw error;
  }
}

/**
 * Start a new session
 */
export async function startSession(
  clientId: string,
  agentName: string,
  prompt: string
): Promise<Session> {
  try {
    const result = await sendRequest<{ session: Session }>('start_session', {
      clientId,
      agentName,
      prompt,
    });
    return result.session;
  } catch (error) {
    console.error('Failed to start session:', error);
    throw error;
  }
}

/**
 * Cancel a running session
 */
export async function cancelSession(sessionId: string): Promise<void> {
  try {
    await sendRequest<{ success: boolean }>('cancel_session', { sessionId });
  } catch (error) {
    console.error('Failed to cancel session:', error);
    throw error;
  }
}

/**
 * Fetch available agents
 */
export async function getAgents(): Promise<Agent[]> {
  try {
    const result = await sendRequest<{ agents: Agent[] }>('list_agents');
    return result.agents || [];
  } catch (error) {
    console.error('Failed to fetch agents:', error);
    throw error;
  }
}

/**
 * Session event types for WebSocket subscription
 */
export interface SessionEventCallbacks {
  onSessionStarted?: (session: Session) => void;
  onSessionMessage?: (sessionId: string, message: SessionMessage) => void;
  onSessionToolCall?: (sessionId: string, toolCall: ToolCall) => void;
  onSessionToolResult?: (sessionId: string, toolCallId: string, result: unknown) => void;
  onSessionCompleted?: (session: Session) => void;
  onSessionFailed?: (sessionId: string, error: string) => void;
  onSessionCancelled?: (sessionId: string) => void;
}

/**
 * Subscribe to session events via WebSocket
 * Returns unsubscribe function
 */
export function subscribeToSessionEvents(callbacks: SessionEventCallbacks): () => void {
  const relay = getRelayConnection();

  return relay.onMessage((message: RelayMessage) => {
    switch (message.type) {
      case 'session:started': {
        const payload = message.payload as { session?: Session };
        if (payload?.session && callbacks.onSessionStarted) {
          callbacks.onSessionStarted(payload.session);
        }
        break;
      }
      case 'session:message': {
        const payload = message.payload as { sessionId?: string; message?: SessionMessage };
        if (payload?.sessionId && payload?.message && callbacks.onSessionMessage) {
          callbacks.onSessionMessage(payload.sessionId, payload.message);
        }
        break;
      }
      case 'session:tool-call': {
        const payload = message.payload as { sessionId?: string; toolCall?: ToolCall };
        if (payload?.sessionId && payload?.toolCall && callbacks.onSessionToolCall) {
          callbacks.onSessionToolCall(payload.sessionId, payload.toolCall);
        }
        break;
      }
      case 'session:tool-result': {
        const payload = message.payload as { sessionId?: string; toolCallId?: string; result?: unknown };
        if (payload?.sessionId && payload?.toolCallId && callbacks.onSessionToolResult) {
          callbacks.onSessionToolResult(payload.sessionId, payload.toolCallId, payload.result);
        }
        break;
      }
      case 'session:completed': {
        const payload = message.payload as { session?: Session };
        if (payload?.session && callbacks.onSessionCompleted) {
          callbacks.onSessionCompleted(payload.session);
        }
        break;
      }
      case 'session:failed': {
        const payload = message.payload as { sessionId?: string; error?: string };
        if (payload?.sessionId && callbacks.onSessionFailed) {
          callbacks.onSessionFailed(payload.sessionId, payload.error || 'Unknown error');
        }
        break;
      }
      case 'session:cancelled': {
        const payload = message.payload as { sessionId?: string };
        if (payload?.sessionId && callbacks.onSessionCancelled) {
          callbacks.onSessionCancelled(payload.sessionId);
        }
        break;
      }
    }
  });
}
