/**
 * Client registry for tracking connected WebSocket clients.
 * Manages heartbeat, stale connection cleanup, and client metadata.
 */
import * as vscode from 'vscode';
import { WebSocket } from 'ws';
import * as http from 'http';
import * as crypto from 'crypto';

/** Device type detected from client */
export type DeviceType = 'mobile' | 'web' | 'desktop' | 'unknown';

/** Operating system detected from client */
export type OperatingSystem = 'iOS' | 'Android' | 'Windows' | 'macOS' | 'Linux' | 'unknown';

/** Client connection state */
export type ClientState = 'connected' | 'disconnected';

/** Full client information */
export interface RegisteredClientInfo {
	clientId: string;
	deviceType: DeviceType;
	os: OperatingSystem;
	appVersion: string;
	connectionTime: Date;
	lastSeen: Date;
	state: ClientState;
	websocket: WebSocket;
	userId?: string;
	userAgent?: string;
}

/** Client info for external API (without websocket) */
export interface ClientInfoDto {
	clientId: string;
	deviceType: DeviceType;
	os: OperatingSystem;
	appVersion: string;
	connectionTime: string;
	lastSeen: string;
	state: ClientState;
	userId?: string;
}

/** Heartbeat configuration */
interface HeartbeatConfig {
	intervalMs: number;
	staleTimeoutMs: number;
}

/**
 * Registry for managing WebSocket clients with heartbeat and stale connection cleanup.
 */
export class ClientRegistry implements vscode.Disposable {
	private readonly output: vscode.OutputChannel;
	private readonly clients: Map<string, RegisteredClientInfo> = new Map();
	private readonly wsToClientId: Map<WebSocket, string> = new Map();
	
	private heartbeatTimer: NodeJS.Timeout | undefined;
	private cleanupTimer: NodeJS.Timeout | undefined;
	private statusBarItem: vscode.StatusBarItem | undefined;
	private disposed = false;

	// Callbacks for external integration
	private onClientConnected?: (client: RegisteredClientInfo) => void;
	private onClientDisconnected?: (clientId: string) => void;
	private onCountChanged?: (count: number) => void;

	constructor(output: vscode.OutputChannel) {
		this.output = output;
	}

	/**
	 * Initialize the registry and start heartbeat/cleanup timers.
	 */
	initialize(extensionContext: vscode.ExtensionContext): void {
		// Create status bar item for client count
		this.statusBarItem = vscode.window.createStatusBarItem(
			vscode.StatusBarAlignment.Right,
			99 // Slightly lower priority than WS server status
		);
		this.statusBarItem.command = 'skillInstaller.showClientList';
		extensionContext.subscriptions.push(this.statusBarItem);

		this.updateStatusBar();
	}

	/**
	 * Start heartbeat and cleanup timers.
	 */
	startTimers(): void {
		const config = this.getConfig();

		// Start heartbeat timer
		this.heartbeatTimer = setInterval(() => {
			this.sendHeartbeat();
		}, config.intervalMs);

		// Start cleanup timer (runs at same interval as heartbeat)
		this.cleanupTimer = setInterval(() => {
			this.cleanupStaleConnections();
		}, config.intervalMs);

		this.output.appendLine(`[ClientRegistry] Timers started (heartbeat: ${config.intervalMs}ms, stale timeout: ${config.staleTimeoutMs}ms)`);
	}

	/**
	 * Stop heartbeat and cleanup timers.
	 */
	stopTimers(): void {
		if (this.heartbeatTimer) {
			clearInterval(this.heartbeatTimer);
			this.heartbeatTimer = undefined;
		}
		if (this.cleanupTimer) {
			clearInterval(this.cleanupTimer);
			this.cleanupTimer = undefined;
		}
		this.output.appendLine('[ClientRegistry] Timers stopped');
	}

	/**
	 * Get heartbeat configuration from settings.
	 */
	private getConfig(): HeartbeatConfig {
		const config = vscode.workspace.getConfiguration('skillInstaller.ws');
		return {
			intervalMs: config.get<number>('heartbeatInterval', 30000),
			staleTimeoutMs: config.get<number>('staleTimeout', 120000),
		};
	}

