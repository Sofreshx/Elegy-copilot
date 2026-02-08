/**
 * WebSocket server for mobile companion communication.
 * Provides bidirectional JSON-RPC messaging with JWT authentication.
 */
import * as vscode from 'vscode';
import * as http from 'http';
import { WebSocketServer, WebSocket, RawData } from 'ws';
import { WsAuthManager } from './wsAuth';
import {
	WsRequest,
	WsResponse,
	WsNotification,
	ClientInfo,
	ExtensionStatus,
	ExecuteCommandParams,
	SubscribeEventsParams,
	UnsubscribeEventsParams,
	InvokeAgentParams,
	CancelSessionParams,
	GetEventHistoryParams,
	ResolvePermissionParams,
	GetClientParams,
	DisconnectClientParams,
	WsErrorCodes,
	isValidRequest,
	createSuccessResponse,
	createErrorResponse,
	createNotification,
} from './wsTypes';
import { SessionManager } from './sessionManager';
import { ExtensionEventEmitter, ExtensionEvent, EventType } from './eventEmitter';
import { ClientRegistry, RegisteredClientInfo } from './clientRegistry';
import type { RemoteControlParticipant } from './chatParticipant';

/** Server configuration */
interface WsServerConfig {
	enabled: boolean;
	port: number;
}

/** Extension package info */
interface PackageInfo {
	version: string;
}

/**
 * WebSocket server for remote mobile companion control.
 */
export class WsServer implements vscode.Disposable {
	private readonly output: vscode.OutputChannel;
	private readonly authManager: WsAuthManager;
	private readonly extensionContext: vscode.ExtensionContext;
	private readonly eventEmitter: ExtensionEventEmitter;
	private readonly clientRegistry: ClientRegistry;
	
	private httpServer: http.Server | undefined;
	private wss: WebSocketServer | undefined;
	private clientsById: Map<string, WebSocket> = new Map(); // Reverse lookup for broadcasting
	private statusBarItem: vscode.StatusBarItem | undefined;
	private startTime: number = 0;
	private disposed = false;

	// Session management and chat participant
	private sessionManager: SessionManager | undefined;
	private chatParticipant: RemoteControlParticipant | undefined;

	// Allowlisted commands for security
	private readonly allowedCommands = new Set([
		// VS Code built-in commands
		'workbench.action.files.save',
		'workbench.action.files.saveAll',
		'workbench.action.openSettings',
		// Skill installer commands
		'skillInstaller.refresh',
		'skillInstaller.refreshAudit',
		// Copilot chat commands
		'workbench.panel.chat.view.copilot.focus',
		// Add more as needed
	]);

	constructor(
		extensionContext: vscode.ExtensionContext,
		output: vscode.OutputChannel,
		authManager: WsAuthManager
	) {
		this.extensionContext = extensionContext;
		this.output = output;
		this.authManager = authManager;
		this.eventEmitter = new ExtensionEventEmitter(output);
		this.clientRegistry = new ClientRegistry(output);

		// Initialize client registry with extension context
		this.clientRegistry.initialize(extensionContext);

		// Set up broadcast callback for event emitter
		this.eventEmitter.setBroadcastCallback((clientId, event) => {
			const ws = this.clientsById.get(clientId);
			if (ws && ws.readyState === WebSocket.OPEN) {
				const notification = createNotification('event', event as unknown as Record<string, unknown>);
				ws.send(JSON.stringify(notification));
			}
		});

		// Set up client registry callbacks
		this.clientRegistry.setOnClientDisconnected((clientId) => {
			this.eventEmitter.removeClient(clientId);
		});
	}

	/**
	 * Get the event emitter for external use (e.g., session manager).
	 */
	getEventEmitter(): ExtensionEventEmitter {
		return this.eventEmitter;
	}

	/**
	 * Set the session manager for session tracking.
	 */
	setSessionManager(sessionManager: SessionManager): void {
		this.sessionManager = sessionManager;
		this.sessionManager.setEventEmitter(this.eventEmitter);
	}

	/**
	 * Set the chat participant for agent invocation.
	 */
	setChatParticipant(chatParticipant: RemoteControlParticipant): void {
		this.chatParticipant = chatParticipant;
	}

