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

  constructor(relayUrl: string = import.meta.env.VITE_RELAY_URL || 'wss://relay.example.com') {
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
  }

  /**
   * Send a message to the relay server
   */
  send(message: RelayMessage): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('Cannot send message: WebSocket not connected');
      return false;
    }

    try {
      this.ws.send(JSON.stringify({
        ...message,
        timestamp: new Date().toISOString(),
        id: message.id || crypto.randomUUID(),
      }));
      return true;
    } catch (error) {
      console.error('Failed to send message:', error);
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
        console.log('WebSocket connected to relay');
        this.setStatus('connected');
        this.reconnectAttempts = 0;
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as RelayMessage;
          this.messageHandlers.forEach((handler) => handler(message));
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
