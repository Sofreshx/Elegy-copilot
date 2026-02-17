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
      // Match response by message.id (set by envelope unwrapper from JSON-RPC id)
      if (message.id === requestId) {
        clearTimeout(timeout);
        unsubscribe();

        if (message.type === 'error') {
          const err = message.payload as { message?: string; code?: number };
          reject(new Error(err?.message ?? 'Request failed'));
        } else {
          resolve(message.payload as T);
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
    // Handle relay event notifications (method: 'event', params: ExtensionEvent)
    if (message.type === 'event') {
      const event = message.payload as { type: string; payload?: unknown };
      switch (event.type) {
        case 'client_connected': {
          const data = event.payload as { client?: Client };
          if (data?.client) onClientConnected(data.client);
          break;
        }
        case 'client_disconnected': {
          const data = event.payload as { clientId?: string };
          if (data?.clientId) onClientDisconnected(data.clientId);
          break;
        }
        case 'client_updated': {
          const data = event.payload as { client?: Client };
          if (data?.client) onClientUpdated(data.client);
          break;
        }
      }
      return;
    }

    // Legacy format fallback
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
    // Handle relay event notifications (method: 'event', params: ExtensionEvent)
    if (message.type === 'event') {
      const event = message.payload as {
        type: string;
        sessionId?: string;
        payload?: unknown;
        correlationId?: string;
      };

      switch (event.type) {
        case 'session_started': {
          const data = event.payload as { session?: Session; agent?: string; prompt?: string };
          if (callbacks.onSessionStarted) {
            const session: Session = data?.session ?? {
              sessionId: event.sessionId ?? '',
              clientId: '',
              agentName: data?.agent ?? '',
              prompt: data?.prompt ?? '',
              status: 'running',
              messages: [],
              toolCalls: [],
              startedAt: new Date().toISOString(),
            };
            callbacks.onSessionStarted(session);
          }
          break;
        }
        case 'session_progress': {
          if (event.sessionId && callbacks.onSessionMessage) {
            const data = event.payload as { content?: string; type?: string };
            const msg: SessionMessage = {
              id: crypto.randomUUID(),
              type: (data?.type as SessionMessage['type']) ?? 'assistant',
              content: data?.content ?? '',
              timestamp: new Date().toISOString(),
            };
            callbacks.onSessionMessage(event.sessionId, msg);
          }
          break;
        }
        case 'tool_called': {
          if (event.sessionId && callbacks.onSessionToolCall) {
            const data = event.payload as { toolCall?: ToolCall; name?: string; arguments?: Record<string, unknown> };
            const toolCall: ToolCall = data?.toolCall ?? {
              id: crypto.randomUUID(),
              name: data?.name ?? 'unknown',
              arguments: data?.arguments ?? {},
              status: 'running',
              startedAt: new Date().toISOString(),
            };
            callbacks.onSessionToolCall(event.sessionId, toolCall);
          }
          break;
        }
        case 'session_completed': {
          if (callbacks.onSessionCompleted) {
            const data = event.payload as { session?: Session };
            const session: Session = data?.session ?? {
              sessionId: event.sessionId ?? '',
              clientId: '',
              agentName: '',
              prompt: '',
              status: 'completed',
              messages: [],
              toolCalls: [],
              startedAt: '',
              completedAt: new Date().toISOString(),
            };
            callbacks.onSessionCompleted(session);
          }
          break;
        }
        case 'session_error': {
          if (event.sessionId && callbacks.onSessionFailed) {
            const data = event.payload as { error?: string; message?: string };
            callbacks.onSessionFailed(
              event.sessionId,
              data?.error ?? data?.message ?? 'Unknown error'
            );
          }
          break;
        }
      }
      return;
    }

    // Legacy format fallback
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