	/**
	 * Start the WebSocket server if enabled in settings.
	 */
	async start(): Promise<void> {
		if (this.disposed) {
			return;
		}

		const config = this.getConfig();
		if (!config.enabled) {
			this.output.appendLine('[WS Server] Disabled in settings');
			return;
		}

		await this.authManager.initialize();

		return new Promise((resolve, reject) => {
			try {
				this.httpServer = http.createServer();
				this.wss = new WebSocketServer({ noServer: true });

				// Handle upgrade with authentication
				this.httpServer.on('upgrade', (request, socket, head) => {
					this.handleUpgrade(request, socket, head);
				});

				// Start listening
				this.httpServer.listen(config.port, '127.0.0.1', () => {
					const addr = this.httpServer?.address();
					const port = typeof addr === 'object' && addr ? addr.port : config.port;
					this.startTime = Date.now();
					this.output.appendLine(`[WS Server] Listening on ws://127.0.0.1:${port}`);
					this.updateStatusBar(port);

					// Start heartbeat and cleanup timers
					this.clientRegistry.startTimers();

					resolve();
				});

				this.httpServer.on('error', (err) => {
					this.output.appendLine(`[WS Server] HTTP server error: ${err.message}`);
					reject(err);
				});

				// Handle WebSocket connections - register with clientRegistry
				this.wss.on('connection', (ws, request) => {
					const authUserId = (request as http.IncomingMessage & { authUserId?: string }).authUserId;
					const registeredClient = this.clientRegistry.registerClient(ws, request, authUserId);
					this.handleConnection(ws, registeredClient);
				});

			} catch (err) {
				const message = err instanceof Error ? err.message : 'Unknown error';
				this.output.appendLine(`[WS Server] Failed to start: ${message}`);
				reject(err);
			}
		});
	}

	/**
	 * Get current server configuration from settings.
	 */
	private getConfig(): WsServerConfig {
		const config = vscode.workspace.getConfiguration('skillInstaller.ws');
		return {
			enabled: config.get<boolean>('enabled', false),
			port: config.get<number>('port', 0),
		};
	}

	/**
	 * Handle WebSocket upgrade request with authentication.
	 */
	private handleUpgrade(
		request: http.IncomingMessage,
		socket: import('stream').Duplex,
		head: Buffer
	): void {
		// Extract and verify token
		const headers = request.headers as Record<string, string | string[] | undefined>;
		const token = this.authManager.extractToken(request.url, headers);

		if (!token) {
			this.output.appendLine('[WS Server] Connection rejected: No token provided');
			socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
			socket.destroy();
			return;
		}

		const authResult = this.authManager.verifyToken(token);
		if (!authResult.valid) {
			this.output.appendLine(`[WS Server] Connection rejected: ${authResult.error}`);
			socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
			socket.destroy();
			return;
		}

		// Store auth result and request for connection handler
		(request as http.IncomingMessage & { authUserId?: string }).authUserId = authResult.userId;

		// Complete the upgrade
		this.wss?.handleUpgrade(request, socket, head, (ws) => {
			this.wss?.emit('connection', ws, request);
		});
	}

	/**
	 * Handle new WebSocket connection.
	 */
	private handleConnection(ws: WebSocket, registeredClient: RegisteredClientInfo): void {
		// Create client info for subscription tracking
		const clientInfo: ClientInfo = {
			id: registeredClient.clientId,
			connectedAt: registeredClient.connectionTime,
			subscribedEvents: new Set(),
			userId: registeredClient.userId,
		};

		this.clientsById.set(registeredClient.clientId, ws);
		this.output.appendLine(`[WS Server] Client connected: ${registeredClient.clientId} (user: ${registeredClient.userId})`);
		this.updateStatusBar();

		ws.on('message', (data) => {
			this.handleMessage(ws, clientInfo, data);
		});

		ws.on('close', () => {
			this.clientsById.delete(registeredClient.clientId);
			this.clientRegistry.removeClient(registeredClient.clientId);
			this.eventEmitter.removeClient(registeredClient.clientId);
			this.output.appendLine(`[WS Server] Client disconnected: ${registeredClient.clientId}`);
			this.updateStatusBar();
		});

		ws.on('error', (err) => {
			this.output.appendLine(`[WS Server] Client error (${registeredClient.clientId}): ${err.message}`);
			this.clientsById.delete(registeredClient.clientId);
			this.clientRegistry.removeClient(registeredClient.clientId);
			this.eventEmitter.removeClient(registeredClient.clientId);
			this.updateStatusBar();
		});

		// Send welcome message with client metadata
		const welcome = createNotification('welcome', {
			serverId: this.extensionContext.extension.id,
			version: this.getVersion(),
			clientId: registeredClient.clientId,
			deviceType: registeredClient.deviceType,
			os: registeredClient.os,
		});
		this.send(ws, welcome);
	}