	/**
	 * Register a new client from WebSocket upgrade request.
	 */
	registerClient(ws: WebSocket, request: http.IncomingMessage, userId?: string): RegisteredClientInfo {
		const clientId = crypto.randomUUID();
		const now = new Date();

		// Extract metadata from headers
		const metadata = this.extractMetadata(request);

		const clientInfo: RegisteredClientInfo = {
			clientId,
			deviceType: metadata.deviceType,
			os: metadata.os,
			appVersion: metadata.appVersion,
			connectionTime: now,
			lastSeen: now,
			state: 'connected',
			websocket: ws,
			userId,
			userAgent: metadata.userAgent,
		};

		this.clients.set(clientId, clientInfo);
		this.wsToClientId.set(ws, clientId);

		this.output.appendLine(`[ClientRegistry] Client registered: ${clientId} (${metadata.deviceType}/${metadata.os})`);
		this.updateStatusBar();
		this.onClientConnected?.(clientInfo);
		this.onCountChanged?.(this.clients.size);

		return clientInfo;
	}

	/**
	 * Extract client metadata from HTTP upgrade request headers.
	 */
	private extractMetadata(request: http.IncomingMessage): {
		deviceType: DeviceType;
		os: OperatingSystem;
		appVersion: string;
		userAgent?: string;
	} {
		const headers = request.headers;

		// Try custom headers first (preferred)
		const customDeviceType = this.getHeader(headers, 'x-device-type');
		const customOs = this.getHeader(headers, 'x-os');
		const customAppVersion = this.getHeader(headers, 'x-app-version');
		const userAgent = this.getHeader(headers, 'user-agent');

		// Parse device type
		let deviceType: DeviceType = 'unknown';
		if (customDeviceType) {
			deviceType = this.parseDeviceType(customDeviceType);
		} else if (userAgent) {
			deviceType = this.detectDeviceTypeFromUserAgent(userAgent);
		}

		// Parse OS
		let os: OperatingSystem = 'unknown';
		if (customOs) {
			os = this.parseOs(customOs);
		} else if (userAgent) {
			os = this.detectOsFromUserAgent(userAgent);
		}

		// App version
		const appVersion = customAppVersion || 'unknown';

		return { deviceType, os, appVersion, userAgent };
	}

	/**
	 * Get a single header value (handles array headers).
	 */
	private getHeader(headers: http.IncomingHttpHeaders, name: string): string | undefined {
		const value = headers[name.toLowerCase()];
		if (Array.isArray(value)) {
			return value[0];
		}
		return value;
	}

	/**
	 * Parse device type from custom header value.
	 */
	private parseDeviceType(value: string): DeviceType {
		const lower = value.toLowerCase();
		if (lower === 'mobile' || lower === 'phone' || lower === 'tablet') {
			return 'mobile';
		}
		if (lower === 'web' || lower === 'browser') {
			return 'web';
		}
		if (lower === 'desktop') {
			return 'desktop';
		}
		return 'unknown';
	}

	/**
	 * Parse OS from custom header value.
	 */
	private parseOs(value: string): OperatingSystem {
		const lower = value.toLowerCase();
		if (lower === 'ios' || lower === 'iphone' || lower === 'ipad') {
			return 'iOS';
		}
		if (lower === 'android') {
			return 'Android';
		}
		if (lower === 'windows' || lower === 'win32' || lower === 'win64') {
			return 'Windows';
		}
		if (lower === 'macos' || lower === 'mac' || lower === 'darwin') {
			return 'macOS';
		}
		if (lower === 'linux') {
			return 'Linux';
		}
		return 'unknown';
	}

