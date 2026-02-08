export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'reconnecting';

export interface RelayMessage {
  type: string;
  payload?: unknown;
  timestamp?: string;
  id?: string;
}

type MessageHandler = (message: RelayMessage) => void;
type StatusHandler = (status: ConnectionStatus) => void;

/**
 * WebSocket connection manager for relay communication.
 * Handles connection, reconnection with exponential backoff, and message routing.
 */
export class RelayConnection {
  private ws: WebSocket | null = null;
  private status: ConnectionStatus = 'disconnected';
  private messageHandlers: Set<MessageHandler> = new Set();
  private statusHandlers: Set<StatusHandler> = new Set();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private baseReconnectDelay = 1000; // 1 second
  private maxReconnectDelay = 30000; // 30 seconds
  private reconnectTimer: number | null = null;
  private authToken: string | null = null;
  private relayUrl: string;
  private clientId: string | null = null;
  private userId: string | null = null;
  private authenticated = false;
  private pendingMessages: RelayMessage[] = [];

  constructor(relayUrl: string = resolveRelayWsUrl()) {
    this.relayUrl = relayUrl;
  }

  /**
   * Connect to the relay server with authentication token
   */
  connect(authToken: string): void {
    this.authToken = authToken;
    this.doConnect();
  }

  /**
   * Disconnect from the relay server
   */
  disconnect(): void {
    this.clearReconnectTimer();
    if (this.ws) {
      this.ws.close(1000, 'User disconnect');
      this.ws = null;
    }
    this.setStatus('disconnected');
    this.reconnectAttempts = 0;
    this.clientId = null;
    this.userId = null;
    this.authenticated = false;
    this.pendingMessages = [];
  }