	/**
	 * Handle incoming WebSocket message.
	 */
	private handleMessage(ws: WebSocket, clientInfo: ClientInfo, data: RawData): void {
		let request: unknown;
		try {
			request = JSON.parse(data.toString());
		} catch {
			this.output.appendLine(`[WS Server] Invalid JSON from ${clientInfo.id}`);
			const response = createErrorResponse('', WsErrorCodes.PARSE_ERROR, 'Parse error: Invalid JSON');
			this.send(ws, response);
			return;
		}

		if (!isValidRequest(request)) {
			this.output.appendLine(`[WS Server] Invalid request from ${clientInfo.id}`);
			const id = (request as { id?: string })?.id || '';
			const response = createErrorResponse(id, WsErrorCodes.INVALID_REQUEST, 'Invalid Request');
			this.send(ws, response);
			return;
		}

		this.output.appendLine(`[WS Server] Request from ${clientInfo.id}: ${request.method}`);
		this.routeRequest(ws, clientInfo, request);
	}

	/**
	 * Internal request routing — returns response without sending.
	 * Used by both local WS handler and relay bridge.
	 */
	private async routeRequestInternal(
		request: WsRequest,
		context?: { clientInfo?: ClientInfo; ws?: WebSocket }
	): Promise<WsResponse> {
		switch (request.method) {
			case 'execute_command':
				return this.handleExecuteCommand(request);
			case 'get_status':
				return this.handleGetStatus(request);
			case 'subscribe_events':
				return context?.clientInfo
					? this.handleSubscribeEvents(request, context.clientInfo)
					: createErrorResponse(request.id, WsErrorCodes.INVALID_REQUEST, 'subscribe_events not available via relay');
			case 'unsubscribe_events':
				return context?.clientInfo
					? this.handleUnsubscribeEvents(request, context.clientInfo)
					: createErrorResponse(request.id, WsErrorCodes.INVALID_REQUEST, 'unsubscribe_events not available via relay');
			case 'invoke_agent':
				return this.handleInvokeAgent(request);
			case 'get_sessions':
				return this.handleGetSessions(request);
			case 'cancel_session':
				return this.handleCancelSession(request);
			case 'list_agents':
				return this.handleListAgents(request);
			case 'get_event_history':
				return this.handleGetEventHistory(request);
			case 'resolve_permission':
				return this.handleResolvePermission(request, context?.clientInfo);
			case 'get_pending_permissions':
				return this.handleGetPendingPermissions(request);
			case 'list_clients':
				return this.handleListClients(request);
			case 'get_client':
				return this.handleGetClient(request);
			case 'disconnect_client':
				return this.handleDisconnectClient(request);
			case 'pong':
				return context?.ws
					? this.handlePong(request, context.ws)
					: createSuccessResponse(request.id, { acknowledged: true });
			default:
				return createErrorResponse(
					request.id,
					WsErrorCodes.METHOD_NOT_FOUND,
					`Method not found: ${request.method}`
				);
		}
	}

	/**
	 * Route request to appropriate handler (local WS clients).
	 */
	private async routeRequest(ws: WebSocket, clientInfo: ClientInfo, request: WsRequest): Promise<void> {
		let response: WsResponse;
		try {
			response = await this.routeRequestInternal(request, { clientInfo, ws });
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Internal error';
			this.output.appendLine(`[WS Server] Handler error: ${message}`);
			response = createErrorResponse(request.id, WsErrorCodes.INTERNAL_ERROR, message);
		}
		this.send(ws, response);
	}