	/**
	 * Detect device type from User-Agent string.
	 */
	private detectDeviceTypeFromUserAgent(userAgent: string): DeviceType {
		const ua = userAgent.toLowerCase();

		// Mobile detection
		if (/mobile|android|iphone|ipad|ipod|blackberry|windows phone|opera mini|iemobile/i.test(ua)) {
			return 'mobile';
		}

		// Desktop browsers typically don't identify as mobile
		if (/mozilla|chrome|safari|firefox|edge|opera/i.test(ua)) {
			// Could be web or desktop client
			if (/electron/i.test(ua)) {
				return 'desktop';
			}
			return 'web';
		}

		return 'unknown';
	}

	/**
	 * Detect OS from User-Agent string.
	 */
	private detectOsFromUserAgent(userAgent: string): OperatingSystem {
		const ua = userAgent.toLowerCase();

		if (/iphone|ipad|ipod/i.test(ua)) {
			return 'iOS';
		}
		if (/android/i.test(ua)) {
			return 'Android';
		}
		if (/windows/i.test(ua)) {
			return 'Windows';
		}
		if (/mac os|macos|macintosh/i.test(ua)) {
			return 'macOS';
		}
		if (/linux/i.test(ua)) {
			return 'Linux';
		}

		return 'unknown';
	}

	/**
	 * Update last seen timestamp for a client.
	 */
	updateLastSeen(clientId: string): void {
		const client = this.clients.get(clientId);
		if (client) {
			client.lastSeen = new Date();
		}
	}

	/**
	 * Update last seen by WebSocket reference.
	 */
	updateLastSeenByWs(ws: WebSocket): void {
		const clientId = this.wsToClientId.get(ws);
		if (clientId) {
			this.updateLastSeen(clientId);
		}
	}

	/**
	 * Handle pong response from client.
	 */
	handlePong(ws: WebSocket): void {
		this.updateLastSeenByWs(ws);
	}

	/**
	 * Get a client by ID.
	 */
	getClient(clientId: string): RegisteredClientInfo | undefined {
		return this.clients.get(clientId);
	}

	/**
	 * Get client ID by WebSocket reference.
	 */
	getClientIdByWs(ws: WebSocket): string | undefined {
		return this.wsToClientId.get(ws);
	}

	/**
	 * Get client by WebSocket reference.
	 */
	getClientByWs(ws: WebSocket): RegisteredClientInfo | undefined {
		const clientId = this.wsToClientId.get(ws);
		return clientId ? this.clients.get(clientId) : undefined;
	}

	/**
	 * List all registered clients.
	 */
	listClients(): RegisteredClientInfo[] {
		return Array.from(this.clients.values());
	}

	/**
	 * List all clients as DTOs (without websocket).
	 */
	listClientsDto(): ClientInfoDto[] {
		return this.listClients().map(c => this.toDto(c));
	}

	/**
	 * Convert client info to DTO.
	 */
	toDto(client: RegisteredClientInfo): ClientInfoDto {
		return {
			clientId: client.clientId,
			deviceType: client.deviceType,
			os: client.os,
			appVersion: client.appVersion,
			connectionTime: client.connectionTime.toISOString(),
			lastSeen: client.lastSeen.toISOString(),
			state: client.state,
			userId: client.userId,
		};
	}

	/**
	 * Forcefully disconnect a client.
	 */
	disconnectClient(clientId: string): boolean {
		const client = this.clients.get(clientId);
		if (!client) {
			return false;
		}

		this.output.appendLine(`[ClientRegistry] Force disconnecting client: ${clientId}`);
		
		// Close the WebSocket
		try {
			client.websocket.close(1000, 'Disconnected by server');
		} catch {
			// Ignore errors during close
		}

		this.removeClient(clientId);
		return true;
	}

	/**
	 * Remove a client from the registry (called on disconnect).
	 */
	removeClient(clientId: string): void {
		const client = this.clients.get(clientId);
		if (client) {
			this.wsToClientId.delete(client.websocket);
			this.clients.delete(clientId);

			this.output.appendLine(`[ClientRegistry] Client removed: ${clientId}`);
			this.updateStatusBar();
			this.onClientDisconnected?.(clientId);
			this.onCountChanged?.(this.clients.size);
		}
	}