  /**
   * Send a message to the relay server, wrapped in a RelayEnvelope.
   * Messages are queued if authentication has not yet completed.
   */
  send(message: RelayMessage): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('Cannot send message: WebSocket not connected');
      return false;
    }

    // Queue if not yet authenticated
    if (!this.authenticated || !this.clientId) {
      this.pendingMessages.push(message);
      return true; // Queued, not failed
    }

    return this.sendEnvelope(message);
  }

  /**
   * Wrap a RelayMessage in a RelayEnvelope and send it over the WebSocket.
   */
  private sendEnvelope(message: RelayMessage): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.clientId) {
      return false;
    }

    const envelope = {
      version: '1.0' as const,
      messageId: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      source: {
        type: 'mobile' as const,
        clientId: this.clientId,
        userId: this.userId ?? undefined,
      },
      target: {
        type: 'extension' as const,
        userId: this.userId ?? undefined,
      },
      payload: message.payload ?? message,
    };

    try {
      this.ws.send(JSON.stringify(envelope));
      return true;
    } catch (error) {
      console.error('Failed to send envelope:', error);
      return false;
    }
  }

  /**
   * Subscribe to incoming messages
   */
  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  /**
   * Subscribe to connection status changes
   */
  onStatusChange(handler: StatusHandler): () => void {
    this.statusHandlers.add(handler);
    // Immediately notify of current status
    handler(this.status);
    return () => this.statusHandlers.delete(handler);
  }

  /**
   * Get current connection status
   */
  getStatus(): ConnectionStatus {
    return this.status;
  }

  /**
   * Get the client ID assigned by the relay after authentication.
   */
  getClientId(): string | null {
    return this.clientId;
  }

  /**
   * Get the user ID from the relay authentication response.
   */
  getUserId(): string | null {
    return this.userId;
  }

  /**
   * Whether the relay connection is authenticated.
   */
  isAuthenticated(): boolean {
    return this.authenticated;
  }

  private doConnect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return;
    }

    this.setStatus('connecting');

    try {
      // Include auth token in connection URL or as first message
      const url = new URL(this.relayUrl);
      if (this.authToken) {
        url.searchParams.set('token', this.authToken);
      }

      this.ws = new WebSocket(url.toString());

      this.ws.onopen = () => {
        console.log('WebSocket opened, awaiting auth acknowledgment');
        // Don't set 'connected' yet — wait for auth ack from relay
        this.reconnectAttempts = 0;
      };

      this.ws.onmessage = (event) => {
        try {
          const raw = JSON.parse(event.data as string);

          // Handle auth response (direct JSON-RPC, not an envelope)
          if (raw.jsonrpc === '2.0' && raw.id === 'auth') {
            this.handleAuthResponse(raw);
            return;
          }

          // Handle relay envelope (version 1.0)
          if (raw.version === '1.0' && raw.payload !== undefined) {
            const p = raw.payload;

            if (p.jsonrpc === '2.0') {
              if ('error' in p && p.error) {
                // JSON-RPC error response
                const message: RelayMessage = {
                  type: 'error',
                  payload: p.error,
                  id: p.id,
                  timestamp: raw.timestamp,
                };
                this.messageHandlers.forEach((handler) => handler(message));
              } else if ('result' in p) {
                // JSON-RPC success response
                const message: RelayMessage = {
                  type: 'response',
                  payload: p.result,
                  id: p.id,
                  timestamp: raw.timestamp,
                };
                this.messageHandlers.forEach((handler) => handler(message));
              } else if ('method' in p) {
                // JSON-RPC notification (event forwarded from extension)
                const message: RelayMessage = {
                  type: p.method,
                  payload: p.params,
                  id: p.id,
                  timestamp: raw.timestamp,
                };
                this.messageHandlers.forEach((handler) => handler(message));
              }
              return;
            }

            // Non-JSON-RPC envelope payload — pass through
            const message: RelayMessage = {
              type: 'unknown',
              payload: p,
              timestamp: raw.timestamp,
            };
            this.messageHandlers.forEach((handler) => handler(message));
            return;
          }

          // Handle direct JSON-RPC (e.g., control messages, ping/pong)
          if (raw.jsonrpc === '2.0') {
            const message: RelayMessage = {
              type: raw.method ?? 'response',
              payload: raw.result ?? raw.params ?? raw,
              id: raw.id,
            };
            this.messageHandlers.forEach((handler) => handler(message));
            return;
          }

          // Fallback: pass through as-is
          this.messageHandlers.forEach((handler) => handler(raw as RelayMessage));
        } catch (error) {
          console.error('Failed to parse relay message:', error);
        }
      };

      this.ws.onclose = (event) => {
        console.log('WebSocket closed:', event.code, event.reason);
        this.ws = null;
        
        if (event.code !== 1000) {
          // Abnormal close, attempt reconnection
          this.scheduleReconnect();
        } else {
          this.setStatus('disconnected');
        }
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
      };
    } catch (error) {
      console.error('Failed to create WebSocket:', error);
      this.scheduleReconnect();
    }
  }

  private handleAuthResponse(response: {
    result?: { authenticated?: boolean; clientId?: string; userId?: string; scopes?: string[] };
    error?: { code: number; message: string };
  }): void {
    if (response.error) {
      console.error('Relay auth failed:', response.error.message);
      this.setStatus('disconnected');
      return;
    }

    if (response.result?.authenticated) {
      this.clientId = response.result.clientId ?? null;
      this.userId = response.result.userId ?? null;
      this.authenticated = true;
      console.log(`Relay authenticated: clientId=${this.clientId}, userId=${this.userId}`);

      this.setStatus('connected');
      this.flushPendingMessages();

      // Auto-join user group for targeted routing
      if (this.userId) {
        this.joinUserGroup();
      }
    }
  }

  private flushPendingMessages(): void {
    const pending = [...this.pendingMessages];
    this.pendingMessages = [];
    for (const message of pending) {
      this.sendEnvelope(message);
    }
  }

  private joinUserGroup(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    // Join group is a direct JSON-RPC control message (not enveloped)
    this.ws.send(JSON.stringify({
      jsonrpc: '2.0',
      id: `join-${Date.now()}`,
      method: 'join_group',
      params: { groupType: 'user', groupId: this.userId },
    }));
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnection attempts reached');
      this.setStatus('disconnected');
      return;
    }

    this.setStatus('reconnecting');
    
    // Exponential backoff with jitter
    const delay = Math.min(
      this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts) + Math.random() * 1000,
      this.maxReconnectDelay
    );
    
    console.log(`Reconnecting in ${Math.round(delay)}ms (attempt ${this.reconnectAttempts + 1})`);
    
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectAttempts++;
      this.doConnect();
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status !== status) {
      this.status = status;
      this.statusHandlers.forEach((handler) => handler(status));
    }
  }
}

export function resolveRelayWsUrl(input?: string): string {
  const rawUrl =
    input ||
    import.meta.env.VITE_RELAY_WS_URL ||
    import.meta.env.VITE_RELAY_URL ||
    'wss://relay.example.com';

  try {
    const url = new URL(rawUrl);
    if (url.protocol === 'http:') {
      url.protocol = 'ws:';
    } else if (url.protocol === 'https:') {
      url.protocol = 'wss:';
    }
    url.hash = '';
    url.search = '';
    // Ensure /v1/ws path for relay WebSocket endpoint
    if (!url.pathname.endsWith('/v1/ws')) {
      url.pathname = url.pathname.replace(/\/$/, '') + '/v1/ws';
    }
    return url.toString().replace(/\/$/, '');
  } catch {
    return rawUrl.replace(/\/$/, '');
  }
}

// Singleton instance
let relayInstance: RelayConnection | null = null;

export function getRelayConnection(): RelayConnection {
  if (!relayInstance) {
    relayInstance = new RelayConnection();
  }
  return relayInstance;
}

export function resetRelayConnection(): void {
  if (relayInstance) {
    relayInstance.disconnect();
    relayInstance = null;
  }
}