	/**
	 * Handle a request from the cloud relay (no local WebSocket).
	 * Used by RelayClient to route incoming relay envelopes through the same handlers.
	 */
	async handleRelayRequest(request: WsRequest): Promise<WsResponse> {
		this.output.appendLine(`[WS Server] Relay request: ${request.method}`);
		try {
			return await this.routeRequestInternal(request);
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Internal error';
			this.output.appendLine(`[WS Server] Relay handler error: ${message}`);
			return createErrorResponse(request.id, WsErrorCodes.INTERNAL_ERROR, message);
		}
	}

	/**
	 * Handle execute_command request.
	 */
	private async handleExecuteCommand(request: WsRequest): Promise<WsResponse> {
		const params = request.params as ExecuteCommandParams | undefined;
		if (!params?.command || typeof params.command !== 'string') {
			return createErrorResponse(
				request.id,
				WsErrorCodes.INVALID_PARAMS,
				'Missing required parameter: command'
			);
		}

		// Security: Check if command is allowlisted
		if (!this.allowedCommands.has(params.command)) {
			this.output.appendLine(`[WS Server] Blocked command: ${params.command}`);
			return createErrorResponse(
				request.id,
				WsErrorCodes.UNAUTHORIZED,
				`Command not allowed: ${params.command}`
			);
		}

		try {
			const args = params.args ?? [];
			const result = await vscode.commands.executeCommand(params.command, ...args);
			return createSuccessResponse(request.id, { executed: true, result });
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Command execution failed';
			return createErrorResponse(request.id, WsErrorCodes.COMMAND_FAILED, message);
		}
	}

	/**
	 * Handle get_status request.
	 */
	private handleGetStatus(request: WsRequest): WsResponse {
		const workspaces = vscode.workspace.workspaceFolders?.map(f => f.name) ?? [];
		const status: ExtensionStatus = {
			version: this.getVersion(),
			activeWorkspaces: workspaces,
			connectedClients: this.clientRegistry.getActiveCount(),
			uptime: Date.now() - this.startTime,
		};
		return createSuccessResponse(request.id, status);
	}

	/**
	 * Handle subscribe_events request.
	 * Supports both legacy event names and new typed event/session filtering.
	 */
	private handleSubscribeEvents(request: WsRequest, clientInfo: ClientInfo): WsResponse {
		const params = request.params as SubscribeEventsParams | undefined;

		// Support legacy format (events array of strings)
		if (params?.events && Array.isArray(params.events)) {
			for (const event of params.events) {
				if (typeof event === 'string') {
					clientInfo.subscribedEvents.add(event);
				}
			}
		}

		// New typed filtering via eventEmitter
		const eventTypes = params?.eventTypes as EventType[] | undefined;
		const sessionIds = params?.sessionIds;

		if (eventTypes || sessionIds) {
			this.eventEmitter.subscribe(clientInfo.id, eventTypes, sessionIds);
		} else if (!params?.events?.length) {
			// Subscribe to all events if no filters provided
			this.eventEmitter.subscribe(clientInfo.id);
		}

		const subscription = this.eventEmitter.getSubscription(clientInfo.id);

		return createSuccessResponse(request.id, {
			subscribedLegacy: Array.from(clientInfo.subscribedEvents),
			subscribedEventTypes: subscription?.eventTypes ?? 'all',
			subscribedSessionIds: subscription?.sessionIds ?? 'all',
		});
	}