	/**
	 * Remove client by WebSocket reference.
	 */
	removeClientByWs(ws: WebSocket): void {
		const clientId = this.wsToClientId.get(ws);
		if (clientId) {
			this.removeClient(clientId);
		}
	}

	/**
	 * Get count of active (connected) clients.
	 */
	getActiveCount(): number {
		return Array.from(this.clients.values()).filter(c => c.state === 'connected').length;
	}

	/**
	 * Get total count of all clients.
	 */
	getTotalCount(): number {
		return this.clients.size;
	}

	/**
	 * Send heartbeat ping to all connected clients.
	 */
	private sendHeartbeat(): void {
		const timestamp = Date.now();
		const pingMessage = JSON.stringify({
			jsonrpc: '2.0',
			method: 'ping',
			params: { timestamp },
		});

		let sentCount = 0;
		for (const client of this.clients.values()) {
			if (client.state === 'connected' && client.websocket.readyState === WebSocket.OPEN) {
				try {
					client.websocket.send(pingMessage);
					sentCount++;
				} catch (err) {
					this.output.appendLine(`[ClientRegistry] Failed to send ping to ${client.clientId}: ${err}`);
				}
			}
		}

		if (sentCount > 0) {
			this.output.appendLine(`[ClientRegistry] Sent heartbeat ping to ${sentCount} client(s)`);
		}
	}

	/**
	 * Clean up stale connections that haven't responded to heartbeat.
	 */
	private cleanupStaleConnections(): void {
		const config = this.getConfig();
		const now = Date.now();
		const staleClients: string[] = [];

		for (const client of this.clients.values()) {
			const lastSeenMs = client.lastSeen.getTime();
			const staleDuration = now - lastSeenMs;

			if (staleDuration > config.staleTimeoutMs) {
				staleClients.push(client.clientId);
				this.output.appendLine(
					`[ClientRegistry] Stale client detected: ${client.clientId} (last seen ${Math.round(staleDuration / 1000)}s ago)`
				);
			}
		}

		// Disconnect stale clients
		for (const clientId of staleClients) {
			this.output.appendLine(`[ClientRegistry] Disconnecting stale client: ${clientId}`);
			this.disconnectClient(clientId);
		}

		if (staleClients.length > 0) {
			this.output.appendLine(`[ClientRegistry] Cleaned up ${staleClients.length} stale connection(s)`);
		}
	}

	/**
	 * Update the status bar item with current client count.
	 */
	private updateStatusBar(): void {
		if (!this.statusBarItem) {
			return;
		}

		const count = this.getActiveCount();
		if (count === 0) {
			this.statusBarItem.hide();
		} else {
			this.statusBarItem.text = `$(device-mobile) ${count} client${count !== 1 ? 's' : ''}`;
			this.statusBarItem.tooltip = `${count} mobile companion client${count !== 1 ? 's' : ''} connected`;
			this.statusBarItem.show();
		}
	}

	/**
	 * Set callback for when a client connects.
	 */
	setOnClientConnected(callback: (client: RegisteredClientInfo) => void): void {
		this.onClientConnected = callback;
	}

	/**
	 * Set callback for when a client disconnects.
	 */
	setOnClientDisconnected(callback: (clientId: string) => void): void {
		this.onClientDisconnected = callback;
	}

	/**
	 * Set callback for when client count changes.
	 */
	setOnCountChanged(callback: (count: number) => void): void {
		this.onCountChanged = callback;
	}

	/**
	 * Clear all clients (used during shutdown).
	 */
	clear(): void {
		for (const client of this.clients.values()) {
			try {
				client.websocket.close(1000, 'Server shutting down');
			} catch {
				// Ignore
			}
		}
		this.clients.clear();
		this.wsToClientId.clear();
		this.updateStatusBar();
	}

	/**
	 * Dispose of all resources.
	 */
	dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;

		this.stopTimers();
		this.clear();
		this.statusBarItem?.dispose();
		this.output.appendLine('[ClientRegistry] Disposed');
	}
}
