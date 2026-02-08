import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { WebSocket, RawData } from 'ws';
import { RelayAuthBridge } from './relayAuthBridge';
import type { WsRequest, WsResponse } from './wsTypes';
import { createErrorResponse, WsErrorCodes } from './wsTypes';

// ---------------------------------------------------------------------------
// Local types (do NOT import from cloud-relay)
// ---------------------------------------------------------------------------

type ClientType = 'mobile' | 'extension' | 'relay';
type TargetType = ClientType | 'broadcast';

interface RelayEnvelope {
  version: '1.0';
  messageId: string;
  timestamp: string;
  source: { type: ClientType; clientId: string; userId?: string };
  target: { type: TargetType; clientId?: string; userId?: string };
  payload: unknown; // WsRequest | WsResponse | WsNotification
  meta?: { priority?: string; ttl?: number; traceId?: string };
}

export type ConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'authenticating'
  | 'connected'
  | 'reconnecting';

export type RequestHandler = (request: WsRequest) => Promise<WsResponse>;

// ---------------------------------------------------------------------------
// RelayClient
// ---------------------------------------------------------------------------

/**
 * Outbound WebSocket client connecting the VS Code extension to the cloud relay.
 *
 * Lifecycle:
 *   connect() → WS open → auth via ?token= → auth_success → connected
 *   If the connection drops, scheduleReconnect() retries with exponential backoff.
 *   disconnect() tears down everything and prevents further reconnects.
 */
export class RelayClient implements vscode.Disposable {
  private readonly authBridge: RelayAuthBridge;
  private readonly output: vscode.OutputChannel;

  private ws: WebSocket | null = null;
  private status: ConnectionStatus = 'disconnected';
  private clientId: string | null = null;
  private userId: string | null = null;

  private requestHandler: RequestHandler | null = null;

  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 10;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  private readonly _onStatusChanged = new vscode.EventEmitter<ConnectionStatus>();
  public readonly onStatusChanged: vscode.Event<ConnectionStatus> = this._onStatusChanged.event;

  constructor(authBridge: RelayAuthBridge, output: vscode.OutputChannel) {
    this.authBridge = authBridge;
    this.output = output;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Connect (or reconnect) to the relay WebSocket.
   * Idempotent — disconnects first if already connected.
   */
  async connect(): Promise<void> {
    // Idempotent: tear down any existing connection first
    if (this.ws) {
      await this.disconnect();
    }

    // Re-enable reconnection (disconnect sets disposed = true)
    this.disposed = false;
    this.reconnectAttempts = 0;

    const token = await this.authBridge.getAccessToken();
    if (!token) {
      this.output.appendLine('[RelayClient] No access token available — cannot connect');
      return;
    }

    this.setStatus('connecting');

    const relayUrl = this.getRelayWsUrl();
    const url = `${relayUrl}?token=${encodeURIComponent(token)}`;
    this.output.appendLine(`[RelayClient] Connecting to ${relayUrl}`);

    try {
      const ws = new WebSocket(url);
      this.ws = ws;

      ws.on('open', () => {
        this.output.appendLine('[RelayClient] WebSocket opened, awaiting auth ack');
        this.setStatus('authenticating');
      });

      ws.on('message', (data: RawData) => {
        this.handleMessage(data);
      });

      ws.on('close', (code: number, reason: Buffer) => {
        const msg = reason.toString() || 'no reason';
        this.output.appendLine(`[RelayClient] WebSocket closed: ${code} — ${msg}`);
        this.ws = null;

        if (!this.disposed) {
          this.setStatus('reconnecting');
          this.scheduleReconnect();
        } else {
          this.setStatus('disconnected');
        }
      });

      ws.on('error', (err: Error) => {
        this.output.appendLine(`[RelayClient] WebSocket error: ${err.message}`);
        // The 'close' event fires after 'error', so reconnection is handled there
      });
    } catch (err) {
      this.output.appendLine(`[RelayClient] Failed to create WebSocket: ${err}`);
      this.setStatus('disconnected');
    }
  }

  /**
   * Disconnect and prevent further automatic reconnections.
   */
  async disconnect(): Promise<void> {
    this.disposed = true;
    this.cancelReconnectTimer();

    if (this.ws) {
      try {
        this.ws.removeAllListeners();
        if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
          this.ws.close(1000, 'client disconnect');
        }
      } catch {
        // Swallow close errors
      }
      this.ws = null;
    }

    this.clientId = null;
    this.userId = null;
    this.reconnectAttempts = 0;
    this.setStatus('disconnected');
  }