	/**
	 * Handle unsubscribe_events request.
	 */
	private handleUnsubscribeEvents(request: WsRequest, clientInfo: ClientInfo): WsResponse {
		const params = request.params as UnsubscribeEventsParams | undefined;

		// Support legacy format
		if (params?.events && Array.isArray(params.events)) {
			for (const event of params.events) {
				if (typeof event === 'string') {
					clientInfo.subscribedEvents.delete(event);
				}
			}
		}

		// New typed filtering
		const eventTypes = params?.eventTypes as EventType[] | undefined;
		const sessionIds = params?.sessionIds;

		this.eventEmitter.unsubscribe(clientInfo.id, eventTypes, sessionIds);

		const subscription = this.eventEmitter.getSubscription(clientInfo.id);

		return createSuccessResponse(request.id, {
			subscribedLegacy: Array.from(clientInfo.subscribedEvents),
			subscribedEventTypes: subscription?.eventTypes ?? 'all',
			subscribedSessionIds: subscription?.sessionIds ?? 'all',
		});
	}

	/**
	 * Handle invoke_agent request - start an agent session.
	 */
	private async handleInvokeAgent(request: WsRequest): Promise<WsResponse> {
		const params = request.params as InvokeAgentParams | undefined;
		if (!params?.agentName || typeof params.agentName !== 'string') {
			return createErrorResponse(
				request.id,
				WsErrorCodes.INVALID_PARAMS,
				'Missing required parameter: agentName'
			);
		}

		if (!params?.prompt || typeof params.prompt !== 'string') {
			return createErrorResponse(
				request.id,
				WsErrorCodes.INVALID_PARAMS,
				'Missing required parameter: prompt'
			);
		}

		if (!this.chatParticipant) {
			return createErrorResponse(
				request.id,
				WsErrorCodes.INTERNAL_ERROR,
				'Chat participant not initialized'
			);
		}

		try {
			const result = await this.chatParticipant.startRemoteSession(
				params.agentName,
				params.prompt
			);

			if (result.success) {
				return createSuccessResponse(request.id, {
					sessionId: result.sessionId,
					status: 'started',
				});
			} else {
				return createErrorResponse(
					request.id,
					WsErrorCodes.COMMAND_FAILED,
					result.error ?? 'Failed to start agent session'
				);
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Unknown error';
			return createErrorResponse(request.id, WsErrorCodes.INTERNAL_ERROR, message);
		}
	}

	/**
	 * Handle get_sessions request - list all sessions.
	 */
	private handleGetSessions(request: WsRequest): WsResponse {
		if (!this.sessionManager) {
			return createErrorResponse(
				request.id,
				WsErrorCodes.INTERNAL_ERROR,
				'Session manager not initialized'
			);
		}

		const sessions = this.sessionManager.getSessionSummaries();
		return createSuccessResponse(request.id, { sessions });
	}

	/**
	 * Handle cancel_session request - cancel a running session.
	 */
	private handleCancelSession(request: WsRequest): WsResponse {
		const params = request.params as CancelSessionParams | undefined;
		if (!params?.sessionId || typeof params.sessionId !== 'string') {
			return createErrorResponse(
				request.id,
				WsErrorCodes.INVALID_PARAMS,
				'Missing required parameter: sessionId'
			);
		}

		if (!this.sessionManager) {
			return createErrorResponse(
				request.id,
				WsErrorCodes.INTERNAL_ERROR,
				'Session manager not initialized'
			);
		}

		const cancelled = this.sessionManager.cancelSession(params.sessionId);
		if (cancelled) {
			return createSuccessResponse(request.id, {
				cancelled: true,
				sessionId: params.sessionId,
			});
		} else {
			const session = this.sessionManager.getSession(params.sessionId);
			if (!session) {
				return createErrorResponse(
					request.id,
					WsErrorCodes.INVALID_PARAMS,
					`Session not found: ${params.sessionId}`
				);
			}
			return createErrorResponse(
				request.id,
				WsErrorCodes.COMMAND_FAILED,
				`Cannot cancel session with status: ${session.status}`
			);
		}
	}

	/**
	 * Handle list_agents request - list available agents.
	 */
	private async handleListAgents(request: WsRequest): Promise<WsResponse> {
		try {
			// Dynamically import to avoid circular dependency
			const { scanAgents } = await import('./agentScanner');
			const snapshot = await scanAgents();

			const agents = snapshot.repos.flatMap((repo) =>
				repo.agents.map((agent) => ({
					name: agent.fileName.replace('.agent.md', ''),
					description: agent.description,
					repo: repo.repoName,
					enabled: agent.enabled,
				}))
			);

			return createSuccessResponse(request.id, { agents });
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Unknown error';
			return createErrorResponse(request.id, WsErrorCodes.INTERNAL_ERROR, message);
		}
	}

	/**
	 * Handle get_event_history request - get buffered events.
	 */
	private handleGetEventHistory(request: WsRequest): WsResponse {
		const params = request.params as GetEventHistoryParams | undefined;

		const events = this.eventEmitter.getEventHistory(
			params?.eventTypes,
			params?.sessionIds,
			params?.limit
		);

		return createSuccessResponse(request.id, {
			events,
			count: events.length,
		});
	}

	/**
	 * Handle resolve_permission request - respond to permission request.
	 */
	private handleResolvePermission(request: WsRequest, clientInfo?: ClientInfo): WsResponse {
		const params = request.params as ResolvePermissionParams | undefined;

		if (!params?.callbackId || typeof params.callbackId !== 'string') {
			return createErrorResponse(
				request.id,
				WsErrorCodes.INVALID_PARAMS,
				'Missing required parameter: callbackId'
			);
		}

		if (typeof params.approved !== 'boolean') {
			return createErrorResponse(
				request.id,
				WsErrorCodes.INVALID_PARAMS,
				'Missing required parameter: approved (boolean)'
			);
		}

		const resolvedBy = params.resolvedBy ?? clientInfo?.userId ?? clientInfo?.id ?? 'relay-client';
		const success = this.eventEmitter.resolvePermission(params.callbackId, params.approved, resolvedBy);

		if (!success) {
			return createErrorResponse(
				request.id,
				WsErrorCodes.INVALID_PARAMS,
				`Permission request not found or already resolved: ${params.callbackId}`
			);
		}

		return createSuccessResponse(request.id, {
			resolved: true,
			callbackId: params.callbackId,
			approved: params.approved,
		});
	}

	/**
	 * Handle get_pending_permissions request - list pending approval requests.
	 */
	private handleGetPendingPermissions(request: WsRequest): WsResponse {
		const pending = this.eventEmitter.getPendingPermissions();

		return createSuccessResponse(request.id, {
			permissions: pending,
			count: pending.length,
		});
	}

	/**
	 * Handle list_clients request - get all connected clients.
	 */
	private handleListClients(request: WsRequest): WsResponse {
		const clients = this.clientRegistry.listClientsDto();
		return createSuccessResponse(request.id, {
			clients,
			count: clients.length,
		});
	}

	/**
	 * Handle get_client request - get specific client details.
	 */
	private handleGetClient(request: WsRequest): WsResponse {
		const params = request.params as GetClientParams | undefined;
		if (!params?.clientId || typeof params.clientId !== 'string') {
			return createErrorResponse(
				request.id,
				WsErrorCodes.INVALID_PARAMS,
				'Missing required parameter: clientId'
			);
		}

		const client = this.clientRegistry.getClient(params.clientId);
		if (!client) {
			return createErrorResponse(
				request.id,
				WsErrorCodes.INVALID_PARAMS,
				`Client not found: ${params.clientId}`
			);
		}

		return createSuccessResponse(request.id, {
			client: this.clientRegistry.toDto(client),
		});
	}

	/**
	 * Handle disconnect_client request - forcefully disconnect a client.
	 */
	private handleDisconnectClient(request: WsRequest): WsResponse {
		const params = request.params as DisconnectClientParams | undefined;
		if (!params?.clientId || typeof params.clientId !== 'string') {
			return createErrorResponse(
				request.id,
				WsErrorCodes.INVALID_PARAMS,
				'Missing required parameter: clientId'
			);
		}

		const success = this.clientRegistry.disconnectClient(params.clientId);
		if (!success) {
			return createErrorResponse(
				request.id,
				WsErrorCodes.INVALID_PARAMS,
				`Client not found: ${params.clientId}`
			);
		}

		return createSuccessResponse(request.id, {
			disconnected: true,
			clientId: params.clientId,
		});
	}

	/**
	 * Handle pong response from client (heartbeat acknowledgment).
	 */
	private handlePong(request: WsRequest, ws: WebSocket): WsResponse {
		this.clientRegistry.handlePong(ws);
		return createSuccessResponse(request.id, { acknowledged: true });
	}

	/**
	 * Emit a typed event through the event emitter.
	 * This is the preferred method for emitting events.
	 */
	emitEvent(type: EventType, payload: unknown, sessionId?: string, correlationId?: string): ExtensionEvent {
		return this.eventEmitter.emit(type, payload, sessionId, correlationId);
	}

	/**
	 * Request permission from connected clients.
	 * Returns a promise that resolves to true (approved) or false (denied/timeout).
	 */
	async requestPermission(
		sessionId: string,
		operation: string,
		description: string,
		correlationId?: string,
		timeoutMs?: number
	): Promise<boolean> {
		return this.eventEmitter.emitPermissionRequest(sessionId, operation, description, correlationId, timeoutMs);
	}

	/**
	 * Send a message to a WebSocket client.
	 */
	private send(ws: WebSocket, message: WsResponse | WsNotification): void {
		if (ws.readyState === WebSocket.OPEN) {
			ws.send(JSON.stringify(message));
		}
	}

	/**
	 * Get extension version from package.json.
	 */
	private getVersion(): string {
		try {
			const pkg = this.extensionContext.extension.packageJSON as PackageInfo;
			return pkg.version || '0.0.0';
		} catch {
			return '0.0.0';
		}
	}

	/**
	 * Update status bar with server info.
	 */
	private updateStatusBar(port?: number): void {
		if (!this.statusBarItem) {
			this.statusBarItem = vscode.window.createStatusBarItem(
				vscode.StatusBarAlignment.Right,
				100
			);
			this.extensionContext.subscriptions.push(this.statusBarItem);
		}

		if (!this.httpServer?.listening) {
			this.statusBarItem.hide();
			return;
		}

		const addr = this.httpServer.address();
		const actualPort = port ?? (typeof addr === 'object' && addr ? addr.port : 0);
		const clientCount = this.clientRegistry.getActiveCount();

		this.statusBarItem.text = `$(radio-tower) WS:${actualPort} (${clientCount})`;
		this.statusBarItem.tooltip = `WebSocket Server\nPort: ${actualPort}\nClients: ${clientCount}`;
		this.statusBarItem.show();
	}

	/**
	 * Get the current server port (for display/pairing).
	 */
	getPort(): number | undefined {
		const addr = this.httpServer?.address();
		if (typeof addr === 'object' && addr) {
			return addr.port;
		}
		return undefined;
	}

	/**
	 * Check if server is running.
	 */
	isRunning(): boolean {
		return this.httpServer?.listening ?? false;
	}

	/**
	 * Get uptime in milliseconds, if running.
	 */
	getUptimeMs(): number | undefined {
		if (!this.httpServer?.listening || !this.startTime) {
			return undefined;
		}
		return Date.now() - this.startTime;
	}

	/**
	 * Get connected client count.
	 */
	getClientCount(): number {
		return this.clientRegistry.getActiveCount();
	}

	/**
	 * Get the client registry for external access.
	 */
	getClientRegistry(): ClientRegistry {
		return this.clientRegistry;
	}

	/**
	 * Stop the server gracefully.
	 */
	async stop(): Promise<void> {
		// Stop heartbeat/cleanup timers
		this.clientRegistry.stopTimers();

		// Close all client connections via registry
		this.clientRegistry.clear();
		this.clientsById.clear();

		// Close WebSocket server
		if (this.wss) {
			this.wss.close();
			this.wss = undefined;
		}

		// Close HTTP server
		if (this.httpServer) {
			await new Promise<void>((resolve) => {
				this.httpServer!.close(() => resolve());
			});
			this.httpServer = undefined;
		}

		this.statusBarItem?.hide();
		this.output.appendLine('[WS Server] Stopped');
	}

	/**
	 * Dispose of all resources.
	 */
	dispose(): void {
		this.disposed = true;
		this.eventEmitter.dispose();
		this.clientRegistry.dispose();
		void this.stop();
	}
}