  /**
   * Register the handler that processes incoming requests routed through the relay.
   */
  setRequestHandler(handler: RequestHandler): void {
    this.requestHandler = handler;
  }

  /**
   * Send a WsResponse wrapped in a RelayEnvelope back to the original sender.
   */
  sendResponse(incomingEnvelope: RelayEnvelope, response: WsResponse): void {
    const outgoing = this.wrapResponse(incomingEnvelope, response);
    this.send(outgoing);
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  getClientId(): string | null {
    return this.clientId;
  }

  getUserId(): string | null {
    return this.userId;
  }

  getReconnectInfo(): { attempts: number; maxAttempts: number } | null {
    if (this.status !== 'reconnecting') {
      return null;
    }
    return { attempts: this.reconnectAttempts, maxAttempts: this.maxReconnectAttempts };
  }

  /**
   * Send an event notification through the relay to all subscribed clients.
   * Wraps the event in a RelayEnvelope targeting 'broadcast'.
   */
  sendEvent(event: unknown): void {
    if (this.status !== 'connected' || !this.clientId) {
      return;
    }

    const envelope: RelayEnvelope = {
      version: '1.0',
      messageId: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      source: {
        type: 'extension',
        clientId: this.clientId,
        userId: this.userId ?? undefined,
      },
      target: {
        type: 'broadcast',
      },
      payload: {
        jsonrpc: '2.0',
        method: 'event',
        params: event,
      },
    };

    this.send(envelope);
  }

  dispose(): void {
    // Fire-and-forget — disconnect is sync-safe internally
    void this.disconnect();
    this._onStatusChanged.dispose();
  }

  // ---------------------------------------------------------------------------
  // Private — message handling
  // ---------------------------------------------------------------------------

  private handleMessage(data: RawData): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data.toString());
    } catch {
      this.output.appendLine('[RelayClient] Received unparseable message');
      return;
    }

    const msg = parsed as Record<string, unknown>;

    // 1. Auth response (JSON-RPC response to implicit auth request)
    if (msg.jsonrpc === '2.0' && msg.id === 'auth' && msg.result) {
      const result = msg.result as Record<string, unknown>;
      if (result.authenticated) {
        this.handleAuthSuccess(result);
        return;
      }
    }

    // 2. Auth error
    if (msg.jsonrpc === '2.0' && msg.id === 'auth' && msg.error) {
      this.output.appendLine(`[RelayClient] Auth rejected: ${JSON.stringify(msg.error)}`);
      // Try token refresh on next reconnect attempt
      return;
    }

    // 3. RelayEnvelope — the main message type once authenticated
    if (msg.version === '1.0' && msg.payload !== undefined) {
      void this.handleEnvelope(msg as unknown as RelayEnvelope);
      return;
    }

    // 4. JSON-RPC notification or response (non-envelope)
    if (msg.jsonrpc === '2.0' && !msg.id && msg.method) {
      this.output.appendLine(`[RelayClient] Notification: ${msg.method}`);
      return;
    }

    // 5. Unknown message shape — log and ignore
    this.output.appendLine(`[RelayClient] Unhandled message: ${JSON.stringify(msg).slice(0, 200)}`);
  }

  private handleAuthSuccess(result: Record<string, unknown>): void {
    this.clientId = (result.clientId as string) ?? null;
    this.userId = (result.userId as string) ?? null;
    this.reconnectAttempts = 0;
    this.setStatus('connected');
    this.output.appendLine(
      `[RelayClient] Authenticated — clientId=${this.clientId}, userId=${this.userId}`,
    );

    // Auto-join user group so mobile can reach this extension by userId
    if (this.userId) {
      this.joinUserGroup();
    }
  }

  private async handleEnvelope(envelope: RelayEnvelope): Promise<void> {
    const payload = envelope.payload as Record<string, unknown>;

    // Only handle incoming requests (has method + id)
    if (payload.jsonrpc !== '2.0' || typeof payload.method !== 'string' || typeof payload.id !== 'string') {
      this.output.appendLine(`[RelayClient] Envelope contains non-request payload, ignoring`);
      return;
    }

    const request = payload as unknown as WsRequest;

    if (!this.requestHandler) {
      this.output.appendLine(`[RelayClient] No request handler registered, sending error for ${request.method}`);
      const errResponse = createErrorResponse(
        request.id,
        WsErrorCodes.INTERNAL_ERROR,
        'No handler registered',
      );
      this.sendResponse(envelope, errResponse);
      return;
    }

    try {
      const response = await this.requestHandler(request);
      this.sendResponse(envelope, response);
    } catch (err) {
      this.output.appendLine(`[RelayClient] Handler error for ${request.method}: ${err}`);
      const errResponse = createErrorResponse(
        request.id,
        WsErrorCodes.INTERNAL_ERROR,
        `Handler error: ${err instanceof Error ? err.message : String(err)}`,
      );
      this.sendResponse(envelope, errResponse);
    }
  }

  // ---------------------------------------------------------------------------
  // Private — envelope wrapping
  // ---------------------------------------------------------------------------

  private wrapResponse(incomingEnvelope: RelayEnvelope, response: WsResponse): RelayEnvelope {
    return {
      version: '1.0',
      messageId: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      source: {
        type: 'extension',
        clientId: this.clientId!,
        userId: this.userId ?? undefined,
      },
      target: {
        type: incomingEnvelope.source.type,
        clientId: incomingEnvelope.source.clientId,
        userId: incomingEnvelope.source.userId,
      },
      payload: response,
    };
  }

  // ---------------------------------------------------------------------------
  // Private — reconnection
  // ---------------------------------------------------------------------------

  private scheduleReconnect(): void {
    if (this.disposed) { return; }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.output.appendLine(
        `[RelayClient] Max reconnect attempts (${this.maxReconnectAttempts}) reached — giving up`,
      );
      this.setStatus('disconnected');
      return;
    }

    // Exponential backoff: base 1s, doubles each attempt, capped at 30s, + random jitter 0-1s
    const base = 1000;
    const delay = Math.min(base * Math.pow(2, this.reconnectAttempts), 30_000);
    const jitter = Math.random() * 1000;
    const total = delay + jitter;

    this.reconnectAttempts++;
    this.output.appendLine(
      `[RelayClient] Reconnect attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${Math.round(total)}ms`,
    );

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.reconnect();
    }, total);
  }

  private async reconnect(): Promise<void> {
    if (this.disposed) { return; }

    // Get a fresh token (may trigger refresh/exchange)
    const token = await this.authBridge.getAccessToken();
    if (!token) {
      this.output.appendLine('[RelayClient] Cannot reconnect — no token available');
      this.scheduleReconnect();
      return;
    }

    this.setStatus('connecting');

    const relayUrl = this.getRelayWsUrl();
    const url = `${relayUrl}?token=${encodeURIComponent(token)}`;
    this.output.appendLine(`[RelayClient] Reconnecting to ${relayUrl}`);

    try {
      const ws = new WebSocket(url);
      this.ws = ws;

      ws.on('open', () => {
        this.output.appendLine('[RelayClient] Reconnected — awaiting auth ack');
        this.setStatus('authenticating');
      });

      ws.on('message', (data: RawData) => {
        this.handleMessage(data);
      });

      ws.on('close', (code: number, reason: Buffer) => {
        const msg = reason.toString() || 'no reason';
        this.output.appendLine(`[RelayClient] WebSocket closed (reconnect): ${code} — ${msg}`);
        this.ws = null;

        if (!this.disposed) {
          this.setStatus('reconnecting');
          this.scheduleReconnect();
        } else {
          this.setStatus('disconnected');
        }
      });

      ws.on('error', (err: Error) => {
        this.output.appendLine(`[RelayClient] WebSocket error (reconnect): ${err.message}`);
      });
    } catch (err) {
      this.output.appendLine(`[RelayClient] Reconnect failed: ${err}`);
      if (!this.disposed) {
        this.scheduleReconnect();
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Private — user group
  // ---------------------------------------------------------------------------

  private joinUserGroup(): void {
    this.send({
      jsonrpc: '2.0',
      id: `join-${Date.now()}`,
      method: 'join_group',
      params: { groupType: 'user', groupId: this.userId },
    });
  }

  // ---------------------------------------------------------------------------
  // Private — transport
  // ---------------------------------------------------------------------------

  private send(data: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.output.appendLine('[RelayClient] Cannot send — WebSocket not open');
      return;
    }

    try {
      this.ws.send(JSON.stringify(data));
    } catch (err) {
      this.output.appendLine(`[RelayClient] Send error: ${err}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Private — helpers
  // ---------------------------------------------------------------------------

  private setStatus(newStatus: ConnectionStatus): void {
    if (this.status === newStatus) { return; }
    this.status = newStatus;
    this._onStatusChanged.fire(newStatus);
  }

  private cancelReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private getRelayWsUrl(): string {
    return vscode.workspace
      .getConfiguration('skillInstaller.relay')
      .get<string>('url', 'wss://relay.sfrsh.xyz/v1/ws');
  }
}
